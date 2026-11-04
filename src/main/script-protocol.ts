// Messages between the main process and the utility process agents' scripts run in
// (main/script-runs.ts ⇄ main/script-worker.ts). Documents are kept level with Yjs updates, as the
// window's copy is: the main process's copy stays the one that counts.
import type { Touched } from "../doc/live.js";
import type { Globals } from "../sandbox/sandbox.js";
import type { ExecuteResult, Focus } from "../agent/execute.js";

/** A step's origin as it crosses: an agent's step, or a plain name. */
export type OriginData = { agent: string; step: number } | string;

export type ToWorker =
  | { type: "open"; doc: number; state: Uint8Array }
  | { type: "update"; doc: number; update: Uint8Array }
  | { type: "close"; doc: number }
  | { type: "start"; run: number; doc: number; origin: OriginData; protect?: Touched; globals: Globals; progress: boolean }
  | { type: "feed"; run: number; text: string }
  | { type: "finish"; run: number; script: string }
  | { type: "cancel"; run: number };

export type FromWorker =
  | { type: "ready" }
  /** A change the worker made; `run` when a script's step made it. */
  | { type: "update"; doc: number; update: Uint8Array; run?: number }
  | { type: "started"; run: number }
  | { type: "progress"; run: number; focus: Focus }
  | { type: "result"; run: number; result: ExecuteResult }
  | { type: "cancelled"; run: number };
