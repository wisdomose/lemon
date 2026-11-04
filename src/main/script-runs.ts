// Agents' scripts, run in a utility process of their own (main/script-worker.ts) instead of Electron's
// main process: the sandbox, layout and screenshot PNGs no longer hold up the main process, which keeps
// answering the window (Pen runs its MCP server as a process of its own, and encodes PNGs in workers).
// Each document a script runs on is copied there once and kept level with Yjs updates both ways; a
// script's changes come back in order, before its result, and land here with the step's own origin.
import { utilityProcess, type UtilityProcess } from "electron";
import * as Y from "yjs";
import type { AgentChange } from "../doc/live.js";
import type { ExecuteResult, Focus } from "../agent/execute.js";
import type { LiveScript, ScriptRuns } from "../agent/runs.js";
import type { FromWorker, OriginData, ToWorker } from "./script-protocol.js";

interface Run {
  origin: AgentChange | string;
  doc: Y.Doc;
  started: boolean;
  onProgress?: (focus: Focus) => void;
  result?: (r: ExecuteResult) => void;
  cancelled?: () => void;
}

const originData = (o: AgentChange | string): OriginData => (typeof o === "string" ? o : { agent: o.agent, step: o.step });

/** The worker stopped: what a script waiting on it is told. */
const stopped = (): ExecuteResult => ({
  ok: false,
  error: { name: "Error", message: "The script runner stopped; send the script again." },
  globals: {},
  created: [],
  logs: [],
  leftAlone: [],
  issues: [],
  frames: [],
  pictures: [],
  timings: { totalMs: 0, scriptMs: 0, layoutMs: 0, picturesMs: 0, fontsMs: 0, attempts: 0 },
});

export class WorkerScripts implements ScriptRuns {
  private child: UtilityProcess | undefined;
  private ready = false;
  private queue: ToWorker[] = [];
  private ids = new WeakMap<Y.Doc, number>();
  private docs = new Map<number, { doc: Y.Doc; stop: () => void }>();
  private runs = new Map<number, Run>();
  private nextDoc = 1;
  private nextRun = 1;
  /** Changes from the worker being applied here (not sent back). */
  private applying = false;

  constructor(
    /** The built worker's file. */
    private readonly entry: string,
    /** Where fonts are cached (shared with the main process). */
    private readonly fontsDir: string,
    private readonly log: (msg: string) => void,
  ) {}

  private send(m: ToWorker): void {
    this.spawn();
    if (this.ready) this.child!.postMessage(m);
    else this.queue.push(m);
  }

  private spawn(): void {
    if (this.child) return;
    const child = utilityProcess.fork(this.entry, [this.fontsDir], { serviceName: "Lemon scripts", stdio: "pipe" });
    this.child = child;
    child.stdout?.on("data", (b: Buffer) => this.log(`[scripts] ${b.toString().trimEnd()}`));
    child.stderr?.on("data", (b: Buffer) => this.log(`[scripts] ${b.toString().trimEnd()}`));
    child.on("message", (m: FromWorker) => this.receive(m));
    child.on("exit", (code) => {
      this.log(`script runner exited (${code})`);
      this.child = undefined;
      this.ready = false;
      this.queue = [];
      // Its copies are gone: documents are sent again on the next run; waiting scripts are told.
      for (const { stop } of this.docs.values()) stop();
      this.docs.clear();
      this.ids = new WeakMap();
      for (const r of this.runs.values()) (r.result?.(stopped()), r.cancelled?.());
      this.runs.clear();
    });
  }

  private receive(m: FromWorker): void {
    switch (m.type) {
      case "ready": {
        this.ready = true;
        const queued = this.queue;
        this.queue = [];
        for (const q of queued) this.child!.postMessage(q);
        return;
      }
      case "update": {
        const d = this.docs.get(m.doc);
        if (!d) return;
        const origin = m.run !== undefined ? this.runs.get(m.run)?.origin : undefined;
        this.applying = true;
        try {
          Y.applyUpdate(d.doc, m.update, origin ?? "script-runner");
        } finally {
          this.applying = false;
        }
        return;
      }
      case "started": {
        const r = this.runs.get(m.run);
        if (r) r.started = true;
        return;
      }
      case "progress":
        return this.runs.get(m.run)?.onProgress?.(m.focus);
      case "result": {
        const r = this.runs.get(m.run);
        this.runs.delete(m.run);
        return r?.result?.(m.result);
      }
      case "cancelled": {
        const r = this.runs.get(m.run);
        this.runs.delete(m.run);
        return r?.cancelled?.();
      }
    }
  }

  /** The document's id in the worker, sending it there the first time. */
  private docId(doc: Y.Doc): number {
    const known = this.ids.get(doc);
    if (known !== undefined && this.child) return known;
    const id = this.nextDoc++;
    this.ids.set(doc, id);
    this.send({ type: "open", doc: id, state: Y.encodeStateAsUpdate(doc) });
    const onUpdate = (update: Uint8Array) => {
      if (!this.applying) this.send({ type: "update", doc: id, update });
    };
    doc.on("update", onUpdate);
    this.docs.set(id, { doc, stop: () => doc.off("update", onUpdate) });
    return id;
  }

  /** The document is closed: its copy in the worker goes. */
  forget(doc: Y.Doc): void {
    const id = this.ids.get(doc);
    if (id === undefined) return;
    this.ids.delete(doc);
    this.docs.get(id)?.stop();
    this.docs.delete(id);
    if (this.child) this.send({ type: "close", doc: id });
  }

  live(doc: Y.Doc, origin: AgentChange | string, protect: Parameters<ScriptRuns["live"]>[2], globals: Parameters<ScriptRuns["live"]>[3], onProgress?: (focus: Focus) => void): LiveScript {
    const docId = this.docId(doc);
    const id = this.nextRun++;
    const run: Run = { origin, doc, started: false, ...(onProgress ? { onProgress } : {}) };
    this.runs.set(id, run);
    this.send({ type: "start", run: id, doc: docId, origin: originData(origin), ...(protect ? { protect } : {}), globals, progress: !!onProgress });
    let text = "";
    let settled = false;
    return {
      get started() {
        return run.started;
      },
      writes: (script) => script.startsWith(text),
      feed: (t) => {
        text = t;
        this.send({ type: "feed", run: id, text: t });
      },
      finish: (script) => {
        text = script;
        settled = true;
        return new Promise<ExecuteResult>((resolve) => {
          if (!this.runs.has(id)) return resolve(stopped());
          run.result = resolve;
          this.send({ type: "finish", run: id, script });
        });
      },
      cancel: () => {
        if (settled) return Promise.resolve();
        settled = true;
        return new Promise<void>((resolve) => {
          if (!this.runs.has(id)) return resolve();
          run.cancelled = resolve;
          this.send({ type: "cancel", run: id });
        });
      },
    };
  }

  execute(doc: Y.Doc, script: string, origin: AgentChange | string, protect?: Parameters<ScriptRuns["live"]>[2], globals: Parameters<ScriptRuns["live"]>[3] = {}): Promise<ExecuteResult> {
    return this.live(doc, origin, protect, globals).finish(script);
  }

  dispose(): void {
    this.child?.kill();
  }
}
