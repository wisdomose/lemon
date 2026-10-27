// The document API the agent's scripts use: Pen's execute API, over .pen nodes (doc/schema.ts):
// Insert, Copy, Update, Replace, Move, Delete, Get, SetVariables, GetVariables, FindEmptySpace,
// Print and TakeScreenshot, with `document` naming the document itself; plus Check (the automatic
// layout check) and Font (whether a Google Fonts family exists). Implemented on the host side: each
// operation receives JSON-decoded arguments from the sandbox and returns JSON-able data. `Get` with a
// visitor runs the visitor in the sandbox over a subtree the host reads out.
import type * as Y from "yjs";
import { ROOT_ID, canHaveChildren, type Descendants, type NodeProps, type PenNode, type TreeNode, type VariableDef, type Vars } from "../doc/schema.js";
import * as store from "../doc/store.js";
import { nodeAsPen } from "../doc/file.js";
import type { Touched } from "../doc/live.js";
import { resolveOr, withTheme } from "../doc/values.js";
import { check, type Issue } from "../layout/check.js";
import { layout, type Box, type Boxes } from "../layout/layout.js";
import { GAP_BETWEEN_FRAMES } from "../layout/space.js";
import { findNode } from "../render/screenshot.js";
import { hasIcon } from "../render/icons.js";
import { FontsNeeded } from "../text/fonts.js";
import { Abort } from "../sandbox/sandbox.js";
import type { Engine } from "../engine.js";

/** Runs inside the sandbox before every script: defines Pen's functions, `document`, Print and console. */
export const PRELUDE = `
const __call = (op, args) => JSON.parse(__host(op, JSON.stringify(args === undefined ? [] : args)));
const __id = (v, what) => {
  if (v && typeof v === "object" && typeof v.id === "string") throw new Error(what + " must be an id string, not a node object: pass its .id.");
  return v;
};
const __fmt = (a) => typeof a === "string" ? a : JSON.stringify(a);
const __visit = (tree, visit) => {
  const out = [];
  const go = (n, parentCtx, depth, index) => {
    const { __bounds, __problems, ...node } = n;
    const kids = Array.isArray(node.children) ? node.children : [];
    let skip = false;
    const ctx = { node, parentCtx, depth, index, bounds: __bounds, skipChildren() { skip = true; } };
    if (__problems) ctx.problems = __problems;
    const view = { ...node };
    if (kids.length) view.children = kids.map(({ __bounds, __problems, ...c }) => c);
    ctx.node = view;
    const r = visit(view, ctx);
    if (r !== undefined) out.push(r);
    if (!skip) kids.forEach((c, i) => go(c, ctx, depth + 1, i));
  };
  go(tree, undefined, 0, 0);
  return out;
};
const __strip = (n) => {
  const { __bounds, __problems, ...node } = n;
  if (Array.isArray(node.children)) node.children = node.children.map(__strip);
  return node;
};
globalThis.document = "document";
globalThis.Insert = (parent, node) => __call("insert", [__id(parent, "Insert's parent"), node]);
globalThis.Copy = (path, parent, data) => __call("copy", [__id(path, "Copy's path"), __id(parent, "Copy's parent"), data]);
globalThis.Update = (path, data) => __call("update", [__id(path, "Update's path"), data]);
globalThis.Replace = (path, node) => __call("replace", [__id(path, "Replace's path"), node]);
globalThis.Move = (path, parent, index) => __call("move", [__id(path, "Move's path"), parent === undefined ? null : __id(parent, "Move's parent"), index]);
globalThis.Delete = (path) => __call("delete", [__id(path, "Delete's path")]);
globalThis.Get = (...args) => {
  let path = "document", visit, options = {};
  for (const a of args) {
    if (typeof a === "string") path = a;
    else if (typeof a === "function") visit = a;
    else if (a && typeof a === "object") options = a;
  }
  if (!visit && args.every((a) => typeof a !== "string")) throw new Error("Get needs a node id, a visitor, or both: Get(id), Get(id, visit), Get(visit).");
  const tree = __call("read", [path, options, !!visit]);
  if (visit) return __visit(tree, visit);
  return __strip(tree);
};
globalThis.SetVariables = (variables, replace) => { __call("setVariables", [variables, !!replace]); };
globalThis.GetVariables = () => __call("getVariables", []);
globalThis.FindEmptySpace = (input) => __call("findEmptySpace", [input || {}]);
globalThis.TakeScreenshot = (ids) => { __call("screenshot", [Array.isArray(ids) ? ids : [ids]]); };
globalThis.Check = (id) => __call("check", [id === undefined ? null : id]);
globalThis.Font = (family) => __call("font", [family]);
globalThis.Print = (...a) => { __call("print", [a.map(__fmt).join(" ")]); };
globalThis.console = Object.freeze({ log: Print, info: Print, warn: Print, error: Print });
`;

