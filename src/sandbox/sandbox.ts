// The sandbox for the agent's scripts: QuickJS compiled to WebAssembly.
//
// A script sees plain JavaScript and whatever the prelude defines, nothing else: no files, network,
// processes or host objects. Its one way out is `__host(op, argsJson)`, which carries text both ways;
// the host decides what each operation does. Every script gets a fresh runtime with a memory limit
// and a time limit per statement. A script can be run whole, or statement by statement as it is
// written (`open`). Values a script leaves on the global object can be carried into a later script
// (`Globals`).
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSWASMModule } from "quickjs-emscripten";

export interface Limits {
  timeMs: number;
  memoryBytes: number;
}
export const DEFAULT_LIMITS: Limits = { timeMs: 15_000, memoryBytes: 128 * 1024 * 1024 };

/** Handles one operation from the script. Throwing an Error makes the script's call throw. */
export type Host = (op: string, args: unknown[]) => unknown;

/** Values set on the global object by earlier scripts (only data: functions don't carry over). */
export type Globals = Record<string, unknown>;

export interface ScriptError {
  name: string;
  message: string;
  line?: number;
  stack?: string;
}

export type RunResult = { ok: true; value: unknown; globals: Globals } | { ok: false; error: ScriptError };

/** One statement's outcome: an error, or whether a `return` in it ended the script (and its value). */
export type StepResult = { ok: true; returned: boolean; value?: unknown } | { ok: false; error: ScriptError };

/** Raised inside `Host` to abort the whole run and rethrow on the host side (e.g. fonts must load first). */
export class Abort extends Error {
  constructor(readonly cause: unknown) {
    super("aborted by host");
  }
}

/** A script being run statement by statement, in one runtime. Close it when done. */
export interface ScriptRun {
  /**
   * Runs one top-level statement starting at `line` of the script. With `returns` it runs inside a
   * function, so a `return` in it ends the script. Throws only for an `Abort` raised by the host.
   */
  exec(code: string, line: number, returns: boolean): StepResult;
  /** The script's global values now, without `exclude` (names the script itself declared). */
  globals(exclude?: Iterable<string>): Globals;
  close(): void;
}

export class Sandbox {
  private constructor(private qjs: QuickJSWASMModule) {}

  static async create(): Promise<Sandbox> {
    return new Sandbox(await getQuickJS());
  }

  /** Starts a script: runs `prelude` and defines `globals`, ready for its statements. */
  open(prelude: string, host: Host, limits: Limits = DEFAULT_LIMITS, globals: Globals = {}): ScriptRun {
    const rt = this.qjs.newRuntime();
    rt.setMemoryLimit(limits.memoryBytes);
    rt.setMaxStackSize(1024 * 1024);
    const vm = rt.newContext();
    let aborted: Abort | undefined;
    const close = () => {
      vm.dispose();
      rt.dispose();
    };
    const evalValue = (code: string): unknown => {
      const h = vm.unwrapResult(vm.evalCode(code));
      const v = vm.dump(h);
      h.dispose();
      return v;
    };
    let builtIn: string;
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
          return { error: vm.newError(e instanceof Error ? e.message : String(e)) };
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
      // `__more` marks a statement that ran to its end without returning.
      evalValue(`globalThis.__more = {}; globalThis.__ret = undefined;`);
      builtIn = evalValue(`JSON.stringify(Object.getOwnPropertyNames(globalThis))`) as string;
      evalValue(`Object.assign(globalThis, JSON.parse(${JSON.stringify(JSON.stringify(globals))})), 0`);
    } catch (e) {
      close();
      throw e;
    }

    return {
      exec(code, line, returns) {
        rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeMs));
        // Padding puts the statement on its own line numbers in the script.
        const pad = "\n".repeat(line - 1);
        const src = returns
          ? `${pad}__ret = (() => {${code}\nreturn __more; })(); __ret === __more ? { returned: false } : { returned: true, value: __ret };`
          : `${pad}${code}\n;void 0;`;
        try {
          const res = vm.evalCode(src, "script.js");
          if (aborted) {
            (res.error ?? res.value).dispose();
            throw aborted;
          }
          if (res.error) return { ok: false, error: describe(vm, res.error, limits) };
          const out = returns ? (vm.dump(res.value) as { returned: boolean; value?: unknown }) : { returned: false };
          res.value.dispose();
          return { ok: true, ...out };
        } catch (e) {
          if (e instanceof Abort) throw e;
          // Out of memory and similar faults surface here.
          return { ok: false, error: { name: "Error", message: e instanceof Error ? e.message : String(e) } };
        }
      },
      globals(exclude = []) {
        const kept = evalValue(`(() => {
          const skip = new Set([...${builtIn}, ...${JSON.stringify([...exclude])}]);
          const out = {};
          for (const k of Object.getOwnPropertyNames(globalThis)) {
            const v = globalThis[k];
            if (skip.has(k) || typeof v === "function") continue;
            try {
              const json = JSON.stringify(v);
              if (json !== undefined) out[k] = JSON.parse(json);
            } catch {}
          }
          return JSON.stringify(out);
        })()`) as string;
        return JSON.parse(kept) as Globals;
      },
      close,
    };
  }

  /**
   * Runs `prelude` then `script` (as a function body, so `return` gives the result). Throws only for
   * an `Abort` raised by the host; script errors come back as `{ ok: false }`. `globals` are defined
   * before the script runs; the result has them as the script left them, with any it added.
   */
  run(prelude: string, script: string, host: Host, limits: Limits = DEFAULT_LIMITS, globals: Globals = {}): RunResult {
    const s = this.open(prelude, host, limits, globals);
    try {
      const r = s.exec(script, 1, true);
      if (!r.ok) return r;
      try {
        return { ok: true, value: r.value, globals: s.globals() };
      } catch (e) {
        return { ok: false, error: { name: "Error", message: e instanceof Error ? e.message : String(e) } };
      }
    } finally {
      s.close();
    }
  }
}

function describe(vm: QuickJSContext, handle: Parameters<QuickJSContext["dump"]>[0], limits: Limits): ScriptError {
  const e = vm.dump(handle) as { name?: string; message?: string; stack?: string } | string;
  handle.dispose();
  if (typeof e !== "object" || e === null) return { name: "Error", message: String(e) };
  const line = /script\.js:(\d+)/.exec(e.stack ?? "")?.[1];
  const name = e.name ?? "Error";
  const message =
    name === "InternalError" && e.message === "interrupted" ? `The script ran longer than ${limits.timeMs / 1000}s and was stopped.` : (e.message ?? String(e));
  return { name, message, ...(line ? { line: Number(line) } : {}), ...(e.stack ? { stack: e.stack } : {}) };
}
