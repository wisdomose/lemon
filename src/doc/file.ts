// The design file (.lemon): readable JSON, our own format (PLAN.md §3, decided 26 Oct 2026). One flat record per
// node in tree order, so the file reads top to bottom like the Layers panel and diffs line by line:
//
//   { "lemon": 1,
//     "vars": { "ink": "#1b1a17" },
//     "nodes": [ { "id": "k3…", "type": "frame", "parent": "root", "order": "a0", "name": "Landing", … }, … ] }
//
// An instance's changes to its main component's parts are saved together, as
// "overrides": { "<id path>": { …properties } } (in the document each is its own key, "/<id path>").
//
// Only the document is saved; the undo history and the live-editing state start afresh when a file
// is opened.
import * as Y from "yjs";
import { NODE_TYPES, ROOT_ID, type NodeType } from "./schema.js";
import { childIds, nodesOf, varsOf } from "./store.js";
import { PRODUCT } from "../product.js";

/** The format's version; a file from a newer Lemon is refused rather than half-read. 2: components. */
export const FILE_VERSION = 2;

export interface FileNode {
  id: string;
  type: NodeType;
  parent: string;
  order: string;
  [prop: string]: unknown;
}

export interface LemonFile {
  lemon: number;
  vars: Record<string, string | number>;
  nodes: FileNode[];
}

export class FileError extends Error {}

/** The document as a file, in tree order. */
export function toFile(doc: Y.Doc): LemonFile {
  const nodes: FileNode[] = [];
  const records = nodesOf(doc);
  const walk = (id: string) => {
    for (const child of childIds(doc, id)) {
      const rec = records.get(child)!;
      const record: FileNode = { id: child, type: rec.get("type") as NodeType, parent: id, order: rec.get("order") as string };
      const overrides: Record<string, unknown> = {};
      for (const [k, v] of rec) {
        if (k.startsWith("/")) overrides[k.slice(1)] = v;
        else if (k !== "type" && k !== "parent" && k !== "order") record[k] = v;
      }
      if (Object.keys(overrides).length) record.overrides = overrides;
      nodes.push(record);
      walk(child);
    }
  };
  walk(ROOT_ID);
  return { lemon: FILE_VERSION, vars: Object.fromEntries(varsOf(doc).entries()), nodes };
}

/** The file's text: JSON, two-space indented, one property per line. */
export function fileText(doc: Y.Doc): string {
  return JSON.stringify(toFile(doc), null, 2) + "\n";
}

/** Reads a file's text into an empty document. Throws FileError for anything that isn't a Lemon file. */
export function readFile(text: string, into: Y.Doc): void {
  let data: Partial<LemonFile>;
  try {
    data = JSON.parse(text) as Partial<LemonFile>;
  } catch (e) {
    throw new FileError(`This isn't a ${PRODUCT.name} file (it isn't valid JSON: ${(e as Error).message}).`);
  }
  if (!data || typeof data !== "object" || typeof data.lemon !== "number" || !Array.isArray(data.nodes)) {
    throw new FileError(`This isn't a ${PRODUCT.name} file.`);
  }
  if (data.lemon > FILE_VERSION) throw new FileError(`This file was made by a newer version of ${PRODUCT.name}. Update ${PRODUCT.name} to open it.`);
  const seen = new Set<string>();
  for (const [i, n] of data.nodes.entries()) {
    const where = `Node ${i + 1}`;
    if (!n || typeof n !== "object") throw new FileError(`${where} isn't an object.`);
    if (typeof n.id !== "string" || !n.id || n.id === ROOT_ID) throw new FileError(`${where} has no valid id.`);
    if (seen.has(n.id)) throw new FileError(`${where} repeats the id "${n.id}".`);
    if (!NODE_TYPES.includes(n.type)) throw new FileError(`${where} has an unknown type "${String(n.type)}".`);
    if (typeof n.parent !== "string" || typeof n.order !== "string") throw new FileError(`${where} has no parent or order.`);
    seen.add(n.id);
  }
  into.transact(() => {
    const nodes = nodesOf(into);
    for (const n of data.nodes!) {
      const rec = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(n)) {
        if (k === "overrides" && n.type === "instance" && v && typeof v === "object") {
          for (const [path, props] of Object.entries(v)) if (props && typeof props === "object") rec.set(`/${path}`, props);
        } else if (k !== "id" && v !== undefined) rec.set(k, v);
      }
      nodes.set(n.id, rec);
    }
    const vars = varsOf(into);
    for (const [k, v] of Object.entries(data.vars ?? {})) if (typeof v === "string" || typeof v === "number") vars.set(k, v);
  });
}
