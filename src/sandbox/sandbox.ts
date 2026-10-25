// The sandbox for the agent's scripts: QuickJS compiled to WebAssembly.
//
// A script sees plain JavaScript and whatever the prelude defines, nothing else: no files, network,
// processes or host objects. Its one way out is `__host(op, argsJson)`, which carries text both ways;
// the host decides what each operation does. Every run gets a fresh runtime with a time and memory
// limit. Values a script leaves on the global object can be carried into a later run (`Globals`).
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSWASMModule } from "quickjs-emscripten";

export interface Limits {
  timeMs: number;
  memoryBytes: number;
}
export const DEFAULT_LIMITS: Limits = { timeMs: 15_000, memoryBytes: 128 * 1024 * 1024 };

/** Handles one operation from the script. Throwing an Error makes the script's call throw. */
export type Host = (op: string, args: unknown[]) => unknown;

/** Values set on the global object by earlier runs (only data: functions don't carry over). */
export type Globals = Record<string, unknown>;

export type RunResult =
  | { ok: true; value: unknown; globals: Globals }
  | { ok: false; error: { name: string; message: string; line?: number; stack?: string } };

/** Raised inside `Host` to abort the whole run and rethrow on the host side (e.g. fonts must load first). */
export class Abort extends Error {
  constructor(readonly cause: unknown) {
    super("aborted by host");
  }
}

export class Sandbox {
  private constructor(private qjs: QuickJSWASMModule) {}

  static async create(): Promise<Sandbox> {
    return new Sandbox(await getQuickJS());
  }

  /**
   * Runs `prelude` then `script` (as a function body, so `return` gives the result). Throws only for
   * an `Abort` raised by the host; script errors come back as `{ ok: false }`. `globals` are defined
   * before the script runs; the result has them as the script left them, with any it added.
   */
  run(prelude: string, script: string, host: Host, limits: Limits = DEFAULT_LIMITS, globals: Globals = {}): RunResult {
    const rt = this.qjs.newRuntime();
    rt.setMemoryLimit(limits.memoryBytes);
    rt.setMaxStackSize(1024 * 1024);
    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeMs));
    const vm = rt.newContext();
    let aborted: Abort | undefined;
    try {
      const bridge = vm.newFunction("__host", (opH, argsH) => {
        if (aborted) return { error: vm.newError("aborted") };
        try {
          const op = vm.getString(opH);
          const args = JSON.parse(vm.getString(argsH)) as unknown[];
          const out = host(op, args);
          return vm.newString(JSON.stringify(out === undefined ? null : out));
        } catch (e) {
          if (e instanceof Abort) {
            aborted = e;
            return { error: vm.newError("aborted") };
          }
          const err = vm.newError(e instanceof Error ? e.message : String(e));
          return { error: err };
        }
      });
      vm.setProp(vm.global, "__host", bridge);
      bridge.dispose();

      const pre = vm.evalCode(prelude, "prelude.js");
      if (pre.error) {
        const e = vm.dump(pre.error);
        pre.error.dispose();
        throw new Error(`Sandbox prelude failed: ${JSON.stringify(e)}`);
      }
      pre.value.dispose();
      const own = vm.unwrapResult(vm.evalCode(`JSON.stringify(Object.getOwnPropertyNames(globalThis))`));
      const builtIn = vm.dump(own) as string;
      own.dispose();
      const restore = vm.unwrapResult(vm.evalCode(`Object.assign(globalThis, JSON.parse(${JSON.stringify(JSON.stringify(globals))}))`));
      restore.dispose();

      // Line 1 of the script is line 2 of this source.
      const res = vm.evalCode(`(function(){\n${script}\n})()`, "script.js");
      if (aborted) {
        (res.error ?? res.value).dispose();
        throw aborted;
      }
      if (res.error) {
        const e = vm.dump(res.error) as { name?: string; message?: string; stack?: string } | string;
        res.error.dispose();
        if (typeof e !== "object" || e === null) return { ok: false, error: { name: "Error", message: String(e) } };
        const line = /script\.js:(\d+)/.exec(e.stack ?? "")?.[1];
        const name = e.name ?? "Error";
        const message =
          name === "InternalError" && e.message === "interrupted"
            ? `The script ran longer than ${limits.timeMs / 1000}s and was stopped.`
            : (e.message ?? String(e));
        return {
          ok: false,
          error: { name, message, ...(line ? { line: Number(line) - 1 } : {}), ...(e.stack ? { stack: e.stack } : {}) },
        };
      }
      const value = vm.dump(res.value);
      res.value.dispose();
      const kept = vm.unwrapResult(vm.evalCode(`(() => {
        const builtIn = new Set(${builtIn});
        const out = {};
        for (const k of Object.getOwnPropertyNames(globalThis)) {
          const v = globalThis[k];
          if (builtIn.has(k) || typeof v === "function") continue;
          try {
            const json = JSON.stringify(v);
            if (json !== undefined) out[k] = JSON.parse(json);
          } catch {}
        }
        return JSON.stringify(out);
      })()`));
      const after = JSON.parse(vm.dump(kept) as string) as Globals;
      kept.dispose();
      return { ok: true, value, globals: after };
    } catch (e) {
      if (e instanceof Abort) throw e;
      // Out of memory and similar faults surface here.
      return { ok: false, error: { name: "Error", message: e instanceof Error ? e.message : String(e) } };
    } finally {
      vm.dispose();
      rt.dispose();
    }
  }
}
