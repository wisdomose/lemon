// The flat store: every node is one Y.Map in the "nodes" map, keyed by id, holding its type, parent
// id, order key among its siblings, and each property as its own key (so two people changing
// different properties of the same node never conflict).
//
// Components: any node with `component: true` is a main component. An instance (a copy of it) is one
// record, type "instance", with `of` (the main's id), its own properties (which override the main's
// root) and its changes to the main's parts, each under the key "/<id path>" (so changes to different
// parts never conflict). An instance is read as the main's tree (toTree): its parts get the ids
// "<instance id>/<id path>", where the id path is the part's id in the main ("a"), or the path through
// an instance inside the main ("b/c"). Those ids work everywhere a record id does: changing a part
// records a change on the instance, and deleting one hides it there. Parts can't be added, moved or
// rearranged; detach the instance first (detach), which turns it into ordinary nodes.
import * as Y from "yjs";
import { generateKeyBetween } from "fractional-indexing";
import {
  DEFAULTS,
  NODE_TYPES,
  ROOT_ID,
  type NodeProps,
  type NodeSpec,
  type NodeType,
  type Overrides,
  type TreeNode,
  type Vars,
} from "./schema.js";

const META = new Set(["type", "parent", "order", "of"]);
/** An instance record's key for its changes to the main's part at `path`. */
const OVERRIDE = "/";
const isOverrideKey = (k: string) => k.startsWith(OVERRIDE);

/** Whether `id` names a part of an instance ("<instance id>/<id path>") rather than a record. */
export const isPart = (id: string) => id.includes("/");
/** The record an id lives in: the instance, for a part of one. */
export const recordIdOf = (id: string) => (isPart(id) ? id.slice(0, id.indexOf("/")) : id);
/** A part's id path inside its instance's main component. */
const pathOf = (id: string) => id.slice(id.indexOf("/") + 1);

/** A record's own properties (not its place, nor an instance's changes to its parts). */
function recordProps(rec: Y.Map<unknown>): NodeProps {
  const props: Record<string, unknown> = {};
  for (const [k, v] of rec) if (!META.has(k) && !isOverrideKey(k)) props[k] = v;
  return props as NodeProps;
}

/** An instance record's changes to its main's parts, by id path. */
function recordOverrides(rec: Y.Map<unknown>): Overrides {
  const out: Overrides = {};
  for (const [k, v] of rec) if (isOverrideKey(k)) out[k.slice(OVERRIDE.length)] = v as Partial<NodeProps>;
  return out;
}

/** What an instance doesn't take from its main's root: the main's place and its being the main. */
function mainRootProps(props: NodeProps): NodeProps {
  const { component: _c, x: _x, y: _y, ...rest } = props;
  void _c, void _x, void _y;
  return rest;
}

export function nodesOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("nodes");
}
export function varsOf(doc: Y.Doc): Y.Map<string | number> {
  return doc.getMap("vars");
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = "";
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}

export class DocError extends Error {}

/** Children of `parentId`, sorted by order key. */
export function childIds(doc: Y.Doc, parentId: string): string[] {
  const out: { id: string; order: string }[] = [];
  for (const [id, rec] of nodesOf(doc)) {
    if (rec.get("parent") === parentId) out.push({ id, order: rec.get("order") as string });
  }
  out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
  return out.map((o) => o.id);
}

function orderKeyAt(doc: Y.Doc, parentId: string, index: number | undefined, skipId?: string): string {
  const siblings = childIds(doc, parentId).filter((id) => id !== skipId);
  const at = index === undefined || index > siblings.length ? siblings.length : Math.max(0, index);
  const nodes = nodesOf(doc);
  const before = at > 0 ? (nodes.get(siblings[at - 1]!)!.get("order") as string) : null;
  const after = at < siblings.length ? (nodes.get(siblings[at]!)!.get("order") as string) : null;
  return generateKeyBetween(before, after);
}

export function exists(doc: Y.Doc, id: string): boolean {
  if (id === ROOT_ID) return true;
  if (!isPart(id)) return nodesOf(doc).has(id);
  return !!partOf(doc, id);
}

/** A node as it reads: an instance or a part of one, read through its main component. */
function readNode(doc: Y.Doc, id: string): TreeNode | undefined {
  if (!exists(doc, isPart(id) ? recordIdOf(id) : id) || id === ROOT_ID) return undefined;
  return isPart(id) ? partOf(doc, id) : toTree(doc, id);
}

