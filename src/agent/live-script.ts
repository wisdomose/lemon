// Reading the agent's script while the model is still writing it, so the window can show where the
// agent is about to work before the step lands (the cursor goes there; the step card appears).
// Nothing here runs the script: it only reads text, and tolerates text cut off at any point.
import { ROOT_ID } from "../doc/schema.js";

/**
 * Where the agent is about to work: on a node, or adding into a parent (the page is ROOT_ID) — at
 * `index` or at the end, or at `at` (the new node's x/y in the parent) when the script gives one.
 */
export type Target = { id: string } | { parent: string; index?: number; at?: { x: number; y: number } };

/**
 * The value of a string field in a JSON object that may be cut off anywhere (the tool call's input
 * as it streams), and whether the string is complete. Undefined until the field's value has begun.
 */
export function partialField(json: string, field: string): { value: string; done: boolean } | undefined {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!m) return undefined;
  let value = "";
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i]!;
    if (c === '"') return { value, done: true };
    if (c !== "\\") {
      value += c;
      continue;
    }
    const e = json[i + 1];
    if (e === undefined) break;
    if (e === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      value += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      value += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e;
      i++;
    }
  }
  return { value, done: false };
}

/** Pen's calls that work on a node: Insert and Copy add into their parent (Copy's second argument). */
const CALL = /\b(Insert|Copy|Update|Replace|Move|Delete)\(\s*/g;
const ASSIGN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`\\\n]*)\2/g;
const IDENT = /^[A-Za-z_$][\w$]*/;
const POS_X = /[{,\s]x\s*:\s*(-?\d+(?:\.\d+)?)\b/;
const POS_Y = /[{,\s]y\s*:\s*(-?\d+(?:\.\d+)?)\b/;

/** The literal or variable at `at` in `src`, resolved to a string, `null` for the page, undefined if unknown. */
function argAt(src: string, at: number, names: Map<string, string>): string | null | undefined {
  const q = src[at];
  if (q === '"' || q === "'" || q === "`") {
    const end = src.indexOf(q, at + 1);
    return end < 0 ? undefined : src.slice(at + 1, end);
  }
  const ident = IDENT.exec(src.slice(at))?.[0];
  if (ident === "null" || ident === "undefined") return null;
  return ident ? names.get(ident) : undefined;
}

/** The call whose arguments start at `at`: its last argument and where it ends, if it is complete. */
function callEnd(src: string, at: number): { last: string; end: number } | undefined {
  let depth = 0;
  let start = at;
  for (let i = at; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) return undefined;
      i = end;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ")") {
      if (depth === 0) return { last: src.slice(start, i).trim(), end: i };
      depth--;
    } else if (c === "," && depth === 0) start = i + 1;
  }
  return undefined;
}

/**
 * Where a (possibly unfinished) script will work next: the last change it writes to a node that
 * already exists (`exists`). Ids come from string literals, or from variables set to one — in the
 * script, or kept from earlier scripts (`globals`).
 */
export function scriptTarget(script: string, exists: (id: string) => boolean, globals: Record<string, unknown> = {}): Target | undefined {
  const names = new Map<string, string>([["document", ROOT_ID]]);
  for (const [k, v] of Object.entries(globals)) if (typeof v === "string") names.set(k, v);
  for (const m of script.matchAll(ASSIGN)) names.set(m[1]!, m[3]!);
  let target: Target | undefined;
  for (const m of script.matchAll(CALL)) {
    const at = m.index + m[0].length;
    let arg = argAt(script, at, names);
    if (m[1] === "Copy") {
      // Copy(path, parent, …): it adds into the parent.
      const comma = script.indexOf(",", at);
      if (comma < 0) continue;
      arg = argAt(script, script.slice(comma + 1).search(/\S/) + comma + 1, names);
    }
    if (m[1] === "Insert" || m[1] === "Copy") {
      if (arg === undefined && script[at] !== ")") continue;
      const parent = arg ?? ROOT_ID;
      if (parent !== ROOT_ID && !exists(parent)) continue;
      const call = callEnd(script, at);
      const index = call && /^\d+$/.test(call.last) ? Number(call.last) : undefined;
      // The new node's own x/y come before its children (as the API's examples write them).
      const spec = script.slice(at, call?.end ?? script.length).split(/\bchildren\s*:/)[0]!;
      const x = POS_X.exec(spec)?.[1];
      const y = POS_Y.exec(spec)?.[1];
      target = { parent, ...(index !== undefined ? { index } : {}), ...(x && y ? { at: { x: Number(x), y: Number(y) } } : {}) };
    } else if (arg && exists(arg)) target = { id: arg };
  }
  return target;
}
