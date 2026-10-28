// The flat store: every node is one Y.Map in the "nodes" map, keyed by id, holding its type, parent
// id, order key among its siblings, and each of its .pen properties as its own key (so two people
// changing different properties of the same node never conflict).
//
// Components (Pen's): any node with `reusable: true` is a component. An instance of it is one record,
// type "ref", whose `ref` is the component's id; its own properties override the component's root, and
// its changes to the component's nodes are kept under the key "/<id path>" (so changes to different
// nodes never conflict). An instance is read as the component's tree (toTree): its nodes get the ids
// "<ref id>/<id path>", where the id path is the node's id in the component ("a"), or the path through
// an instance inside the component ("b/c"), as in Pen. Those ids work everywhere a record id does:
// changing one records a change on the ref, and deleting one hides it there (`enabled: false`).
//
// What an instance puts in place of the component's nodes are records of their own, children of the
// ref record:
//   - filling a node (a slot): records with `within` = the node's id path ("" for the component's
//     root), shown as that node's children instead of the component's — Pen's `children` on a ref,
//     and `children` in a `descendants` entry;
//   - replacing a node: a record with `replaces` = its id path — Pen's `descendants` entry with `type`.
// Their own children are ordinary records. Detach an instance (detach) to turn it into ordinary nodes.
import * as Y from "yjs";
import { generateKeyBetween } from "fractional-indexing";
import {
  DEFAULTS,
  NODE_TYPES,
  ROOT_ID,
  canHaveChildren,
  type Descendants,
  type NodeProps,
  type NodeType,
  type PenNode,
  type Themes,
  type TreeNode,
  type VariableDef,
  type Variables,
  type Vars,
} from "./schema.js";
import { varsFor } from "./values.js";

/** Record keys that aren't .pen properties. */
const META = new Set(["type", "parent", "order", "within", "replaces"]);
/** A ref record's key for its changes to the component's node at `path`. */
const OVERRIDE = "/";
const isOverrideKey = (k: string) => k.startsWith(OVERRIDE);
/** Keys an update can't set: what a node is and where it sits. */
const FIXED = new Set(["type", "parent", "order", "within", "replaces", "children", "descendants", "id"]);

/** A ref's changes to its component's nodes: properties by id path. */
export type Overrides = Record<string, Partial<NodeProps>>;

/** Whether `id` names a node inside an instance ("<ref id>/<id path>") rather than a record. */
export const isPart = (id: string) => id.includes("/");
/** The record an id lives in: the ref, for a node inside an instance. */
export const recordIdOf = (id: string) => (isPart(id) ? id.slice(0, id.indexOf("/")) : id);
/** A part's id path inside its instance's component. */
const pathOf = (id: string) => id.slice(id.indexOf("/") + 1);

/** A record's own properties (not its place, nor a ref's changes to its component's nodes). */
function recordProps(rec: Y.Map<unknown>): NodeProps {
  const props: Record<string, unknown> = {};
  for (const [k, v] of rec) if (!META.has(k) && !isOverrideKey(k)) props[k] = v;
  if (rec.get("type") === "ref") delete props.ref;
  return props as NodeProps;
}

/** A ref record's changes to its component's nodes, by id path. */
function recordOverrides(rec: Y.Map<unknown>): Overrides {
  const out: Overrides = {};
  for (const [k, v] of rec) if (isOverrideKey(k)) out[k.slice(OVERRIDE.length)] = v as Partial<NodeProps>;
  return out;
}

/** What an instance doesn't take from its component's root: its place and its being a component. */
function componentRootProps(props: NodeProps): NodeProps {
  const { reusable: _r, x: _x, y: _y, ...rest } = props;
  void _r, void _x, void _y;
  return rest;
}

export function nodesOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap("nodes");
}
/** The document's variables: name → definition. */
export function variablesOf(doc: Y.Doc): Y.Map<VariableDef> {
  return doc.getMap("variables");
}
/** The rest of the file's top level: "themes", "imports" and anything else a file carries. */
export function metaOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("meta");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** A new id like Pen's: five letters and digits, unused in `doc`. */
export function newId(doc?: Y.Doc): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    let id = "";
    for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
    if (!doc || !nodesOf(doc).has(id)) return id;
  }
}

