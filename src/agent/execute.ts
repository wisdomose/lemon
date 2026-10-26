// The agent's one tool: a script run against the document. Its statements land one by one as the
// model writes them (`LiveRun.feed`), so the person sees each element appear; if the script fails,
// everything it did is removed again, as one unit.
import type * as Y from "yjs";
import { trackStep, type AgentChange, type Touched } from "../doc/live.js";
import type { Issue } from "../layout/check.js";
import { screenshot } from "../render/screenshot.js";
import { Abort, type Globals, type Sandbox, type ScriptError, type ScriptRun } from "../sandbox/sandbox.js";
import { FontsNeeded } from "../text/fonts.js";
import type { Engine } from "../engine.js";
import { PRELUDE, ScriptSession } from "./script-api.js";
import { statements, type Piece } from "./statements.js";

export interface ExecuteResult {
  ok: boolean;
  /** The script's return value. */
  value?: unknown;
  error?: { name: string; message: string; line?: number };
  /** Values the script left on the global object, for the agent's next script (the input's on failure). */
  globals: Globals;
  refs: Record<string, string>;
  logs: string[];
  /** Changes skipped because a person had just made their own (see doc/live.ts, rule b). */
  leftAlone: string[];
  /** The automatic check of every top-level frame the script changed. */
  issues: Issue[];
  /** Top-level frames the script changed. */
  frames: string[];
  /** Where the script last worked (the last node it created or changed), for the agent's cursor. */
  focus?: Focus;
  pictures: { id: string; png: Uint8Array; width: number; height: number }[];
  timings: { totalMs: number; scriptMs: number; layoutMs: number; picturesMs: number; fontsMs: number; attempts: number };
}

/** The element a script is working on: its box, and whether the script just made it. */
export type Focus = { id: string; created: boolean; x: number; y: number; w: number; h: number };

const MAX_ISSUES = 40;
/** Times a script may start over because it needed fonts that weren't loaded. */
const MAX_ATTEMPTS = 4;

const fontsNeeded = (e: unknown) => (e instanceof Abort && e.cause instanceof FontsNeeded ? e.cause : e instanceof FontsNeeded ? e : undefined);

/** One script, run statement by statement on the live document while it is being written. */
export class LiveRun {
  private run!: ScriptRun;
  private session!: ScriptSession;
  private readonly step: ReturnType<typeof trackStep>;
  private text = "";
  private consumed = 0;
  /** Statements that have run, to run again if the script has to start over. */
  private ran: (Piece & { code: string })[] = [];
  private declared = new Set<string>();
  private returned?: { value: unknown };
  private error?: ScriptError;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly t0 = performance.now();
  private scriptMs = 0;
  private fontsMs = 0;
  private attempts = 1;
  /** The element the last progress report was about. */
  private reported?: ScriptSession["working"];

  constructor(
    private readonly doc: Y.Doc,
    private readonly engine: Engine,
    private readonly sandbox: Sandbox,
    private readonly origin: AgentChange | string,
    /** Properties people changed since this agent last reported back; the step leaves them alone. */
    private readonly protect: Touched | undefined,
    /** Values earlier scripts left on the global object. */
    private readonly globals: Globals = {},
    /** Called after each statement lands, with where it worked. */
    private readonly onProgress?: (focus: Focus) => void,
  ) {
    this.step = trackStep(doc, origin);
    this.start();
  }

  private start(): void {
    this.session = new ScriptSession(this.doc, this.engine, this.protect);
    this.run = this.sandbox.open(PRELUDE, this.session.host, undefined, this.globals);
  }

  /** Whether any statement has landed. */
  get started(): boolean {
    return this.ran.length > 0;
  }

  /** Whether `script` carries on the script fed so far. */
  writes(script: string): boolean {
    return script.startsWith(this.text);
  }

  /** The script so far: runs the statements that are now complete. */
  feed(text: string): void {
    this.text = text;
    this.queue = this.queue.then(() => this.pump(false)).catch((e) => this.crash(e));
  }

  /** The whole script: runs what is left and reports. */
  async finish(script: string): Promise<ExecuteResult> {
    this.text = script;
    await (this.queue = this.queue.then(() => this.pump(true)).catch((e) => this.crash(e)));
    return this.report();
  }

  /** The script will never finish (the call was dropped): remove what it did. */
  cancel(): Promise<void> {
    return (this.queue = this.queue.then(() => {
      if (this.closed) return;
      this.step.revert();
      this.close();
    }));
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.run.close();
    this.step.dispose();
  }

  private get stopped(): boolean {
    return this.closed || !!this.error || !!this.returned;
  }

