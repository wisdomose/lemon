// The agent's one tool: run a script against the document as a single all-or-nothing change.
import type * as Y from "yjs";
import { stage } from "../doc/store.js";
import { agentClientId, type Touched } from "../doc/live.js";
import type { Issue } from "../layout/check.js";
import { screenshot } from "../render/screenshot.js";
import { Abort, type Globals, type Sandbox, type RunResult } from "../sandbox/sandbox.js";
import { FontsNeeded } from "../text/fonts.js";
import type { Engine } from "../engine.js";
import { PRELUDE, ScriptSession } from "./script-api.js";

export interface ExecuteResult {
  ok: boolean;
  /** The script's return value. */
  value?: unknown;
  error?: { name: string; message: string; line?: number };
  refs: Record<string, string>;
  logs: string[];
  /** Values the script left on the global object, for the agent's next script (the input's on failure). */
  globals: Globals;
  /** Changes skipped because a person had just made their own (see doc/live.ts, rule b). */
  leftAlone: string[];
  /** The automatic check of every top-level frame the script changed. */
  issues: Issue[];
  /** Top-level frames the script changed. */
  frames: string[];
  /** Where the script last worked (the last node it created or changed), for the agent's cursor. */
  focus?: { id: string; x: number; y: number; w: number; h: number };
  pictures: { id: string; png: Uint8Array; width: number; height: number }[];
  timings: { totalMs: number; scriptMs: number; layoutMs: number; picturesMs: number; fontsMs: number; attempts: number };
}

class ScriptFailed extends Error {
  constructor(readonly result: Extract<RunResult, { ok: false }>, readonly session: ScriptSession) {
    super(result.error.message);
  }
}

const MAX_ISSUES = 40;

export async function execute(
  doc: Y.Doc,
  engine: Engine,
  sandbox: Sandbox,
  script: string,
  origin: unknown,
  /** Properties people changed since this agent last reported back; the step leaves them alone. */
  protect?: Touched,
  /** Values earlier scripts left on the global object. */
  globals: Globals = {},
): Promise<ExecuteResult> {
  const t0 = performance.now();
  let fontsMs = 0;
  // A script that needs fonts not yet loaded is stopped, the fonts are fetched, and the script runs
  // again from the start on a fresh copy; nothing it did the first time was kept.
  for (let attempt = 1; ; attempt++) {
    let session: ScriptSession | undefined;
    let scriptMs = 0;
    let scriptLayoutMs = 0;
    try {
      const staged = stage(doc, (copy) => {
        session = new ScriptSession(copy, engine, protect);
        const s0 = performance.now();
        const result = sandbox.run(PRELUDE, script, session.host, undefined, globals);
        scriptMs = performance.now() - s0;
        scriptLayoutMs = session.layoutMs; // layout the script itself asked for (doc.get, check, …)
        if (!result.ok) throw new ScriptFailed(result, session);
        // Measure and draw before committing, while the copy is still there.
        const frames = session.touchedFrames();
        const issues = session.issuesFor(frames).slice(0, MAX_ISSUES);
        const p0 = performance.now();
        const { tree, boxes, vars } = session.measured();
        const pictures = session.screenshots.map((id) => ({
          id,
          ...screenshot(engine.ck, tree, boxes, vars, engine.text, id),
        }));
        const lastId = [...session.touched].reverse().find((id) => boxes.has(id));
        const focus = lastId ? { id: lastId, ...boxes.get(lastId)! } : undefined;
        return { value: result.value, globals: result.globals, frames, issues, pictures, focus, picturesMs: performance.now() - p0 };
      }, agentClientId());
      staged.commit(origin);
      const v = staged.value;
      return {
        ok: true,
        value: v.value,
        globals: v.globals,
        refs: session!.refs,
        logs: session!.logs,
        leftAlone: session!.leftAlone,
        issues: v.issues,
        frames: v.frames,
        ...(v.focus ? { focus: v.focus } : {}),
        pictures: v.pictures,
        timings: {
          totalMs: performance.now() - t0,
          scriptMs: scriptMs - scriptLayoutMs,
          layoutMs: session!.layoutMs,
          picturesMs: v.picturesMs,
          fontsMs,
          attempts: attempt,
        },
      };
    } catch (e) {
      const fontsNeeded = e instanceof Abort && e.cause instanceof FontsNeeded ? e.cause : e instanceof FontsNeeded ? e : undefined;
      if (fontsNeeded && attempt < 4) {
        const f0 = performance.now();
        await engine.fonts.ensure(fontsNeeded.faces);
        fontsMs += performance.now() - f0;
        continue;
      }
      if (e instanceof ScriptFailed) {
        const { stack: _stack, ...error } = e.result.error;
        return {
          ok: false,
          error,
          globals,
          refs: {},
          logs: e.session.logs,
          leftAlone: [],
          issues: [],
          frames: [],
          pictures: [],
          timings: { totalMs: performance.now() - t0, scriptMs, layoutMs: e.session.layoutMs, picturesMs: 0, fontsMs, attempts: attempt },
        };
      }
      throw e;
    }
  }
}
