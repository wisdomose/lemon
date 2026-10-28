// Script nodes, as in Pen: a script node names a .js file beside the design file; the script gets
// `pencil.width`, `pencil.height` and its inputs (`pencil.input.<name>`, declared with `@input` in the
// header) and returns nodes, which are drawn inside the script node. Scripts run here, in the agent's
// QuickJS sandbox (no files, network or host), again whenever the file, the node's size or its inputs
// change. Math.random is seeded, so a script draws the same way every time.
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { WebContents } from "electron";
import * as Y from "yjs";
import * as docStore from "../doc/store.js";
import type { Sandbox } from "../sandbox/sandbox.js";

/** An input a script declares: `@input name: type [= default]`. */
export interface ScriptInput {
  name: string;
  type: "number" | "string" | "boolean" | "color" | "ref" | "enum";
  default?: string | number | boolean;
  /** An enum's choices. */
  options?: string[];
}

/** What a script node shows: what the script returned, or why it couldn't run. */
export type ScriptOutput =
  | { ok: true; nodes: Record<string, unknown>[]; inputs: ScriptInput[] }
  | { ok: false; kind: "missing"; file: string }
  | { ok: false; kind: "error"; title: string; message: string; stack: string[]; excerpt: { line: number; text: string; at: boolean }[]; inputs: ScriptInput[] };

/** How long a script may run, and how much memory it may use. */
const LIMITS = { timeMs: 5_000, memoryBytes: 64 * 1024 * 1024 };

/**
 * A seeded Math.random, so a script's "random" output is the same on every run: mulberry32 from 0,
 * which gives the bar widths Pen draws for the same script (measured to the pixel).
 */
const PRELUDE = `Math.random = (() => {
  let s = 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();`;

/** The inputs a script's header declares. */
export function scriptInputs(header: string): ScriptInput[] {
  const out: ScriptInput[] = [];
  for (const m of header.matchAll(/@input\s+([A-Za-z_$][\w$]*)\s*:\s*(number|string|boolean|color|ref|enum\(([^)]*)\))\s*(?:=\s*(.+?))?\s*$/gm)) {
    const [, name, typeText, enumList, raw] = m;
    const type = (typeText!.startsWith("enum") ? "enum" : typeText) as ScriptInput["type"];
    const input: ScriptInput = { name: name!, type };
    if (enumList !== undefined) input.options = [...enumList.matchAll(/"([^"]*)"|'([^']*)'/g)].map((o) => o[1] ?? o[2] ?? "");
    if (raw !== undefined) {
      const text = raw.trim();
      const quoted = /^"(.*)"$|^'(.*)'$/.exec(text);
      input.default =
        type === "number" ? Number(text) : type === "boolean" ? text === "true" : quoted ? (quoted[1] ?? quoted[2] ?? "") : text;
    }
    out.push(input);
  }
  return out;
}

/** Defaults for what an input type gets when nothing is given. */
const BLANK: Record<ScriptInput["type"], string | number | boolean> = { number: 0, string: "", boolean: false, color: "#000000", ref: "", enum: "" };