  private async pump(final: boolean): Promise<void> {
    if (this.stopped) return;
    let pieces: Piece[];
    try {
      pieces = statements(this.text, this.consumed, final);
    } catch (e) {
      const err = e as SyntaxError & { line?: number };
      this.fail({ name: "SyntaxError", message: err.message, ...(err.line ? { line: err.line } : {}) });
      return;
    }
    for (const p of pieces) {
      if (this.stopped) return;
      await this.land({ ...p, code: this.text.slice(p.start, p.end) });
    }
  }

  /** Runs one statement as one change to the document, then lays the result out for the cursor. */
  private async land(p: Piece & { code: string }): Promise<void> {
    for (;;) {
      try {
        const s0 = performance.now();
        const r = this.doc.transact(() => this.run.exec(p.code, p.line, p.returns), this.origin);
        this.scriptMs += performance.now() - s0;
        this.session.write();
        if (!r.ok) return this.fail(r.error);
        this.consumed = p.end;
        this.ran.push(p);
        p.declares.forEach((n) => this.declared.add(n));
        if (r.returned) this.returned = { value: r.value };
        break;
      } catch (e) {
        const faces = fontsNeeded(e);
        if (!faces || this.attempts >= MAX_ATTEMPTS) throw e;
        // The statement needed fonts that aren't loaded: start the script over once they are.
        await this.loadFonts(faces);
        await this.restart();
        if (this.stopped) return;
      }
    }
    // Only when the script moves on to another element: the cursor rests while it works on one.
    if (this.session.working === this.reported) return;
    this.reported = this.session.working;
    const focus = await this.focus();
    if (focus) this.onProgress?.(focus);
  }

  private async loadFonts(e: FontsNeeded): Promise<void> {
    const f0 = performance.now();
    await this.engine.fonts.ensure(e.faces);
    this.fontsMs += performance.now() - f0;
    this.session.write();
  }

  /** Removes what the script did and runs the statements that had landed again, in a fresh runtime. */
  private async restart(): Promise<void> {
    this.attempts++;
    this.step.revert();
    this.run.close();
    const ran = this.ran;
    this.ran = [];
    this.declared.clear();
    this.returned = undefined;
    this.start();
    for (const p of ran) {
      await this.land(p);
      if (this.stopped) return;
    }
  }

  /** Something other than the script went wrong (fonts kept failing to load, say): stop and undo. */
  private crash(e: unknown): void {
    if (!this.error) this.fail({ name: "Error", message: e instanceof Error ? e.message : String(e) });
  }

  private fail(error: ScriptError): void {
    const { stack: _stack, ...rest } = error;
    this.error = rest;
    this.step.revert();
  }

  /** The layout, loading any fonts it needs first. */
  private async measured() {
    for (;;) {
      try {
        return this.session.measured();
      } catch (e) {
        const faces = fontsNeeded(e);
        if (!faces) throw e;
        await this.loadFonts(faces);
      }
    }
  }

  private async focus(): Promise<Focus | undefined> {
    const w = this.session.working;
    if (!w) return undefined;
    const { boxes } = await this.measured();
    const box = boxes.get(w.id);
    return box ? { ...w, ...box } : undefined;
  }

  private async report(): Promise<ExecuteResult> {
    const s = this.session;
    const timings = () => ({
      totalMs: performance.now() - this.t0,
      scriptMs: Math.max(0, this.scriptMs - s.layoutMs),
      layoutMs: s.layoutMs,
      picturesMs,
      fontsMs: this.fontsMs,
      attempts: this.attempts,
    });
    let picturesMs = 0;
    if (this.error || this.closed) {
      this.close();
      return {
        ok: false,
        error: this.error ?? { name: "Error", message: "The script was stopped." },
        globals: this.globals,
        refs: {},
        logs: s.logs,
        leftAlone: [],
        issues: [],
        frames: [],
        pictures: [],
        timings: timings(),
      };
    }
    const globals = this.run.globals(this.declared);
    this.close();
    const { tree, boxes, vars } = await this.measured();
    const frames = s.touchedFrames();
    const issues = s.issuesFor(frames).slice(0, MAX_ISSUES);
    const p0 = performance.now();
    const pictures = s.screenshots.map((id) => ({ id, ...screenshot(this.engine.ck, tree, boxes, vars, this.engine.text, id) }));
    picturesMs = performance.now() - p0;
    const focus = await this.focus();
    return {
      ok: true,
      value: this.returned?.value,
      globals,
      refs: s.refs,
      logs: s.logs,
      leftAlone: s.leftAlone,
      issues,
      frames,
      ...(focus ? { focus } : {}),
      pictures,
      timings: timings(),
    };
  }
}

/** Runs a whole script at once (a script that wasn't watched as it was written, or a patched one). */
export function execute(
  doc: Y.Doc,
  engine: Engine,
  sandbox: Sandbox,
  script: string,
  origin: AgentChange | string,
  protect?: Touched,
  globals: Globals = {},
): Promise<ExecuteResult> {
  return new LiveRun(doc, engine, sandbox, origin, protect, globals).finish(script);
}
