// Splitting the agent's script into top-level statements while the model is still writing it, so
// each statement can run as soon as it is complete (the person sees each element appear as it is
// written, the way a designer places them one by one).
import { parse, tokenizer, tokTypes as tt, type ModuleDeclaration, type Node, type Program, type Statement as Plain } from "acorn";

type Statement = Plain | ModuleDeclaration;

export interface Piece {
  /** Where the statement starts and ends in the script. */
  start: number;
  end: number;
  /** The statement's first line in the script (1-based), for error line numbers. */
  line: number;
  /** It has a `return` that ends the script (outside any function in it). */
  returns: boolean;
  /** Names it declares with `var` or `function`: they belong to the script, not to later scripts. */
  declares: string[];
}

const OPTIONS = { ecmaVersion: "latest", allowReturnOutsideFunction: true, locations: true } as const;
/** Text after an expression that would carry it on rather than start a new statement. */
const CONTINUES = /^(?:[.([?:,+\-*/%&|^=<>!`]|in\b|instanceof\b)/;
const FUNCTION = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression"]);

/** Every `return` and `var` reached without entering a function. */
function scan(node: Node, out: { returns: boolean; vars: string[] }): void {
  if (node.type === "ReturnStatement") out.returns = true;
  if (node.type === "VariableDeclaration" && (node as { kind?: string }).kind === "var") {
    for (const d of (node as unknown as { declarations: { id: Node }[] }).declarations) names(d.id, out.vars);
  }
  for (const v of Object.values(node)) {
    for (const child of Array.isArray(v) ? v : [v]) {
      if (child && typeof child === "object" && typeof (child as Node).type === "string" && !FUNCTION.has((child as Node).type)) {
        scan(child as Node, out);
      }
    }
  }
}

/** The names a binding pattern declares. */
function names(p: Node, out: string[]): void {
  const n = p as unknown as { type: string; name?: string; properties?: { value?: Node; argument?: Node }[]; elements?: (Node | null)[]; left?: Node; argument?: Node };
  if (n.type === "Identifier") out.push(n.name!);
  else if (n.type === "ObjectPattern") n.properties!.forEach((q) => names((q.value ?? q.argument)!, out));
  else if (n.type === "ArrayPattern") n.elements!.forEach((e) => e && names(e, out));
  else if (n.type === "AssignmentPattern") names(n.left!, out);
  else if (n.type === "RestElement") names(n.argument!, out);
}

function piece(s: Statement, offset: number, lineOffset: number): Piece {
  const out = { returns: false, vars: [] as string[] };
  scan(s, out);
  if (s.type === "FunctionDeclaration" && s.id) out.vars.push(s.id.name);
  return { start: offset + s.start, end: offset + s.end, line: lineOffset + s.loc!.start.line, returns: out.returns, declares: out.vars };
}

/** Places in `text` where a top-level statement may end: after `;`, a closing `}` or a line at depth 0. */
function cutPoints(text: string): number[] {
  const cuts: number[] = [];
  let depth = 0;
  let prevEnd = -1;
  try {
    for (const t of tokenizer(text, OPTIONS)) {
      if (depth === 0 && prevEnd >= 0 && cuts.at(-1) !== prevEnd && text.slice(prevEnd, t.start).includes("\n")) cuts.push(prevEnd);
      prevEnd = t.end;
      if (t.type === tt.braceL || t.type === tt.dollarBraceL || t.type === tt.parenL || t.type === tt.bracketL) depth++;
      else if (t.type === tt.braceR || t.type === tt.parenR || t.type === tt.bracketR) {
        depth--;
        if (depth === 0 && t.type === tt.braceR) cuts.push(t.end);
      } else if (t.type === tt.semi && depth === 0) cuts.push(t.end);
    }
  } catch {
    // The text is cut off mid-token (an unfinished string, say): the cuts so far stand.
  }
  return cuts;
}

/** Whether the last statement of a parse can't be carried on by what comes after it. */
function closed(s: Statement, text: string, after: string): boolean {
  const next = after.trimStart();
  // A word still being written may yet become `else`, `in` or `instanceof`.
  if (next === "" || ["else", "in", "instanceof"].some((w) => w.startsWith(next))) return text[s.end - 1] === ";" && s.type !== "IfStatement";
  if (s.type === "IfStatement" && !s.alternate) return !/^else\b/.test(next);
  if (text[s.end - 1] === ";") return true;
  if (s.type === "ExpressionStatement" || s.type === "VariableDeclaration" || s.type === "ReturnStatement" || s.type === "ThrowStatement") {
    return !CONTINUES.test(next);
  }
  return true; // blocks, loops, functions, try: nothing can extend them once they parse
}

/**
 * The complete statements in `text` (a script being written, read from `from`). With `final` the
 * script is finished and everything left is returned; a syntax error is thrown as a SyntaxError
 * with the script's line number.
 */
export function statements(text: string, from: number, final: boolean): Piece[] {
  const rest = text.slice(from);
  const lineOffset = text.slice(0, from).split("\n").length - 1;
  if (final) {
    let program: Program;
    try {
      program = parse(rest, OPTIONS);
    } catch (e) {
      const loc = (e as { loc?: { line: number } }).loc;
      const err = new SyntaxError((e as Error).message.replace(/\s*\(\d+:\d+\)$/, ""));
      (err as SyntaxError & { line?: number }).line = loc ? lineOffset + loc.line : undefined;
      throw err;
    }
    return program.body.map((s) => piece(s, from, lineOffset));
  }
  // The longest prefix that parses; the text after it is still being written.
  const cuts = cutPoints(rest);
  for (let i = cuts.length - 1; i >= Math.max(0, cuts.length - 4); i--) {
    let program: Program;
    try {
      program = parse(rest.slice(0, cuts[i]), OPTIONS);
    } catch {
      continue;
    }
    const body = program.body;
    const last = body.at(-1);
    if (last && !closed(last, rest, rest.slice(last.end))) body.pop();
    return body.map((s) => piece(s, from, lineOffset));
  }
  return [];
}