/** A part of an instance, read through the instance's main component. */
function partOf(doc: Y.Doc, id: string): TreeNode | undefined {
  const root = recordIdOf(id);
  if (!nodesOf(doc).has(root)) return undefined;
  const find = (n: TreeNode): TreeNode | undefined => (n.id === id ? n : id.startsWith(n.id + "/") ? n.children.map(find).find(Boolean) : undefined);
  return find(toTree(doc, root));
}

/** What a node is drawn as: an instance is its main component's type. */
export function typeOf(doc: Y.Doc, id: string): NodeType | undefined {
  const rec = nodesOf(doc).get(id);
  if (rec && rec.get("type") !== "instance") return rec.get("type") as NodeType;
  return readNode(doc, id)?.type;
}

/** Whether `id` is an instance (a copy of a main component), including one inside another instance. */
export function isInstance(doc: Y.Doc, id: string): boolean {
  return isPart(id) ? !!partOf(doc, id)?.instance : nodesOf(doc).get(id)?.get("type") === "instance";
}

/** The main component an instance copies. */
export function mainOf(doc: Y.Doc, id: string): string | undefined {
  return isPart(id) ? partOf(doc, id)?.instance : (nodesOf(doc).get(id)?.get("of") as string | undefined);
}

const COPY_PART = "is part of a copy of a component (an instance): change the main component, or detach the copy first";

function requireNode(doc: Y.Doc, id: string): Y.Map<unknown> {
  const rec = nodesOf(doc).get(id);
  if (!rec) throw new DocError(`No node with id "${id}".`);
  return rec;
}

function requireContainer(doc: Y.Doc, parentId: string): void {
  if (parentId === ROOT_ID) return;
  if (isPart(parentId)) throw new DocError(`"${parentId}" ${COPY_PART}.`);
  const t = nodesOf(doc).get(parentId)?.get("type") as NodeType | undefined;
  if (!t) throw new DocError(`No node with id "${parentId}".`);
  if (t === "instance") throw new DocError(`"${parentId}" is a copy of a component (an instance): it can't have children of its own; detach it first.`);
  if (t !== "frame") throw new DocError(`"${parentId}" is a ${t}; only frames can have children.`);
}

function setProps(rec: Y.Map<unknown>, props: Partial<NodeProps>): void {
  for (const [k, v] of Object.entries(props)) {
    if (META.has(k) || isOverrideKey(k) || k === "children" || k === "ref" || k === "overrides") continue;
    if (v === null || v === undefined) rec.delete(k);
    else rec.set(k, v);
  }
}

/** Sets an instance's changes to its main's parts (merged with what it has; null removes a change). */
function setOverrides(rec: Y.Map<unknown>, overrides: Overrides): void {
  for (const [path, props] of Object.entries(overrides)) {
    if (!path || !props || typeof props !== "object") continue;
    const key = OVERRIDE + path;
    const next: Record<string, unknown> = { ...((rec.get(key) as object | undefined) ?? {}) };
    for (const [k, v] of Object.entries(props)) {
      if (META.has(k) || k === "children" || k === "component") continue;
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    if (Object.keys(next).length) rec.set(key, next);
    else rec.delete(key);
  }
}

/** The main components whose instances appear inside `mains`' trees, and so on down, with `mains`. */
function mainsReached(doc: Y.Doc, mains: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...mains];
  while (queue.length) {
    const m = queue.pop()!;
    if (out.has(m)) continue;
    out.add(m);
    for (const i of instancesWithin(doc, m)) queue.push(nodesOf(doc).get(i)!.get("of") as string);
  }
  return out;
}

/** Instance records in the subtree at `id` (itself included). */
function instancesWithin(doc: Y.Doc, id: string): string[] {
  const nodes = nodesOf(doc);
  const out: string[] = [];
  const walk = (n: string) => {
    if (nodes.get(n)?.get("type") === "instance") out.push(n);
    for (const c of childIds(doc, n)) walk(c);
  };
  walk(id);
  return out;
}

