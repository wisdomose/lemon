// Sending the document's changes to a window without drowning it: an agent lands hundreds of small
// changes a second, and each was its own IPC message, its own repair walk and its own sync. Updates
// gathered over a frame go as one merged update (Y.mergeUpdates), and work that only needs the latest
// state runs once things settle.
import * as Y from "yjs";

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) };

/** Gathers Yjs updates and sends them as one, at most once per `ms`. */
export class UpdateBatcher {
  private pending: Uint8Array[] = [];
  private timer: unknown;

  constructor(
    private readonly send: (update: Uint8Array) => void,
    private readonly ms = 16,
    private readonly timers: Timers = realTimers,
  ) {}

  push(update: Uint8Array): void {
    this.pending.push(update);
    this.timer ??= this.timers.setTimeout(() => this.flush(), this.ms);
  }

  /** Sends what has gathered now (one merged update), if anything. */
  flush(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending.length) return;
    const merged = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending);
    this.pending = [];
    this.send(merged);
  }

  /** Drops what has gathered (the window is gone). */
  dispose(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
  }
}

/** Runs `fn` once, `ms` after the last call (or now, with `now`). */
export class Debounced {
  private timer: unknown;

  constructor(
    private readonly fn: () => void,
    private readonly ms: number,
    private readonly timers: Timers = realTimers,
  ) {}

  call(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.fn();
    }, this.ms);
  }

  /** Whether a call is waiting. */
  get pending(): boolean {
    return this.timer !== undefined;
  }

  /** Runs a waiting call now. */
  now(): void {
    if (this.timer === undefined) return;
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.fn();
  }

  cancel(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