export class DocError extends Error {}

const byOrder = (a: { id: string; order: string }, b: { id: string; order: string }) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1;

/** Ordinary children of `parentId` (not what a ref puts in its component), sorted by order key. */
export function childIds(doc: Y.Doc, parentId: string): string[] {
  const out: { id: string; order: string }[] = [];
  for (const [id, rec] of nodesOf(doc)) {
    if (rec.get("parent") === parentId && !isPlaced(rec)) out.push({ id, order: rec.get("order") as string });
  }
  return out.sort(byOrder).map((o) => o.id);
}

/** Whether a record is something a ref puts in its component (a fill or a replacement). */
const isPlaced = (rec: Y.Map<unknown>) => rec.has("within") || rec.has("replaces");

/** A ref record's fills and replacements: records by the id path they fill or replace. */
function placedIn(doc: Y.Doc, refId: string): { fills: Map<string, string[]>; replacements: Map<string, string> } {
  const fills = new Map<string, { id: string; order: string }[]>();
  const replacements = new Map<string, string>();
  for (const [id, rec] of nodesOf(doc)) {
    if (rec.get("parent") !== refId) continue;
    const within = rec.get("within");
    if (typeof within === "string") {
      let list = fills.get(within);
      if (!list) fills.set(within, (list = []));
      list.push({ id, order: rec.get("order") as string });
    }
    const replaces = rec.get("replaces");
    if (typeof replaces === "string") replacements.set(replaces, id);
  }
  return { fills: new Map([...fills].map(([k, v]) => [k, v.sort(byOrder).map((o) => o.id)])), replacements };
}

/** Every record a node's subtree is made of: its ordinary children and a ref's fills and replacements. */
export function allChildIds(doc: Y.Doc, parentId: string): string[] {
  const out: string[] = [];
  for (const [id, rec] of nodesOf(doc)) if (rec.get("parent") === parentId) out.push(id);
  return out;
}