/** Refuses to place copies of `mains` inside `parentId` when that would put a component inside itself. */
function refuseLoop(doc: Y.Doc, mains: Iterable<string>, parentId: string): void {
  const reached = mainsReached(doc, mains);
  for (let p: string | undefined = parentId; p && p !== ROOT_ID; p = parentOf(doc, p)) {
    if (reached.has(p)) throw new DocError("A component can't contain a copy of itself.");
  }
}

/**
 * Inserts `spec` (with nested children) under `parentId` at `index` (default: last).
 * Returns the new root id; `refs` collects ids for every node that carries a `ref`.
 */
export function insert(
  doc: Y.Doc,
  parentId: string,
  spec: NodeSpec,
  index?: number,
  refs: Record<string, string> = {},
): string {
  requireContainer(doc, parentId);
  if (!spec || typeof spec !== "object") throw new DocError("insert needs a node object.");
  if (!NODE_TYPES.includes(spec.type)) {
    throw new DocError(`Unknown node type "${String(spec.type)}". Use one of: ${NODE_TYPES.join(", ")}.`);
  }
  if (spec.children && spec.type !== "frame") {
    throw new DocError(`A ${spec.type} cannot have children; wrap them in a frame.`);
  }
  if (spec.type === "instance") {
    const main = typeof spec.of === "string" ? nodesOf(doc).get(spec.of) : undefined;
    if (!main) throw new DocError(`An instance needs \`of\`: the id of a main component${spec.of ? ` ("${spec.of}" doesn't exist)` : ""}.`);
    if (main.get("component") !== true) throw new DocError(`"${spec.of}" isn't a component; set \`component: true\` on it first.`);
    refuseLoop(doc, [spec.of!], parentId);
  }
  const id = newId();
  const rec = new Y.Map<unknown>();
  rec.set("type", spec.type);
  rec.set("parent", parentId);
  rec.set("order", orderKeyAt(doc, parentId, index));
  const { children, ref, type, of, overrides, ...props } = spec;
  if (type === "instance") rec.set("of", of);
  setProps(rec, { ...DEFAULTS[type], ...props });
  nodesOf(doc).set(id, rec);
  if (type === "instance" && overrides) setOverrides(rec, overrides);
  if (ref) refs[ref] = id;
  for (const child of children ?? []) insert(doc, id, child, undefined, refs);
  return id;
}

export function update(doc: Y.Doc, id: string, props: Partial<NodeProps>): void {
  if (id === ROOT_ID) throw new DocError("The page itself has no properties.");
  if ("type" in props || "parent" in props || "children" in props) {
    throw new DocError("update changes properties only; use move() to change the parent.");
  }
  if (isPart(id)) {
    if (!partOf(doc, id)) throw new DocError(`No node with id "${id}".`);
    setOverrides(nodesOf(doc).get(recordIdOf(id))!, { [pathOf(id)]: props });
    return;
  }
  const rec = requireNode(doc, id);
  // A main component stops being one: its copies become ordinary nodes first.
  if ("component" in props && !props.component && rec.get("component")) detachInstancesOf(doc, [id]);
  setProps(rec, props);
}

/** Deletes a node; a part of an instance is hidden in that instance instead. */
export function remove(doc: Y.Doc, id: string): void {
  if (id === ROOT_ID) throw new DocError("The page itself cannot be deleted.");
  if (isPart(id)) return update(doc, id, { visible: false });
  requireNode(doc, id);
  // Copies of main components deleted here (outside what is deleted) become ordinary nodes first.
  const mains: string[] = [];
  const walk = (n: string) => {
    if (nodesOf(doc).get(n)?.get("component")) mains.push(n);
    childIds(doc, n).forEach(walk);
  };
  walk(id);
  if (mains.length) detachInstancesOf(doc, mains, id);
  removeRecords(doc, id);
}

function removeRecords(doc: Y.Doc, id: string): void {
  for (const child of childIds(doc, id)) removeRecords(doc, child);
  nodesOf(doc).delete(id);
}

export function move(doc: Y.Doc, id: string, parentId: string, index?: number): void {
  if (isPart(id)) throw new DocError(`"${id}" ${COPY_PART}.`);
  const rec = requireNode(doc, id);
  requireContainer(doc, parentId);
  for (let p: string | undefined = parentId; p && p !== ROOT_ID; p = nodesOf(doc).get(p)?.get("parent") as string) {
    if (p === id) throw new DocError("A node cannot be moved inside itself.");
  }
  const copies = instancesWithin(doc, id).map((i) => nodesOf(doc).get(i)!.get("of") as string);
  if (copies.length) refuseLoop(doc, copies, parentId);
  rec.set("order", orderKeyAt(doc, parentId, index, id));
  rec.set("parent", parentId);
}

/** A node's properties as it reads (an instance's and its parts' through the main component). */
export function propsOf(doc: Y.Doc, id: string): NodeProps {
  const rec = nodesOf(doc).get(id);
  if (rec && rec.get("type") !== "instance") return recordProps(rec);
  const node = readNode(doc, id);
  if (!node) throw new DocError(`No node with id "${id}".`);
  return node.props;
}

export function parentOf(doc: Y.Doc, id: string): string | undefined {
  if (!isPart(id)) return nodesOf(doc).get(id)?.get("parent") as string | undefined;
  const root = recordIdOf(id);
  if (!nodesOf(doc).has(root)) return undefined;
  const up = (n: TreeNode): string | undefined => {
    for (const c of n.children) {
      if (c.id === id) return n.id;
      if (id.startsWith(c.id + "/")) return up(c);
    }
    return undefined;
  };
  return up(toTree(doc, root));
}

/**
 * Turns an instance into ordinary nodes that look the same: the main's nodes with the instance's
 * changes applied, under new ids (the instance keeps its own). Instances inside the main stay
 * instances. A copy of a main that is itself an instance stays an instance of what that copies.
 */
export function detach(doc: Y.Doc, id: string): void {
  if (isPart(id)) throw new DocError(`"${id}" ${COPY_PART}.`);
  const nodes = nodesOf(doc);
  const rec = requireNode(doc, id);
  if (rec.get("type") !== "instance") throw new DocError(`"${id}" isn't a copy of a component.`);
  const own = recordProps(rec);
  const changes = recordOverrides(rec);
  const mainId = rec.get("of") as string;
  const main = nodes.get(mainId);
  for (const k of [...rec.keys()]) if (isOverrideKey(k) || k === "of") rec.delete(k);
  if (!main) {
    rec.set("type", "frame");
    return;
  }
  /** Changes to the parts under `prefix`, re-keyed to be relative to it. */
  const under = (prefix: string): Overrides =>
    Object.fromEntries(Object.entries(changes).filter(([k]) => k.startsWith(prefix + "/")).map(([k, v]) => [k.slice(prefix.length + 1), v]));
  const merge = (a: Overrides, b: Overrides): Overrides => {
    const out: Overrides = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = { ...out[k], ...v };
    return out;
  };
  const mainOwn = mainRootProps(recordProps(main));
  if (main.get("type") === "instance") {
    // The main is a copy itself: this becomes a copy of what it copies, with both sets of changes.
    rec.set("of", main.get("of"));
    setProps(rec, { ...mainOwn, ...own });
    setOverrides(rec, merge(recordOverrides(main), changes));
    return;
  }
  rec.set("type", main.get("type"));
  setProps(rec, { ...mainOwn, ...own });
  const copy = (from: string, parent: string) => {
    const src = nodes.get(from)!;
    const next = new Y.Map<unknown>();
    next.set("type", src.get("type"));
    next.set("parent", parent);
    next.set("order", src.get("order"));
    const { component: _c, ...props } = recordProps(src);
    void _c;
    setProps(next, { ...props, ...changes[from] });
    const nid = newId();
    if (src.get("type") === "instance") {
      next.set("of", src.get("of"));
      nodes.set(nid, next);
      setOverrides(next, merge(recordOverrides(src), under(from)));
      return;
    }
    nodes.set(nid, next);
    for (const c of childIds(doc, from)) copy(c, nid);
  };
  for (const c of childIds(doc, mainId)) copy(c, id);
}

/** Detaches every instance of `mains` (except those inside `except`, which is going away). */
function detachInstancesOf(doc: Y.Doc, mains: string[], except?: string): void {
  const set = new Set(mains);
  const inside = (id: string) => {
    for (let p: string | undefined = id; p && p !== ROOT_ID; p = parentOf(doc, p)) if (p === except) return true;
    return false;
  };
  for (const [id, rec] of nodesOf(doc)) {
    if (rec.get("type") === "instance" && set.has(rec.get("of") as string) && !inside(id)) detach(doc, id);
  }
}

/** The whole document (or one subtree) as a tree, with every instance read through its main component. */
export function toTree(doc: Y.Doc, rootId: string = ROOT_ID): TreeNode {
  if (isPart(rootId)) {
    const part = partOf(doc, rootId);
    if (!part) throw new DocError(`No node with id "${rootId}".`);
    return part;
  }
  const nodes = nodesOf(doc);
  const byParent = new Map<string, { id: string; order: string }[]>();
  for (const [id, rec] of nodes) {
    const p = rec.get("parent") as string;
    let list = byParent.get(p);
    if (!list) byParent.set(p, (list = []));
    list.push({ id, order: rec.get("order") as string });
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
  }
  // Main components as read, once each; a main being read can't be read again inside itself.
  const mains = new Map<string, TreeNode>();
  const reading = new Set<string>();
  const mainTree = (of: string): TreeNode | undefined => {
    if (mains.has(of)) return mains.get(of);
    if (reading.has(of) || !nodes.has(of)) return undefined;
    reading.add(of);
    const t = build(of);
    reading.delete(of);
    mains.set(of, t);
    return t;
  };
  const build = (id: string): TreeNode => {
    if (id === ROOT_ID) return { id, type: "frame", props: { layout: "none" }, children: (byParent.get(id) ?? []).map((c) => build(c.id)) };
    const rec = nodes.get(id)!;
    const type = rec.get("type") as NodeType;
    const props = recordProps(rec);
    if (type !== "instance") return { id, type, props, children: (byParent.get(id) ?? []).map((c) => build(c.id)) };
    const of = rec.get("of") as string;
    const main = mainTree(of);
    // A copy whose main is gone (or would contain itself) shows as an empty frame of its own properties.
    if (!main) return { id, type: "frame", props, children: [], instance: of };
    return readInstance(main, id, props, recordOverrides(rec), of);
  };
  if (rootId !== ROOT_ID) requireNode(doc, rootId);
  return build(rootId);
}

/** An instance as it reads: `main`'s tree under the instance's ids, with its own properties and changes. */
function readInstance(main: TreeNode, id: string, own: NodeProps, changes: Overrides, of: string): TreeNode {
  // Parts of the main are named by their id in it; when the main is itself a copy, without its prefix.
  const prefix = main.id + "/";
  const copy = (n: TreeNode): TreeNode => {
    const path = n.id.startsWith(prefix) ? n.id.slice(prefix.length) : n.id;
    const change = changes[path];
    return {
      id: `${id}/${path}`,
      type: n.type,
      props: change ? { ...n.props, ...change } : n.props,
      children: n.children.map(copy),
      ...(n.instance ? { instance: n.instance } : {}),
    };
  };
  return { id, type: main.type, props: { ...mainRootProps(main.props), ...own }, children: main.children.map(copy), instance: of };
}

export function getVars(doc: Y.Doc): Vars {
  return Object.fromEntries(varsOf(doc).entries());
}

export function setVars(doc: Y.Doc, vars: Record<string, string | number | null>): void {
  const map = varsOf(doc);
  for (const [k, v] of Object.entries(vars)) {
    const name = k.replace(/^\$/, "");
    if (!/^[A-Za-z][\w-]*$/.test(name)) throw new DocError(`Bad variable name "${k}".`);
    if (v === null) map.delete(name);
    else map.set(name, v);
  }
}

/**
 * Runs `fn` against a private copy of `doc`. If it succeeds, its changes are applied to `doc` as one
 * update tagged with `origin` (one undo step, one message to other windows); if it throws, `doc` is
 * untouched. Changes made to `doc` meanwhile (a person editing) merge as usual; `copyClientId` decides
 * which side wins a tie on the same property.
 */
export function stage<T>(doc: Y.Doc, fn: (copy: Y.Doc) => T, copyClientId?: number): { value: T; commit: (origin: unknown) => void } {
  const copy = new Y.Doc();
  // The copy's client id decides ties with concurrent edits (see doc/live.ts).
  if (copyClientId !== undefined) copy.clientID = copyClientId;
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const value = copy.transact(() => fn(copy));
  return {
    value,
    commit(origin) {
      const update = Y.encodeStateAsUpdate(copy, Y.encodeStateVector(doc));
      Y.applyUpdate(doc, update, origin);
      copy.destroy();
    },
  };
}
