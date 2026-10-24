// The document API available to the agent's scripts as `doc.*`, implemented on the host side.
// Each operation receives JSON-decoded arguments from the sandbox and returns JSON-able data.
import type * as Y from "yjs";
import { ROOT_ID, type NodeProps, type NodeSpec, type TreeNode, type Vars } from "../doc/schema.js";
import * as store from "../doc/store.js";
import { check, type Issue } from "../layout/check.js";
import { layout, type Box, type Boxes } from "../layout/layout.js";
import { findNode } from "../render/screenshot.js";
import { FontsNeeded } from "../text/fonts.js";
import { Abort } from "../sandbox/sandbox.js";
import type { Engine } from "../engine.js";

/** Runs inside the sandbox before every script: defines `doc`, `log` and `console`. */
export const PRELUDE = `
const __call = (op, args) => JSON.parse(__host(op, JSON.stringify(args)));
const doc = Object.freeze({
  insert: (parent, node, index) => __call("insert", [parent, node, index]),
  update: (id, props) => __call("update", [id, props]),
  remove: (id) => __call("remove", [id]),
  move: (id, parent, index) => __call("move", [id, parent, index]),
  get: (id, depth) => __call("get", [id, depth]),
  find: (query) => __call("find", [query]),
  check: (id) => __call("check", [id]),
  vars: () => __call("vars", []),
  setVars: (vars) => __call("setVars", [vars]),
  page: () => __call("page", []),
  findSpace: (width, height) => __call("findSpace", [width, height]),
  screenshot: (id) => __call("screenshot", [id]),
  font: (family) => __call("font", [family]),
});
const __fmt = (a) => typeof a === "string" ? a : JSON.stringify(a);
const log = (...a) => { __call("log", [a.map(__fmt).join(" ")]); };
const console = Object.freeze({ log, info: log, warn: log, error: log });
globalThis.doc = doc; globalThis.log = log; globalThis.console = console;
`;

const GAP_BETWEEN_FRAMES = 120;