/** Runs one script file for a node of size `width` × `height` with the node's `given` inputs. */
export function runScript(sandbox: Sandbox, path: string, width: number, height: number, given: Record<string, unknown>): ScriptOutput {
  const file = basename(path);
  if (!existsSync(path)) return { ok: false, kind: "missing", file };
  const source = readFileSync(path, "utf8");
  const header = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? "";
  const inputs = scriptInputs(header);
  const fail = (title: string, message: string, stack: string[] = [], line?: number): ScriptOutput => {
    const lines = source.split("\n");
    const excerpt = line
      ? lines.slice(Math.max(0, line - 3), Math.min(lines.length, line + 2)).map((text, i) => {
          const n = Math.max(1, line - 2) + i;
          return { line: n, text: text.replace(/\r$/, ""), at: n === line };
        })
      : [];
    return { ok: false, kind: "error", title, message, stack, excerpt, inputs };
  };
  if (!/@schema\s+\d/.test(header)) return fail("Script error", "Every script must start with a /** @schema 2.11 */ comment.");
  const input: Record<string, unknown> = {};
  for (const i of inputs) input[i.name] = given[i.name] ?? i.default ?? (i.type === "enum" ? (i.options?.[0] ?? "") : BLANK[i.type]);
  const pencil = { width, height, input };
  const result = sandbox.run(
    PRELUDE,
    source,
    () => {
      throw new Error("Scripts have no host to call.");
    },
    LIMITS,
    { pencil },
  );
  if (!result.ok) {
    const e = result.error;
    const stack = (e.stack ?? "")
      .split("\n")
      .map((l) => l.trim().replaceAll("script.js", file))
      .filter((l) => l.startsWith("at ") && !l.includes("<eval>"));
    return fail("Script runtime error", `${e.name}: ${e.message}`, stack, e.line);
  }
  const nodes = result.value;
  if (!Array.isArray(nodes)) return fail("Script error", "A script must return an array of nodes.");
  const valid = nodes.filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && typeof (n as { type?: unknown }).type === "string");
  return { ok: true, nodes: valid, inputs };
}

/** The script nodes of one file: runs them as they change and tells the file's tab what they show. */
export class Scripts {
  /** What each node was last run with, so it runs again only when that changes. */
  private ran = new Map<string, string>();
  private outputs = new Map<string, ScriptOutput>();
  private watchers = new Map<string, FSWatcher>();
  private again: NodeJS.Timeout | undefined;

  constructor(
    private readonly doc: Y.Doc,
    private readonly sandbox: Sandbox,
    /** The design file (scripts sit beside it); none for a new file. */
    private readonly file: () => string | null,
    private readonly tab: () => WebContents | undefined,
  ) {}

  /** Runs the script nodes whose file, size or inputs changed (all of them with `force`). */
  sync(force = false): void {
    const seen = new Set<string>();
    const home = this.file();
    for (const [id, rec] of docStore.nodesOf(this.doc)) {
      if (rec.get("type") !== "script") continue;
      const uri = rec.get("scriptUri");
      if (typeof uri !== "string" || !uri.trim()) continue;
      seen.add(id);
      const path = home ? resolve(dirname(home), uri.trim()) : null;
      const size = (v: unknown) => (typeof v === "number" && v > 0 ? v : 200);
      const width = size(rec.get("width"));
      const height = size(rec.get("height"));
      const inputs = (rec.get("inputs") as Record<string, unknown> | undefined) ?? {};
      const stamp = path && existsSync(path) ? statSync(path).mtimeMs : -1;
      const key = JSON.stringify([path, stamp, width, height, inputs]);
      if (!force && this.ran.get(id) === key) continue;
      this.ran.set(id, key);
      const out: ScriptOutput = path ? runScript(this.sandbox, path, width, height, inputs) : { ok: false, kind: "missing", file: basename(uri) };
      this.outputs.set(id, out);
      this.send(id, out);
      if (path) this.watch(path);
    }
    for (const id of [...this.outputs.keys()]) {
      if (seen.has(id)) continue;
      this.outputs.delete(id);
      this.ran.delete(id);
      this.send(id, null);
    }
  }

  /** The tab (re)loaded: it learns every output again. */
  resend(): void {
    for (const [id, out] of this.outputs) this.send(id, out);
  }

  /** A script file changed on disk: its nodes run again. */
  private watch(path: string): void {
    if (this.watchers.has(path)) return;
    try {
      const w = watch(path, () => {
        clearTimeout(this.again);
        this.again = setTimeout(() => this.sync(), 100);
      });
      this.watchers.set(path, w);
    } catch {
      // A file that can't be watched still runs when the node changes.
    }
  }

  private send(id: string, out: ScriptOutput | null): void {
    const tab = this.tab();
    if (tab && !tab.isDestroyed()) tab.send("script:output", id, out);
  }

  dispose(): void {
    clearTimeout(this.again);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