function orderKeyAmong(doc: Y.Doc, siblings: string[], index: number | undefined): string {
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

/** A node as it reads: a ref or a node inside one, read through its component. */
function readNode(doc: Y.Doc, id: string): TreeNode | undefined {
  if (id === ROOT_ID || !nodesOf(doc).has(recordIdOf(id))) return undefined;
  return isPart(id) ? partOf(doc, id) : toTree(doc, id);
}

/** A node inside an instance, read through the instance's component. */
function partOf(doc: Y.Doc, id: string): TreeNode | undefined {
  const root = recordIdOf(id);
  if (!nodesOf(doc).has(root)) return undefined;
  const find = (n: TreeNode): TreeNode | undefined => (n.id === id ? n : n.children.map(find).find(Boolean));
  return find(toTree(doc, root));
}

/** What a node is drawn as: a ref is its component's type. */
export function typeOf(doc: Y.Doc, id: string): NodeType | undefined {
  const rec = nodesOf(doc).get(id);
  if (rec && rec.get("type") !== "ref") return rec.get("type") as NodeType;
  return readNode(doc, id)?.type;
}

/** Whether `id` is an instance (a ref), including one inside another instance. */
export function isInstance(doc: Y.Doc, id: string): boolean {
  return isPart(id) ? !!partOf(doc, id)?.instance : nodesOf(doc).get(id)?.get("type") === "ref";
}

/** The component an instance shows. */
export function mainOf(doc: Y.Doc, id: string): string | undefined {
  return isPart(id) ? partOf(doc, id)?.instance : (nodesOf(doc).get(id)?.get("ref") as string | undefined);
}

const PART = "is inside an instance of a component: change the component, or detach the instance first";

function requireNode(doc: Y.Doc, id: string): Y.Map<unknown> {
  const rec = nodesOf(doc).get(id);
  if (!rec) throw new DocError(`No node with id "${id}".`);
  return rec;
}

/**
 * Where new children of `parentId` go: an ordinary frame or group, the page, or a slot inside an
 * instance (the ref record, filling the node at `within`).
 */
type Container = { parent: string; within?: string };
function containerFor(doc: Y.Doc, parentId: string): Container {
  if (parentId === ROOT_ID) return { parent: ROOT_ID };
  const rec = nodesOf(doc).get(parentId);
  const node = isPart(parentId) || rec?.get("type") === "ref" ? readNode(doc, parentId) : undefined;
  if (node) {
    // Inside an instance: a node the instance fills (a slot, or one it already fills) takes children.
    const refId = recordIdOf(parentId);
    const path = isPart(parentId) ? pathOf(parentId) : "";
    if (!canHaveChildren(node.type)) throw new DocError(`"${parentId}" is a ${node.type}; only frames and groups can have children.`);
    const slot = node.props.slot;
    const filled = placedIn(doc, refId).fills.has(path);
    if (!filled && !(Array.isArray(slot) || node.children.length === 0)) {
      throw new DocError(`"${parentId}" ${PART}. To put new content there, replace it (replace) or make it a slot in the component.`);
    }
    return { parent: refId, within: path };
  }
  if (!rec) throw new DocError(`No node with id "${parentId}".`);
  const t = rec.get("type") as NodeType;
  if (!canHaveChildren(t)) throw new DocError(`"${parentId}" is a ${t}; only frames and groups can have children.`);
  return { parent: parentId };
}

/** The records already in a container, in order. */
function siblingsIn(doc: Y.Doc, c: Container): string[] {
  if (c.within === undefined) return childIds(doc, c.parent);
  return placedIn(doc, c.parent).fills.get(c.within) ?? [];
}

function setProps(rec: Y.Map<unknown>, props: Partial<NodeProps>): void {
  for (const [k, v] of Object.entries(props)) {
    if (FIXED.has(k) || isOverrideKey(k)) continue;
    if (v === null || v === undefined) rec.delete(k);
    else rec.set(k, v);
  }
}

/** Sets a ref's changes to its component's nodes (merged with what it has; null removes a change). */
function setOverrides(rec: Y.Map<unknown>, overrides: Overrides): void {
  for (const [path, props] of Object.entries(overrides)) {
    if (!path || !props || typeof props !== "object") continue;
    const key = OVERRIDE + path;
    const next: Record<string, unknown> = { ...((rec.get(key) as object | undefined) ?? {}) };
    for (const [k, v] of Object.entries(props)) {
      if (FIXED.has(k) || k === "reusable") continue;
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    if (Object.keys(next).length) rec.set(key, next);
    else rec.delete(key);
  }
}

/** The components whose instances appear inside `mains`' trees, and so on down, with `mains`. */
function mainsReached(doc: Y.Doc, mains: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...mains];
  while (queue.length) {
    const m = queue.pop()!;
    if (out.has(m)) continue;
    out.add(m);
    for (const i of instancesWithin(doc, m)) queue.push(nodesOf(doc).get(i)!.get("ref") as string);
  }
  return out;
}

/** Ref records in the subtree at `id` (itself included). */
function instancesWithin(doc: Y.Doc, id: string): string[] {
  const nodes = nodesOf(doc);
  const out: string[] = [];
  const walk = (n: string) => {
    if (nodes.get(n)?.get("type") === "ref") out.push(n);
    for (const c of allChildIds(doc, n)) walk(c);
  };
  walk(id);
  return out;
}

/** Refuses to place instances of `mains` inside `parentId` when that would put a component inside itself. */
function refuseLoop(doc: Y.Doc, mains: Iterable<string>, parentId: string): void {
  const reached = mainsReached(doc, mains);
  for (let p: string | undefined = recordIdOf(parentId); p && p !== ROOT_ID; p = nodesOf(doc).get(p)?.get("parent") as string | undefined) {
    if (reached.has(p)) throw new DocError("A component can't contain an instance of itself.");
  }
}

/** Checks a node about to be made: a known type, children only where allowed, a ref's component. */
function checkSpec(doc: Y.Doc, spec: PenNode, parentId: string): void {
  if (!spec || typeof spec !== "object") throw new DocError("A node must be an object.");
  if (!NODE_TYPES.includes(spec.type)) {
    throw new DocError(`Unknown node type "${String(spec.type)}". Use one of: ${NODE_TYPES.join(", ")}.`);
  }
  if (spec.children?.length && !canHaveChildren(spec.type) && spec.type !== "ref") {
    throw new DocError(`A ${spec.type} can't have children; only frames and groups can. Wrap them in a frame.`);
  }
  if (spec.type === "ref") {
    const main = typeof spec.ref === "string" ? nodesOf(doc).get(spec.ref) : undefined;
    if (!main) throw new DocError(`A ref needs \`ref\`: the id of a component${spec.ref ? ` ("${spec.ref}" doesn't exist)` : ""}.`);
    if (main.get("reusable") !== true) throw new DocError(`"${spec.ref}" isn't a component; set \`reusable: true\` on it first.`);
    refuseLoop(doc, [spec.ref!], parentId);
  }
}

/** Splits a ref's `descendants` into property changes, fills (`children`) and replacements (`type`). */
function splitDescendants(d: Descendants | undefined): { overrides: Overrides; fills: [string, PenNode[]][]; replacements: [string, PenNode][] } {
  const overrides: Overrides = {};
  const fills: [string, PenNode[]][] = [];
  const replacements: [string, PenNode][] = [];
  for (const [path, entry] of Object.entries(d ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.type === "string") {
      replacements.push([path, entry as PenNode]);
      continue;
    }
    const { children, ...props } = entry;
    if (Object.keys(props).length) overrides[path] = props as Partial<NodeProps>;
    if (Array.isArray(children)) fills.push([path, children as PenNode[]]);
  }
  return { overrides, fills, replacements };
}

/** Makes the record for one node (and its subtree) without checks: for reading files and copying. */
function makeRecord(doc: Y.Doc, spec: PenNode, parent: string, order: string, place?: { within?: string; replaces?: string }, keepId = false): string {
  const id = keepId && typeof spec.id === "string" && spec.id && !spec.id.includes("/") && !nodesOf(doc).has(spec.id) ? spec.id : newId(doc);
  const rec = new Y.Map<unknown>();
  rec.set("type", spec.type);
  rec.set("parent", parent);
  rec.set("order", order);
  if (place?.within !== undefined) rec.set("within", place.within);
  if (place?.replaces !== undefined) rec.set("replaces", place.replaces);
  const { children, descendants, id: _id, type, ...props } = spec;
  void _id;
  if (type === "ref" && typeof spec.ref === "string") rec.set("ref", spec.ref);
  setProps(rec, props as Partial<NodeProps>);
  nodesOf(doc).set(id, rec);
  const { overrides, fills, replacements } = splitDescendants(descendants);
  if (type === "ref") setOverrides(rec, overrides);
  const addAll = (list: PenNode[], where?: string) => {
    let last: string | null = null;
    for (const c of list) {
      if (!c || typeof c !== "object") continue;
      last = generateKeyBetween(last, null);
      makeRecord(doc, c, id, last, where === undefined ? undefined : { within: where }, keepId);
    }
  };
  if (type === "ref") {
    if (Array.isArray(children)) addAll(children, "");
    for (const [path, list] of fills) addAll(list, path);
    for (const [path, node] of replacements) makeRecord(doc, node, id, "a0", { replaces: path }, keepId);
  } else if (Array.isArray(children)) addAll(children);
  return id;
}

/**
 * Inserts `spec` (with nested children; a ref with `descendants`) under `parentId` at `index`
 * (default: last). New nodes get new ids, as in Pen. Returns the new node's id.
 */
export function insert(doc: Y.Doc, parentId: string, spec: PenNode, index?: number): string {
  const c = containerFor(doc, parentId);
  checkSpec(doc, spec, c.parent);
  const check = (s: PenNode) => {
    for (const child of s.children ?? []) checkSpec(doc, child, c.parent), check(child);
  };
  check(spec);
  const order = orderKeyAmong(doc, siblingsIn(doc, c), index);
  return makeRecord(doc, { ...DEFAULTS[spec.type], ...spec }, c.parent, order, c.within === undefined ? undefined : { within: c.within });
}

/** Reads a whole node tree as given (file contents), keeping its ids where they're free. */
export function insertAsIs(doc: Y.Doc, parentId: string, spec: PenNode, order: string): string {
  return makeRecord(doc, spec, parentId, order, undefined, true);
}

export function update(doc: Y.Doc, id: string, props: Partial<NodeProps>): void {
  if (id === ROOT_ID) throw new DocError("The document itself has no properties.");
  for (const k of ["type", "parent", "children", "id", "descendants"]) {
    if (k in props) throw new DocError(`update changes properties only, not \`${k}\`; use move() to change the parent and replace() to swap a node.`);
  }
  if (isPart(id)) {
    if (!partOf(doc, id)) throw new DocError(`No node with id "${id}".`);
    setOverrides(nodesOf(doc).get(recordIdOf(id))!, { [pathOf(id)]: props });
    return;
  }
  const rec = requireNode(doc, id);
  if ("ref" in props && rec.get("type") === "ref") throw new DocError("A ref's `ref` can't change; insert a new instance instead.");
  // A component stops being one: its instances become ordinary nodes first.
  if ("reusable" in props && !props.reusable && rec.get("reusable")) detachInstancesOf(doc, [id]);
  setProps(rec, props);
}

/** Deletes a node; a node inside an instance is hidden there instead (Pen's `enabled: false`). */
export function remove(doc: Y.Doc, id: string): void {
  if (id === ROOT_ID) throw new DocError("The document itself can't be deleted.");
  if (isPart(id)) return update(doc, id, { enabled: false });
  requireNode(doc, id);
  // Instances of components deleted here (outside what is deleted) become ordinary nodes first.
  const mains: string[] = [];
  const walk = (n: string) => {
    if (nodesOf(doc).get(n)?.get("reusable")) mains.push(n);
    allChildIds(doc, n).forEach(walk);
  };
  walk(id);
  if (mains.length) detachInstancesOf(doc, mains, id);
  removeRecords(doc, id);
}

function removeRecords(doc: Y.Doc, id: string): void {
  for (const child of allChildIds(doc, id)) removeRecords(doc, child);
  nodesOf(doc).delete(id);
}

/**
 * Puts a new node in place of `id` (Pen's Replace): inside an instance, the instance shows it instead
 * of the component's node; elsewhere, the old node is deleted and the new one takes its place.
 */
export function replace(doc: Y.Doc, id: string, spec: PenNode): string {
  if (id === ROOT_ID) throw new DocError("The document itself can't be replaced.");
  if (isPart(id)) {
    if (!partOf(doc, id)) throw new DocError(`No node with id "${id}".`);
    const refId = recordIdOf(id);
    const path = pathOf(id);
    checkSpec(doc, spec, refId);
    const old = placedIn(doc, refId).replacements.get(path);
    if (old) removeRecords(doc, old);
    return makeRecord(doc, { ...DEFAULTS[spec.type], ...spec }, refId, "a0", { replaces: path });
  }
  const rec = requireNode(doc, id);
  const parent = rec.get("parent") as string;
  const place = { within: rec.get("within") as string | undefined, replaces: rec.get("replaces") as string | undefined };
  checkSpec(doc, spec, parent);
  const order = rec.get("order") as string;
  remove(doc, id);
  return makeRecord(doc, { ...DEFAULTS[spec.type], ...spec }, parent, order, place);
}

export function move(doc: Y.Doc, id: string, parentId: string, index?: number): void {
  if (isPart(id)) throw new DocError(`"${id}" ${PART}.`);
  const rec = requireNode(doc, id);
  if (rec.has("replaces")) throw new DocError(`"${id}" stands in for a node of an instance; it can't move.`);
  const c = containerFor(doc, parentId);
  for (let p: string | undefined = c.parent; p && p !== ROOT_ID; p = nodesOf(doc).get(p)?.get("parent") as string) {
    if (p === id) throw new DocError("A node can't be moved inside itself.");
  }
  const copies = instancesWithin(doc, id).map((i) => nodesOf(doc).get(i)!.get("ref") as string);
  if (copies.length) refuseLoop(doc, copies, c.parent);
  rec.set("order", orderKeyAmong(doc, siblingsIn(doc, c).filter((s) => s !== id), index));
  rec.set("parent", c.parent);
  if (c.within === undefined) rec.delete("within");
  else rec.set("within", c.within);
}

/** A node's properties as it reads (a ref's and its nodes' through the component). */
export function propsOf(doc: Y.Doc, id: string): NodeProps {
  const rec = nodesOf(doc).get(id);
  if (rec && rec.get("type") !== "ref") return recordProps(rec);
  const node = readNode(doc, id);
  if (!node) throw new DocError(`No node with id "${id}".`);
  return node.props;
}

/** The node a node sits in, as the tree reads (a fill's parent is the node it fills). */
export function parentOf(doc: Y.Doc, id: string): string | undefined {
  const rec = nodesOf(doc).get(id);
  if (rec && !isPlaced(rec)) return rec.get("parent") as string | undefined;
  const root = rec ? (rec.get("parent") as string) : recordIdOf(id);
  if (!nodesOf(doc).has(root)) return undefined;
  const up = (n: TreeNode): string | undefined => {
    for (const c of n.children) {
      if (c.id === id) return n.id;
      const found = up(c);
      if (found) return found;
    }
    return undefined;
  };
  // A replacement stands where the replaced node was: its parent is that node's parent.
  return up(toTree(doc, recordIdOf(root)));
}

/**
 * Turns an instance into ordinary nodes that look the same: the component's nodes with the instance's
 * changes, fills and replacements applied, under new ids (the ref keeps its own). Instances inside the
 * component stay instances. An instance of a component that is itself an instance stays an instance of
 * what that one shows.
 */
export function detach(doc: Y.Doc, id: string): void {
  if (isPart(id)) throw new DocError(`"${id}" ${PART}.`);
  const nodes = nodesOf(doc);
  const rec = requireNode(doc, id);
  if (rec.get("type") !== "ref") throw new DocError(`"${id}" isn't an instance of a component.`);
  const own = recordProps(rec);
  const changes = recordOverrides(rec);
  const mainId = rec.get("ref") as string;
  const main = nodes.get(mainId);
  const placed = placedIn(doc, id);
  for (const k of [...rec.keys()]) if (isOverrideKey(k) || k === "ref") rec.delete(k);
  if (!main) {
    rec.set("type", "frame");
    for (const list of placed.fills.values()) list.forEach((c) => removeRecords(doc, c));
    for (const r of placed.replacements.values()) removeRecords(doc, r);
    return;
  }
  /** Changes to the nodes under `prefix`, re-keyed to be relative to it. */
  const under = (prefix: string): Overrides =>
    Object.fromEntries(Object.entries(changes).filter(([k]) => k.startsWith(prefix + "/")).map(([k, v]) => [k.slice(prefix.length + 1), v]));
  const merge = (a: Overrides, b: Overrides): Overrides => {
    const out: Overrides = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = { ...out[k], ...v };
    return out;
  };
  /** A record of this ref's that moves to stand in the detached tree. */
  const settle = (r: string, parent: string, order?: string) => {
    const x = nodes.get(r)!;
    x.set("parent", parent);
    x.delete("within");
    x.delete("replaces");
    if (order) x.set("order", order);
  };
  const mainOwn = componentRootProps(recordProps(main));
  if (main.get("type") === "ref") {
    // The component is an instance itself: this becomes an instance of what that one shows.
    rec.set("ref", main.get("ref"));
    setProps(rec, { ...mainOwn, ...own });
    setOverrides(rec, merge(recordOverrides(main), changes));
    const mine = new Set([...placed.fills.keys(), ...placed.replacements.keys()]);
    const theirs = placedIn(doc, mainId);
    for (const [path, list] of theirs.fills) if (!mine.has(path)) list.forEach((c) => copyRecord(doc, c, id));
    for (const [path, r] of theirs.replacements) if (!mine.has(path)) copyRecord(doc, r, id);
    return;
  }
  rec.set("type", main.get("type"));
  setProps(rec, { ...mainOwn, ...own });
  /** Copies the component's children of `from` (id path `path`) under `parent`, or this ref's fill of it. */
  const fillOrCopy = (from: string, path: string, parent: string) => {
    const fill = placed.fills.get(path);
    if (fill) return fill.forEach((r) => settle(r, parent));
    for (const c of childIds(doc, from)) {
      const replacement = placed.replacements.get(c);
      if (replacement) {
        settle(replacement, parent, nodes.get(c)!.get("order") as string);
        continue;
      }
      const src = nodes.get(c)!;
      const next = new Y.Map<unknown>();
      next.set("type", src.get("type"));
      next.set("parent", parent);
      next.set("order", src.get("order"));
      const { reusable: _r, ...props } = recordProps(src);
      void _r;
      setProps(next, { ...props, ...changes[c] });
      const nid = newId(doc);
      if (src.get("type") === "ref") {
        next.set("ref", src.get("ref"));
        nodes.set(nid, next);
        setOverrides(next, merge(recordOverrides(src), under(c)));
        // The nested instance's own fills and replacements come along; this ref's for it move in.
        for (const r of allChildIds(doc, c)) copyRecord(doc, r, nid);
        for (const [path2, list] of placed.fills) if (path2.startsWith(c + "/")) list.forEach((r) => (settle(r, nid), nodes.get(r)!.set("within", path2.slice(c.length + 1))));
        for (const [path2, r] of placed.replacements) if (path2.startsWith(c + "/")) (settle(r, nid), nodes.get(r)!.set("replaces", path2.slice(c.length + 1)));
        continue;
      }
      nodes.set(nid, next);
      fillOrCopy(c, c, nid);
    }
  };
  fillOrCopy(mainId, "", id);
}

/** Copies a record and its subtree under `parent` with new ids, keeping its place (fill or replacement). */
function copyRecord(doc: Y.Doc, from: string, parent: string): string {
  const nodes = nodesOf(doc);
  const src = nodes.get(from)!;
  const next = new Y.Map<unknown>();
  for (const [k, v] of src) next.set(k, v);
  next.set("parent", parent);
  const nid = newId(doc);
  nodes.set(nid, next);
  for (const c of allChildIds(doc, from)) copyRecord(doc, c, nid);
  return nid;
}

/** Detaches every instance of `mains` (except those inside `except`, which is going away). */
function detachInstancesOf(doc: Y.Doc, mains: string[], except?: string): void {
  const set = new Set(mains);
  const inside = (id: string) => {
    for (let p: string | undefined = id; p && p !== ROOT_ID; p = nodesOf(doc).get(p)?.get("parent") as string | undefined) if (p === except) return true;
    return false;
  };
  for (const [id, rec] of nodesOf(doc)) {
    if (rec.get("type") === "ref" && set.has(rec.get("ref") as string) && !inside(id)) detach(doc, id);
  }
}

/** The whole document (or one subtree) as a tree, with every instance read through its component. */
export function toTree(doc: Y.Doc, rootId: string = ROOT_ID): TreeNode {
  if (isPart(rootId)) {
    const part = partOf(doc, rootId);
    if (!part) throw new DocError(`No node with id "${rootId}".`);
    return part;
  }
  const nodes = nodesOf(doc);
  const byParent = new Map<string, { id: string; order: string }[]>();
  const fillsOf = new Map<string, Map<string, { id: string; order: string }[]>>();
  const replacementsOf = new Map<string, Map<string, string>>();
  for (const [id, rec] of nodes) {
    const p = rec.get("parent") as string;
    const within = rec.get("within");
    const replaces = rec.get("replaces");
    if (typeof within === "string") {
      let m = fillsOf.get(p);
      if (!m) fillsOf.set(p, (m = new Map()));
      let list = m.get(within);
      if (!list) m.set(within, (list = []));
      list.push({ id, order: rec.get("order") as string });
    } else if (typeof replaces === "string") {
      let m = replacementsOf.get(p);
      if (!m) replacementsOf.set(p, (m = new Map()));
      m.set(replaces, id);
    } else {
      let list = byParent.get(p);
      if (!list) byParent.set(p, (list = []));
      list.push({ id, order: rec.get("order") as string });
    }
  }
  for (const list of byParent.values()) list.sort(byOrder);
  for (const m of fillsOf.values()) for (const list of m.values()) list.sort(byOrder);
  // Components as read, once each; a component being read can't be read again inside itself.
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
    if (type !== "ref") return { id, type, props, children: (byParent.get(id) ?? []).map((c) => build(c.id)) };
    const of = rec.get("ref") as string;
    const main = mainTree(of);
    // An instance whose component is gone (or would contain itself) shows as an empty frame of its own properties.
    if (!main) return { id, type: "frame", props, children: [], instance: of };
    return readInstance(main, id, props, recordOverrides(rec), of, fillsOf.get(id), replacementsOf.get(id), build);
  };
  if (rootId !== ROOT_ID) requireNode(doc, rootId);
  return build(rootId);
}

/** An instance as it reads: `main`'s tree under the ref's ids, with its own properties, changes, fills and replacements. */
function readInstance(
  main: TreeNode,
  id: string,
  own: NodeProps,
  changes: Overrides,
  of: string,
  fills: Map<string, { id: string }[]> | undefined,
  replacements: Map<string, string> | undefined,
  build: (id: string) => TreeNode,
): TreeNode {
  // Nodes of the component are named by their id in it; when the component is itself an instance, without its prefix.
  const prefix = main.id + "/";
  const filled = (path: string, children: TreeNode[]) => {
    const fill = fills?.get(path);
    return fill ? fill.map((c) => build(c.id)) : children;
  };
  const copy = (n: TreeNode): TreeNode => {
    const path = n.id.startsWith(prefix) ? n.id.slice(prefix.length) : n.id;
    const replacement = replacements?.get(path);
    if (replacement) return build(replacement);
    const change = changes[path];
    return {
      id: `${id}/${path}`,
      type: n.type,
      props: change ? { ...n.props, ...change } : n.props,
      children: filled(path, n.children.map(copy)),
      ...(n.instance ? { instance: n.instance } : {}),
    };
  };
  return { id, type: main.type, props: { ...componentRootProps(main.props), ...own }, children: filled("", main.children.map(copy)), instance: of };
}

/** The ref's own record of an instance as Pen writes it: `ref`, properties, `descendants` and `children`. */
export function refAsPen(doc: Y.Doc, id: string, nodeAsPen: (id: string) => PenNode): PenNode {
  const rec = requireNode(doc, id);
  const out: PenNode = { type: "ref", id, ref: rec.get("ref") as string, ...recordProps(rec) };
  const descendants: Descendants = {};
  for (const [path, props] of Object.entries(recordOverrides(rec))) descendants[path] = { ...props };
  const placed = placedIn(doc, id);
  for (const [path, list] of placed.fills) {
    const kids = list.map(nodeAsPen);
    if (path === "") out.children = kids;
    else descendants[path] = { ...descendants[path], children: kids };
  }
  for (const [path, r] of placed.replacements) descendants[path] = nodeAsPen(r);
  if (Object.keys(descendants).length) out.descendants = descendants;
  return out;
}

/** The document's variables, as defined. */
export function getVariables(doc: Y.Doc): Variables {
  return Object.fromEntries(variablesOf(doc).entries());
}
/** The theme axes and their values (the first is the default). */
export function getThemes(doc: Y.Doc): Themes {
  return (metaOf(doc).get("themes") as Themes | undefined) ?? {};
}

/** The variables resolved for the default theme (layout and drawing switch theme where a node sets one). */
export function getVars(doc: Y.Doc): Vars {
  return varsFor(getVariables(doc), getThemes(doc));
}

const VAR_TYPES = new Set(["color", "number", "string", "boolean"]);

/**
 * Defines variables (Pen's SetVariables): merged into the document's, or in place of them all with
 * `replace`. Theme axes and values a themed variable uses are added to the document's themes.
 * A definition of null removes that variable.
 */
export function setVariables(doc: Y.Doc, defs: Record<string, VariableDef | null>, replaceAll = false): void {
  const map = variablesOf(doc);
  for (const [name, def] of Object.entries(defs)) {
    if (!name || name.startsWith("$") || name.includes(":")) throw new DocError(`Bad variable name "${name}": no "$" at the start and no ":".`);
    if (def === null) continue;
    if (!def || typeof def !== "object" || !VAR_TYPES.has(def.type) || def.value === undefined) {
      throw new DocError(`Variable "${name}" needs { type: "color" | "number" | "string" | "boolean", value }.`);
    }
  }
  if (replaceAll) map.clear();
  const themes = { ...getThemes(doc) };
  let themesChanged = false;
  for (const [name, def] of Object.entries(defs)) {
    if (def === null) {
      map.delete(name);
      continue;
    }
    map.set(name, def);
    if (Array.isArray(def.value)) {
      for (const entry of def.value) {
        for (const [axis, value] of Object.entries(entry?.theme ?? {})) {
          const values = themes[axis] ?? [];
          if (!values.includes(value)) {
            themes[axis] = [...values, value];
            themesChanged = true;
          }
        }
      }
    }
  }
  if (themesChanged) metaOf(doc).set("themes", themes);
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