/** Refuses an icon name Lucide or Feather doesn't have, so the agent picks another rather than leaving a blank. */
function requireIcon(props: Partial<NodeProps> | undefined): void {
  const name = props?.icon;
  const library = String(props?.library ?? "lucide").toLowerCase();
  if (typeof name === "string" && !name.startsWith("$") && (library === "lucide" || library === "feather") && !hasIcon(name, library)) {
    const which = library === "feather" ? "Feather" : "Lucide";
    throw new Error(`There is no ${which} icon "${name}". Use a ${which} name in kebab case, such as "arrow-right" or "home".`);
  }
}

/** Refuses what Pen doesn't support, with the way to do it instead. */
function requireSupported(node: Partial<PenNode>): void {
  for (const k of ["margin", "alignSelf"]) if (k in node) throw new Error(`\`${k}\` isn't supported; use the parent's padding, gap and alignItems, or a wrapping frame.`);
  if (node.alignItems && !["start", "center", "end"].includes(node.alignItems)) throw new Error(`alignItems "${node.alignItems}" isn't supported: use "start", "center" or "end" (fill_container on the child to stretch it).`);
  for (const k of ["width", "height"] as const) {
    const v = node[k];
    if (typeof v === "string" && /%|vh|vw|calc/.test(v)) throw new Error(`${k} "${v}": percentages and CSS units aren't supported; use pixels, "fill_container" or "fit_content".`);
  }
  if (node.type && !canHaveChildren(node.type) && ("layout" in node || "padding" in node)) {
    throw new Error(`\`layout\` and \`padding\` are for frames only, not a ${node.type}; wrap it in a frame.`);
  }
  requireIcon(node);
}