/** An optional position from the sandbox: JSON turns a left-out argument into null, which means "at the end". */
function position(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
const MAX_LOG = 4000;

function round(b: Box) {
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}

/** One script run's view of the document (a private copy until the run succeeds). */
export class ScriptSession {
  readonly refs: Record<string, string> = {};
  readonly logs: string[] = [];
  readonly screenshots: string[] = [];
  /** Nodes this run created or changed, for the automatic check afterwards. */
  readonly touched = new Set<string>();
  layoutMs = 0;
  private logSize = 0;
  private cache?: { tree: TreeNode; boxes: Boxes; vars: Vars };

  constructor(
    readonly doc: Y.Doc,
    readonly engine: Engine,
  ) {}

  private write(): void {
    this.cache = undefined;
  }

  /** The page tree and its layout, recomputed after any change. */
  measured(): { tree: TreeNode; boxes: Boxes; vars: Vars } {
    if (this.cache) return this.cache;
    const t0 = performance.now();
    const tree = store.toTree(this.doc);
    const vars = store.getVars(this.doc);
    try {
      const boxes = layout(tree, vars, this.engine.text);
      this.cache = { tree, boxes, vars };
    } catch (e) {
      if (e instanceof FontsNeeded) throw new Abort(e);
      throw e;
    } finally {
      this.layoutMs += performance.now() - t0;
    }
    return this.cache;
  }

  issuesFor(ids: Iterable<string>): Issue[] {
    const { tree, boxes, vars } = this.measured();
    const out: Issue[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (!store.exists(this.doc, id)) continue;
      for (const issue of check(tree, boxes, vars, this.engine.text, id)) {
        const k = issue.id + issue.kind + issue.message;
        if (!seen.has(k)) out.push(issue), seen.add(k);
      }
    }
    return out;
  }

  private summary(node: TreeNode, boxes: Boxes, depth: number): unknown {
    const { name, text, ...rest } = node.props;
    const box = boxes.get(node.id);
    const out: Record<string, unknown> = { id: node.id, type: node.type };
    if (name) out.name = name;
    if (text !== undefined) out.text = text.length > 120 ? text.slice(0, 117) + "…" : text;
    if (box) out.box = round(box);
    out.props = rest;
    if (node.children.length) {
      if (depth > 0) out.children = node.children.map((c) => this.summary(c, boxes, depth - 1));
      else out.childCount = node.children.length;
    }
    return out;
  }

  private topLevelOf(id: string): string {
    let cur = id;
    for (let p = store.parentOf(this.doc, cur); p && p !== ROOT_ID; p = store.parentOf(this.doc, cur)) cur = p;
    return cur;
  }

  findSpace(width: number, height: number): { x: number; y: number } {
    const { tree, boxes } = this.measured();
    let right = -Infinity;
    let top = 0;
    for (const t of tree.children) {
      const b = boxes.get(t.id);
      if (b && b.x + b.w > right) {
        right = b.x + b.w;
        top = b.y;
      }
    }
    void width;
    void height;
    return right === -Infinity ? { x: 0, y: 0 } : { x: Math.round(right + GAP_BETWEEN_FRAMES), y: Math.round(top) };
  }

  host = (op: string, args: unknown[]): unknown => {
    const doc = this.doc;
    const str = (v: unknown, what: string) => {
      if (typeof v !== "string" || !v) throw new Error(`${op}: ${what} must be a node id (a string).`);
      return v;
    };
    switch (op) {
      case "insert": {
        const parent = args[0] === null || args[0] === undefined ? ROOT_ID : str(args[0], "parent");
        const spec = args[1] as NodeSpec;
        if (parent === ROOT_ID && spec && typeof spec === "object" && spec.x === undefined && spec.y === undefined) {
          Object.assign(spec, this.findSpace(0, 0));
        }
        const id = store.insert(doc, parent, spec, position(args[2]), this.refs);
        this.touched.add(id);
        this.write();
        return id;
      }
      case "update": {
        const id = str(args[0], "id");
        store.update(doc, id, (args[1] ?? {}) as Partial<NodeProps>);
        this.touched.add(id);
        this.write();
        return null;
      }
      case "remove": {
        const id = str(args[0], "id");
        const parent = store.parentOf(doc, id);
        store.remove(doc, id);
        if (parent && parent !== ROOT_ID) this.touched.add(parent);
        this.touched.delete(id);
        this.write();
        return null;
      }
      case "move": {
        const id = str(args[0], "id");
        store.move(doc, id, args[1] == null ? ROOT_ID : str(args[1], "parent"), position(args[2]));
        this.touched.add(id);
        this.write();
        return null;
      }
      case "get": {
        const id = args[0] == null ? ROOT_ID : str(args[0], "id");
        const depth = typeof args[1] === "number" ? args[1] : 2;
        const { tree, boxes } = this.measured();
        const node = findNode(tree, id);
        if (!node) throw new Error(`get: no node with id "${id}".`);
        return this.summary(node, boxes, depth);
      }
      case "find": {
        const q = (args[0] ?? {}) as { name?: string; type?: string; text?: string; within?: string };
        const { tree } = this.measured();
        const start = q.within ? findNode(tree, q.within) : tree;
        if (!start) throw new Error(`find: no node with id "${q.within}".`);
        const hits: { id: string; type: string; name?: string; text?: string }[] = [];
        const walk = (n: TreeNode) => {
          const p = n.props;
          const ok =
            n.id !== ROOT_ID &&
            (!q.type || n.type === q.type) &&
            (!q.name || (p.name ?? "").toLowerCase().includes(q.name.toLowerCase())) &&
            (!q.text || (p.text ?? "").toLowerCase().includes(q.text.toLowerCase()));
          if (ok && (q.name || q.type || q.text)) {
            hits.push({ id: n.id, type: n.type, ...(p.name ? { name: p.name } : {}), ...(p.text ? { text: p.text.slice(0, 60) } : {}) });
          }
          n.children.forEach(walk);
        };
        walk(start);
        return hits.slice(0, 200);
      }
      case "check": {
        const id = args[0] == null ? undefined : str(args[0], "id");
        const { tree, boxes, vars } = this.measured();
        return check(tree, boxes, vars, this.engine.text, id);
      }
      case "vars":
        return store.getVars(doc);
      case "setVars": {
        store.setVars(doc, (args[0] ?? {}) as Record<string, string | number | null>);
        this.write();
        return null;
      }
      case "page": {
        const { tree, boxes } = this.measured();
        return tree.children.map((t) => ({
          id: t.id,
          ...(t.props.name ? { name: t.props.name } : {}),
          box: boxes.has(t.id) ? round(boxes.get(t.id)!) : null,
          children: t.children.length,
        }));
      }
      case "findSpace":
        return this.findSpace(Number(args[0]) || 0, Number(args[1]) || 0);
      case "screenshot": {
        const id = str(args[0], "id");
        if (!store.exists(doc, id) || id === ROOT_ID) throw new Error(`screenshot: no node with id "${id}".`);
        if (!this.screenshots.includes(id)) this.screenshots.push(id);
        if (this.screenshots.length > 4) throw new Error("screenshot: at most 4 pictures per script.");
        return "The picture will be attached to this step's result.";
      }
      case "font": {
        const family = String(args[0] ?? "");
        const styles = this.engine.fonts.styles(family);
        return styles ? { family, available: true, styles } : { family, available: false };
      }
      case "log": {
        const line = String(args[0] ?? "");
        if (this.logSize < MAX_LOG) {
          this.logs.push(line.slice(0, MAX_LOG - this.logSize));
          this.logSize += line.length;
        }
        return null;
      }
      default:
        throw new Error(`Unknown operation "${op}".`);
    }
  };

  /** Top-level frames this run touched. */
  touchedFrames(): string[] {
    return [...new Set([...this.touched].filter((id) => store.exists(this.doc, id)).map((id) => this.topLevelOf(id)))];
  }
}
