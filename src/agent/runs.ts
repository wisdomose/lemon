// Where an agent's scripts run. In process (tests, headless scripts), or in a utility process of their
// own in the app (main/script-runs.ts), so the sandbox, layout and screenshots never hold up Electron's
// main process. Both work on the same document and land the same changes.
import type * as Y from "yjs";
import type { AgentChange, Touched } from "../doc/live.js";
import type { Globals, Sandbox } from "../sandbox/sandbox.js";
import type { Engine } from "../engine.js";
import { LiveRun, execute, type ExecuteResult, type Focus } from "./execute.js";

/** One script run statement by statement while it is written (see LiveRun). */
export interface LiveScript {
  readonly started: boolean;
  writes(script: string): boolean;
  feed(text: string): void;
  finish(script: string): Promise<ExecuteResult>;
  cancel(): Promise<void>;
}

export interface ScriptRuns {
  live(doc: Y.Doc, origin: AgentChange | string, protect: Touched | undefined, globals: Globals, onProgress?: (focus: Focus) => void): LiveScript;
  execute(doc: Y.Doc, script: string, origin: AgentChange | string, protect?: Touched, globals?: Globals): Promise<ExecuteResult>;
}

/** Scripts run here, in this process. */
export function inProcess(engine: Engine, sandbox: Sandbox): ScriptRuns {
  return {
    live: (doc, origin, protect, globals, onProgress) => new LiveRun(doc, engine, sandbox, origin, protect, globals, onProgress),
    execute: (doc, script, origin, protect, globals) => execute(doc, engine, sandbox, script, origin, protect, globals),
  };
}
