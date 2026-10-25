// The flat store: every node is one Y.Map in the "nodes" map, keyed by id, holding its type, parent
// id, order key among its siblings, and each property as its own key (so two people changing
// different properties of the same node never conflict).
import * as Y from "yjs";
import { generateKeyBetween } from "fractional-indexing";
import {
  DEFAULTS,
  NODE_TYPES,
  ROOT_ID,
  type NodeProps,
  type NodeSpec,
  type NodeType,
  type TreeNode,
  type Vars,
} from "./schema.js";

const META = new Set(["type", "parent", "order"]);

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
  return id === ROOT_ID || nodesOf(doc).has(id);
}

export function typeOf(doc: Y.Doc, id: string): NodeType | undefined {
  return nodesOf(doc).get(id)?.get("type") as NodeType | undefined;
}

function requireNode(doc: Y.Doc, id: string): Y.Map<unknown> {
  const rec = nodesOf(doc).get(id);
  if (!rec) throw new DocError(`No node with id "${id}".`);
  return rec;
}

function requireContainer(doc: Y.Doc, parentId: string): void {
  if (parentId === ROOT_ID) return;
  const t = typeOf(doc, parentId);
  if (!t) throw new DocError(`No node with id "${parentId}".`);
  if (t !== "frame") throw new DocError(`"${parentId}" is a ${t}; only frames can have children.`);
}

function setProps(rec: Y.Map<unknown>, props: Partial<NodeProps>): void {
  for (const [k, v] of Object.entries(props)) {
    if (META.has(k) || k === "children" || k === "ref") continue;
    if (v === null || v === undefined) rec.delete(k);
    else rec.set(k, v);
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
  const id = newId();
  const rec = new Y.Map<unknown>();
  rec.set("type", spec.type);
  rec.set("parent", parentId);
  rec.set("order", orderKeyAt(doc, parentId, index));
  const { children, ref, type, ...props } = spec;
  setProps(rec, { ...DEFAULTS[type], ...props });
  nodesOf(doc).set(id, rec);
  if (ref) refs[ref] = id;
  for (const child of children ?? []) insert(doc, id, child, undefined, refs);
  return id;
}

export function update(doc: Y.Doc, id: string, props: Partial<NodeProps>): void {
  if (id === ROOT_ID) throw new DocError("The page itself has no properties.");
  const rec = requireNode(doc, id);
  if ("type" in props || "parent" in props || "children" in props) {
    throw new DocError("update changes properties only; use move() to change the parent.");
  }
  setProps(rec, props);
}

export function remove(doc: Y.Doc, id: string): void {
  if (id === ROOT_ID) throw new DocError("The page itself cannot be deleted.");
  requireNode(doc, id);
  for (const child of childIds(doc, id)) remove(doc, child);
  nodesOf(doc).delete(id);
}

export function move(doc: Y.Doc, id: string, parentId: string, index?: number): void {
  const rec = requireNode(doc, id);
  requireContainer(doc, parentId);
  for (let p: string | undefined = parentId; p && p !== ROOT_ID; p = nodesOf(doc).get(p)?.get("parent") as string) {
    if (p === id) throw new DocError("A node cannot be moved inside itself.");
  }
  rec.set("order", orderKeyAt(doc, parentId, index, id));
  rec.set("parent", parentId);
}

export function propsOf(doc: Y.Doc, id: string): NodeProps {
  const rec = requireNode(doc, id);
  const props: Record<string, unknown> = {};
  for (const [k, v] of rec) if (!META.has(k)) props[k] = v;
  return props as NodeProps;
}

export function parentOf(doc: Y.Doc, id: string): string | undefined {
  return nodesOf(doc).get(id)?.get("parent") as string | undefined;
}

/** The whole document (or one subtree) as a tree. */
export function toTree(doc: Y.Doc, rootId: string = ROOT_ID): TreeNode {
  const byParent = new Map<string, { id: string; order: string }[]>();
  for (const [id, rec] of nodesOf(doc)) {
    const p = rec.get("parent") as string;
    let list = byParent.get(p);
    if (!list) byParent.set(p, (list = []));
    list.push({ id, order: rec.get("order") as string });
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
  }
  const build = (id: string): TreeNode => {
    const kids = (byParent.get(id) ?? []).map((c) => build(c.id));
    if (id === ROOT_ID) return { id, type: "frame", props: { layout: "none" }, children: kids };
    const rec = nodesOf(doc).get(id)!;
    const props: Record<string, unknown> = {};
    for (const [k, v] of rec) if (!META.has(k)) props[k] = v;
    return { id, type: rec.get("type") as NodeType, props: props as NodeProps, children: kids };
  };
  if (rootId !== ROOT_ID) requireNode(doc, rootId);
  return build(rootId);
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

/** A new file: one white 800 × 600 frame named "Frame", as the reference app starts. */
export function newFile(doc: Y.Doc): void {
  doc.transact(() => insert(doc, ROOT_ID, { type: "frame", name: "Frame", x: 0, y: 0, width: 800, height: 600, fill: "#ffffff", layout: "none", clip: true }));
}