/** An optional position from the sandbox: JSON turns a left-out argument into null, which means "at the end". */
function position(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
const MAX_LOG = 4000;

const round = (n: number) => Math.round(n * 100) / 100;

/** One script's view of the document, while its statements land on it. */
export class ScriptSession {
  /** Nodes this run made, with their names, for the agent's result (Pen returns names → ids). */
  readonly created: { id: string; name?: string; type: string }[] = [];
  readonly logs: string[] = [];
  readonly screenshots: string[] = [];
  /** Nodes this run created or changed, for the automatic check afterwards. */
  readonly touched = new Set<string>();
  /** The element the script is working on, where the agent's cursor goes (see `aimAt`). */
  working?: { id: string; created: boolean };
  layoutMs = 0;
  private logSize = 0;
  private cache?: { tree: TreeNode; boxes: Boxes; vars: Vars };

  /** Changes left out because a person just made them (rule b in doc/live.ts), for the agent's report. */
  readonly leftAlone: string[] = [];

  constructor(
    readonly doc: Y.Doc,
    readonly engine: Engine,
    /** Properties people changed since this agent last reported back: not to be overwritten. */
    private protect: Touched = new Map(),
  ) {}

  /** Forgets the measured layout (the document changed, or fonts it needed have loaded). */
  write(): void {
    this.cache = undefined;
  }

  private touch(id: string): void {
    this.touched.add(id);
  }

  private made(id: string, node: Partial<PenNode>): void {
    this.created.push({ id, type: String(node.type ?? store.typeOf(this.doc, id)), ...(node.name ? { name: node.name } : {}) });
    this.touch(id);
    this.aimAt(id, true);
    this.write();
  }

  /**
   * The cursor follows what is being placed: new elements, and changes to an element — but not changes
   * to the frames around the element being worked on, nor the `placeholder` mark.
   */
  private aimAt(id: string, created: boolean, keys: string[] = []): void {
    if (!created) {
      if (keys.length && keys.every((k) => k === "placeholder")) return;
      for (let n = this.working?.id; n && n !== ROOT_ID; n = store.parentOf(this.doc, n)) if (n === id) return;
    }
    this.working = { id, created };
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

  private topLevelOf(id: string): string {
    let cur = id;
    for (let p = store.parentOf(this.doc, cur); p && p !== ROOT_ID; p = store.parentOf(this.doc, cur)) cur = p;
    return cur;
  }

  /** Pen's FindEmptySpace: a free spot of the given size, beside `nodeId` (or everything) in `direction`. */
  findEmptySpace(input: { width?: number; height?: number; direction?: string; padding?: number; nodeId?: string }): { x: number; y: number; parentId?: string } {
    const { tree, boxes } = this.measured();
    const w = Number(input.width) || 0;
    const h = Number(input.height) || 0;
    const pad = Number(input.padding) || GAP_BETWEEN_FRAMES;
    const dir = input.direction ?? "right";
    const anchorBox = input.nodeId ? boxes.get(input.nodeId) : undefined;
    const tops = tree.children.map((t) => boxes.get(t.id)).filter((b): b is Box => !!b);
    if (!tops.length) return { x: 0, y: 0 };
    const all = anchorBox ? [anchorBox] : tops;
    const x0 = Math.min(...all.map((b) => b.x));
    const y0 = Math.min(...all.map((b) => b.y));
    const x1 = Math.max(...all.map((b) => b.x + b.w));
    const y1 = Math.max(...all.map((b) => b.y + b.h));
    const free = (x: number, y: number) => !tops.some((b) => x < b.x + b.w + pad && x + w + pad > b.x && y < b.y + b.h + pad && y + h + pad > b.y);
    let spot = { x: 0, y: 0 };
    for (let step = 0; step < 200; step++) {
      const d = step * 40;
      spot =
        dir === "left" ? { x: x0 - pad - w - d, y: y0 } : dir === "top" ? { x: x0, y: y0 - pad - h - d } : dir === "bottom" ? { x: x0, y: y1 + pad + d } : { x: x1 + pad + d, y: y0 };
      if (free(spot.x, spot.y)) break;
    }
    return { x: Math.round(spot.x), y: Math.round(spot.y) };
  }

  /** Reads a node (and its subtree) as Pen nodes for Get, with each node's bounds and problems. */
  private read(path: string, o: { depth?: number; resolveVariables?: boolean; resolveInstances?: boolean; includePathGeometry?: boolean }, visiting: boolean): unknown {
    // Without a visitor only `depth` levels are wanted (deeper children read as "..."): don't read past them.
    const maxDepth = visiting ? Infinity : typeof o.depth === "number" ? o.depth : 3;
    const { tree, boxes, vars } = this.measured();
    const doc = this.doc;
    const start = findNode(tree, path);
    if (!start) throw new Error(`Get: no node "${path}".`);
    const resolveIn = (v: unknown, vs: Vars): unknown => {
      if (typeof v === "string" && v.startsWith("$")) return resolveOr(v, vs, v);
      if (Array.isArray(v)) return v.map((x) => resolveIn(x, vs));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveIn(x, vs)]));
      return v;
    };
    const bounds = (id: string, parent?: string) => {
      const b = boxes.get(id);
      if (!b) return undefined;
      const p = parent ? boxes.get(parent) : undefined;
      return { x: round(b.x - (p?.x ?? 0)), y: round(b.y - (p?.y ?? 0)), width: round(b.w), height: round(b.h) };
    };
    const problems = (id: string, parent?: string) => {
      const b = boxes.get(id);
      const p = parent && parent !== ROOT_ID ? boxes.get(parent) : undefined;
      if (!b || !p) return undefined;
      const fully = b.x >= p.x + p.w || b.y >= p.y + p.h || b.x + b.w <= p.x || b.y + b.h <= p.y;
      if (fully) return "fully clipped";
      const e = 0.5;
      return b.x < p.x - e || b.y < p.y - e || b.x + b.w > p.x + p.w + e || b.y + b.h > p.y + p.h + e ? "partially clipped" : undefined;
    };
    /** A node as Pen data: a ref as a ref (unless instances are resolved), with its subtree. */
    const asPen = (n: TreeNode, parent: string | undefined, vs: Vars, depth = 0): Record<string, unknown> => {
      vs = withTheme(vs, n.props.theme);
      let node: Record<string, unknown>;
      if (n.instance && !o.resolveInstances) {
        // An instance reads as its ref: its own properties, changes, fills and replacements.
        const isRecord = !store.isPart(n.id) && store.nodesOf(doc).has(n.id);
        node = isRecord ? { ...store.refAsPen(doc, n.id, (c) => nodeAsPen(doc, c)) } : { type: "ref", id: n.id, ref: n.instance };
      } else {
        node = { type: n.type, id: n.id, ...n.props };
        if (n.instance) node.instanceOf = n.instance;
        if (n.children.length) node.children = depth >= maxDepth ? "..." : n.children.map((c) => asPen(c, n.id, vs, depth + 1));
      }
      if (o.resolveVariables) for (const [k, v] of Object.entries(node)) if (k !== "children" && k !== "id" && k !== "type") node[k] = resolveIn(v, vs);
      if (!o.includePathGeometry && node.type === "path" && typeof node.geometry === "string" && node.geometry.length > 80) node.geometry = "…";
      const b = bounds(n.id, parent);
      if (b) node.__bounds = b;
      const pr = problems(n.id, parent);
      if (pr) node.__problems = pr;
      return node;
    };
    const parent = path === ROOT_ID ? undefined : store.parentOf(doc, path);
    const startVars = path === ROOT_ID ? vars : themedAt(tree, path, vars);
    const out = asPen(start, parent, startVars);
    if (path === ROOT_ID) {
      out.type = "document";
      delete out.layout;
    }
    return out;
  }

  /** Resolves `descendants` keys given as unique names inside the component (or copied node) to id paths. */
  private descendantIds(rootId: string, d: Descendants | undefined): Descendants | undefined {
    if (!d) return undefined;
    const { tree } = this.measured();
    const root = findNode(tree, rootId);
    const byName = new Map<string, string[]>();
    const walk = (n: TreeNode) => {
      for (const c of n.children) {
        const path = c.id.startsWith(rootId + "/") ? c.id.slice(rootId.length + 1) : c.id;
        if (c.props.name) byName.set(c.props.name, [...(byName.get(c.props.name) ?? []), path]);
        walk(c);
      }
    };
    if (root) walk(root);
    const out: Descendants = {};
    for (const [k, v] of Object.entries(d)) {
      const ids = byName.get(k);
      if (root && !findNode(root, `${rootId}/${k}`) && !findNode(root, k) && ids) {
        if (ids.length > 1) throw new Error(`descendants: "${k}" names ${ids.length} nodes; use its id path instead.`);
        out[ids[0]!] = v;
      } else out[k] = v;
    }
    return out;
  }

  /** Applies one `descendants` entry to the node `target`: a replacement (with `type`), or changes and what fills it. */
  private applyEntry(target: string, entry: Partial<PenNode>): void {
    if (!entry || typeof entry !== "object") return;
    if (typeof entry.type === "string") {
      store.replace(this.doc, target, entry as PenNode);
      return;
    }
    const { children, ...props } = entry;
    if (Object.keys(props).length) store.update(this.doc, target, props as Partial<NodeProps>);
    if (Array.isArray(children)) for (const c of children) store.insert(this.doc, target, c as PenNode);
  }

  /** Applies a `descendants` map to an instance (paths inside it) or an ordinary node (ids inside it). */
  private applyDescendants(id: string, d: Descendants): void {
    const instance = store.isInstance(this.doc, id);
    for (const [path, entry] of Object.entries(d)) this.applyEntry(instance ? `${id}/${path}` : path, entry);
  }

  /** The node at `path` as Pen data with fresh ids throughout (for Copy). */
  private copyable(path: string): PenNode {
    const doc = this.doc;
    if (!store.isPart(path)) return nodeAsPen(doc, path);
    // A node inside an instance copies as it reads, its parts as ordinary nodes.
    const { tree } = this.measured();
    const n = findNode(tree, path);
    if (!n) throw new Error(`Copy: no node "${path}".`);
    const plain = (t: TreeNode): PenNode => ({
      type: t.type,
      id: t.id.slice(t.id.lastIndexOf("/") + 1),
      ...t.props,
      ...(t.children.length ? { children: t.children.map(plain) } : {}),
    });
    return plain(n);
  }

  host = (op: string, args: unknown[]): unknown => {
    const doc = this.doc;
    const str = (v: unknown, what: string) => {
      if (typeof v !== "string" || !v) throw new Error(`${what} must be a node id (a string).`);
      return v;
    };
    const nodeArg = (v: unknown, what: string): PenNode => {
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what} must be a node object with a \`type\`.`);
      const { id: _id, ...rest } = v as PenNode;
      void _id;
      return rest as PenNode;
    };
    switch (op) {
      case "insert": {
        const parent = args[0] === null || args[0] === undefined ? ROOT_ID : str(args[0], "Insert's parent");
        const node = nodeArg(args[1], "Insert's node");
        // One node per Insert (as in Pen): a script builds a section piece by piece, in the order the
        // person should see it, rather than as one nested tree.
        if (Array.isArray(node.children) && node.type !== "ref") {
          throw new Error("Insert adds one node; add its children with further Insert calls into the returned id.");
        }
        requireSupported(node);
        if (parent === ROOT_ID && node.x === undefined && node.y === undefined) {
          const w = typeof node.width === "number" ? node.width : 0;
          Object.assign(node, this.findEmptySpace({ width: w, height: typeof node.height === "number" ? node.height : 0 }));
        }
        if (node.type === "ref" && typeof node.ref === "string") node.descendants = this.descendantIds(node.ref, node.descendants);
        const id = store.insert(doc, parent, node);
        this.made(id, node);
        return id;
      }
      case "copy": {
        const path = str(args[0], "Copy's path");
        const parent = args[1] == null ? ROOT_ID : str(args[1], "Copy's parent");
        const data = (args[2] && typeof args[2] === "object" ? { ...(args[2] as PenNode) } : {}) as Partial<PenNode>;
        delete data.id;
        requireSupported(data);
        const { descendants, ...own } = data;
        if (!store.exists(doc, path) || path === ROOT_ID) throw new Error(`Copy: no node "${path}".`);
        let id: string;
        const src = store.isPart(path) ? undefined : store.propsOf(doc, path);
        if (src?.reusable) {
          // Copying a component makes an instance of it.
          id = store.insert(doc, parent, { type: "ref", ref: path, ...own, descendants: this.descendantIds(path, descendants) } as PenNode);
        } else {
          const copy = this.copyable(path);
          const { reusable: _r, ...rest } = copy;
          void _r;
          id = store.insert(doc, parent, { ...rest, ...own } as PenNode);
          if (descendants) {
            // Descendants are named by the original's ids: map them onto the copy's new ones.
            const before = store.toTree(doc, path);
            const after = store.toTree(doc, id);
            const map = new Map<string, string>();
            const pair = (a: TreeNode, b: TreeNode) => {
              map.set(a.id.startsWith(path + "/") ? a.id.slice(path.length + 1) : a.id, b.id);
              a.children.forEach((c, i) => b.children[i] && pair(c, b.children[i]!));
            };
            before.children.forEach((c, i) => after.children[i] && pair(c, after.children[i]!));
            const names = this.descendantIds(path, descendants) ?? {};
            const mapped: Descendants = {};
            for (const [k, v] of Object.entries(names)) {
              const head = k.split("/")[0]!;
              const to = map.get(k) ?? (map.get(head) ? map.get(head) + k.slice(head.length) : undefined);
              if (!to) throw new Error(`Copy: descendants key "${k}" isn't inside "${path}".`);
              mapped[to] = v;
            }
            for (const [target, entry] of Object.entries(mapped)) this.applyEntry(target, entry);
          }
        }
        this.made(id, { ...data, type: store.typeOf(doc, id) });
        return id;
      }
      case "update": {
        const id = str(args[0], "Update's path");
        if (!store.exists(doc, id) || id === ROOT_ID) throw new Error(`Update: no node "${id}".`);
        const props = { ...((args[1] ?? {}) as Partial<PenNode>) };
        for (const k of ["id", "type", "ref"] as const) {
          if (k in props) throw new Error(`Update can't change \`${k}\`; use Replace for a different node.`);
        }
        if ("children" in props) throw new Error("Update doesn't take `children`; use Insert, or Replace to swap the node.");
        requireSupported({ ...props, type: store.typeOf(doc, id) });
        const descendants = props.descendants;
        delete props.descendants;
        // A part of an instance is changed on the ref's record, under the part's key ("/<id path>").
        const mine = store.isPart(id)
          ? this.protect.get(store.recordIdOf(id))?.has("/" + id.slice(id.indexOf("/") + 1))
            ? new Set(Object.keys(props))
            : undefined
          : this.protect.get(id);
        if (mine) {
          const skipped = Object.keys(props).filter((k) => mine.has(k));
          skipped.forEach((k) => delete props[k as keyof NodeProps]);
          if (skipped.length) this.leftAlone.push(`${id}: ${skipped.join(", ")}`);
        }
        if (Object.keys(props).length) store.update(doc, id, props as Partial<NodeProps>);
        if (descendants) this.applyDescendants(id, this.descendantIds(store.mainOf(doc, id) ?? id, descendants)!);
        this.touch(id);
        this.aimAt(id, false, Object.keys(props));
        this.write();
        return null;
      }
      case "replace": {
        const path = str(args[0], "Replace's path");
        const node = nodeArg(args[1], "Replace's node");
        requireSupported(node);
        const id = store.replace(doc, path, node);
        this.made(id, node);
        return id;
      }
      case "delete": {
        const id = str(args[0], "Delete's path");
        if (this.protect.has(id)) {
          this.leftAlone.push(`${id}: not deleted`);
          return null;
        }
        const parent = store.parentOf(doc, id);
        store.remove(doc, id);
        if (parent && parent !== ROOT_ID) this.touch(parent);
        this.touched.delete(id);
        this.write();
        return null;
      }
      case "move": {
        const id = str(args[0], "Move's path");
        const parent = args[1] == null ? (store.parentOf(doc, id) ?? ROOT_ID) : str(args[1], "Move's parent");
        store.move(doc, id, parent, position(args[2]));
        this.touch(id);
        this.aimAt(id, false);
        this.write();
        return null;
      }
      case "read":
        return this.read(args[0] == null ? ROOT_ID : str(args[0], "Get's path"), (args[1] ?? {}) as never, args[2] === true);
      case "check": {
        const id = args[0] == null ? undefined : str(args[0], "Check's id");
        const { tree, boxes, vars } = this.measured();
        return check(tree, boxes, vars, this.engine.text, id);
      }
      case "getVariables": {
        const themes = store.getThemes(doc);
        return { variables: store.getVariables(doc), ...(Object.keys(themes).length ? { themes } : {}) };
      }
      case "setVariables": {
        const defs = args[0];
        if (!defs || typeof defs !== "object") throw new Error("SetVariables takes { name: { type, value } }.");
        store.setVariables(doc, defs as Record<string, VariableDef>, args[1] === true);
        this.write();
        return null;
      }
      case "findEmptySpace":
        return this.findEmptySpace((args[0] ?? {}) as never);
      case "screenshot": {
        for (const raw of (args[0] as unknown[]) ?? []) {
          const id = str(raw, "TakeScreenshot's ids");
          if (!store.exists(doc, id)) throw new Error(`TakeScreenshot: no node "${id}".`);
          if (!this.screenshots.includes(id)) this.screenshots.push(id);
        }
        if (this.screenshots.length > 4) throw new Error("TakeScreenshot: at most 4 pictures per script.");
        return null;
      }
      case "font": {
        const family = String(args[0] ?? "");
        const styles = this.engine.fonts.styles(family);
        return styles ? { family, available: true, styles } : { family, available: false };
      }
      case "print": {
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

/** The variables in force at `id` (the themes its ancestors set). */
function themedAt(tree: TreeNode, id: string, vars: Vars): Vars {
  const walk = (n: TreeNode, v: Vars): Vars | undefined => {
    const here = withTheme(v, n.props.theme);
    if (n.id === id) return here;
    for (const c of n.children) {
      const hit = walk(c, here);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(tree, vars) ?? vars;
}

