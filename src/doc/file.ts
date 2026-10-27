// The design file: Pen's .pen (JSON, schema version 2.21; see doc/schema.ts). The document is written
// as Pen writes it — `version`, the node tree under `children`, then `themes`, `imports` and
// `variables` — two-space indented. Every property a node carries is written back as it was read,
// including ones this version doesn't draw, so opening and saving a file loses nothing.
//
// Pictures are files beside the .pen, named by `url` in image fills ("./images/…"), as in Pen. In the
// document they are kept by that url (doc/assets.ts); saving writes the ones not on disk yet.
//
// Older files (2.x before 2.21, such as the ones Pen ships) are brought up to 2.21 as they are read:
//   icon_font { iconFontFamily, iconFontName } → icon { icon, library }
//   stroke { align, thickness, join, cap, fill } → stroke, strokeWidth, strokeAlignment, strokeLinejoin,
//     strokeLinecap ("inside" → "inner", "outside" → "outer"; "center" is the default, so it's left out)
//   image fill mode "fill" / "fit" → "cover" / "contain"
// (checked against Pen saving an older file; Pen keeps `line` nodes as they are.)
//
// Only the document is saved; the undo history and the live-editing state start afresh when a file
// is opened.
import * as Y from "yjs";
import { generateNKeysBetween } from "fractional-indexing";
import { NODE_TYPES, PEN_VERSION, ROOT_ID, type PenDocument, type PenNode, type Themes, type Variables } from "./schema.js";
import { childIds, insertAsIs, metaOf, nodesOf, refAsPen, variablesOf } from "./store.js";
import { assetsOf, imageUrls } from "./assets.js";

export class FileError extends Error {}

const KNOWN_TOP = new Set(["version", "children", "themes", "imports", "variables"]);

/** A node and its subtree as Pen writes it. */
export function nodeAsPen(doc: Y.Doc, id: string): PenNode {
  const rec = nodesOf(doc).get(id)!;
  const type = rec.get("type") as PenNode["type"];
  if (type === "ref") return refAsPen(doc, id, (c) => nodeAsPen(doc, c));
  const out: PenNode = { type, id };
  for (const [k, v] of rec) if (k !== "type" && k !== "parent" && k !== "order" && k !== "within" && k !== "replaces" && !k.startsWith("/")) out[k] = v;
  const kids = childIds(doc, id);
  if (kids.length) out.children = kids.map((c) => nodeAsPen(doc, c));
  return out;
}

/** Which of two "2.x" versions is newer. */
function newer(a: string, b: string): string {
  const parts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? a : b;
  return a;
}

/** The document as a .pen file. */
export function toPen(doc: Y.Doc): PenDocument {
  const meta = metaOf(doc);
  const read = meta.get("version");
  const out: PenDocument = { version: typeof read === "string" ? newer(read, PEN_VERSION) : PEN_VERSION, children: childIds(doc, ROOT_ID).map((id) => nodeAsPen(doc, id)) };
  const themes = meta.get("themes") as Themes | undefined;
  if (themes && Object.keys(themes).length) out.themes = themes;
  const imports = meta.get("imports") as Record<string, string> | undefined;
  if (imports && Object.keys(imports).length) out.imports = imports;
  for (const [k, v] of meta) if (!KNOWN_TOP.has(k)) (out as unknown as Record<string, unknown>)[k] = v;
  const variables = Object.fromEntries(variablesOf(doc).entries()) as Variables;
  if (Object.keys(variables).length) out.variables = variables;
  return out;
}

/** The file's text: JSON, two-space indented, as Pen writes it. */
export function fileText(doc: Y.Doc): string {
  return JSON.stringify(toPen(doc), null, 2) + "\n";
}

/** The pictures to write beside the file: each image url the document uses and has bytes for. */
export function picturesOf(doc: Y.Doc): { url: string; bytes: Uint8Array }[] {
  const store = assetsOf(doc);
  return [...imageUrls(doc)].flatMap((url) => {
    const bytes = store.get(url);
    return bytes ? [{ url, bytes }] : [];
  });
}

// ---- Bringing older files up to 2.21 ----------------------------------------------------------------
const STROKE_ALIGN: Record<string, string> = { inside: "inner", center: "center", outside: "outer" };
const IMAGE_MODE: Record<string, string> = { fill: "cover", fit: "contain" };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** One fill or fill list with old picture modes renamed. */
function migrateFills(v: unknown): unknown {
  const one = (f: unknown) => (isObject(f) && f.type === "image" && typeof f.mode === "string" && IMAGE_MODE[f.mode] ? { ...f, mode: IMAGE_MODE[f.mode] } : f);
  return Array.isArray(v) ? v.map(one) : one(v);
}

/** A node's (or a change's) properties in 2.21's names. */
function migrateProps(n: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === "iconFontName") out.icon = v;
    else if (k === "iconFontFamily") out.library = v;
    else if (k === "stroke" && isObject(v) && typeof v.type !== "string") {
      // The old stroke: one object with its paint under `fill`.
      if (v.fill !== undefined) out.stroke = migrateFills(v.fill);
      if (v.thickness !== undefined) out.strokeWidth = v.thickness;
      if (typeof v.align === "string" && v.align !== "center") out.strokeAlignment = STROKE_ALIGN[v.align] ?? v.align;
      if (v.join !== undefined) out.strokeLinejoin = v.join;
      if (v.cap !== undefined) out.strokeLinecap = v.cap;
    } else if (k === "fill" || k === "stroke") out[k] = migrateFills(v);
    else out[k] = v;
  }
  return out;
}

/** A node and its subtree in 2.21's terms. */
function migrateNode(n: unknown): PenNode {
  if (!isObject(n)) return n as PenNode;
  const out = migrateProps(n);
  if (out.type === "icon_font") out.type = "icon";
  if (Array.isArray(out.children)) out.children = out.children.map(migrateNode);
  if (isObject(out.descendants)) {
    out.descendants = Object.fromEntries(Object.entries(out.descendants).map(([path, d]) => [path, typeof (d as { type?: unknown })?.type === "string" ? migrateNode(d) : migrateChange(d)]));
  }
  return out as PenNode;
}

/** A ref's change to one of its component's nodes (properties, and maybe the children it fills it with). */
function migrateChange(d: unknown): unknown {
  if (!isObject(d)) return d;
  const out = migrateProps(d);
  if (Array.isArray(out.children)) out.children = out.children.map(migrateNode);
  return out;
}

// ---- Reading ------------------------------------------------------------------------------------------
/** Checks the tree before anything is stored, so a broken file is refused whole. */
function validate(nodes: unknown[], where: string): void {
  nodes.forEach((n, i) => {
    const at = `${where}${i + 1}`;
    if (!isObject(n)) throw new FileError(`Node ${at} isn't an object.`);
    if (!NODE_TYPES.includes(n.type as never)) throw new FileError(`Node ${at}${typeof n.id === "string" ? ` ("${n.id}")` : ""} has an unknown type "${String(n.type)}".`);
    if (n.type === "ref" && typeof n.ref !== "string") throw new FileError(`Node ${at} is a ref without \`ref\`.`);
    if (Array.isArray(n.children)) validate(n.children, `${at}.`);
  });
}

export interface ReadReport {
  /** Picture files the document refers to that weren't found. */
  missingPictures: string[];
}

/**
 * Reads a .pen file's text into an empty document. `read` gives a picture file's bytes by the url
 * the file uses (relative to the file). Throws FileError for anything that isn't a .pen file.
 */
export function readFile(text: string, into: Y.Doc, read?: (url: string) => Uint8Array | undefined): ReadReport {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new FileError(`This isn't a .pen file (it isn't valid JSON: ${(e as Error).message}).`);
  }
  if (!isObject(data) || !Array.isArray(data.children)) throw new FileError("This isn't a .pen file.");
  const version = typeof data.version === "string" ? data.version : PEN_VERSION;
  if (!version.startsWith("2.")) throw new FileError(`This .pen file is version ${version}; only version 2 files can be opened.`);
  const children = data.children.map(migrateNode);
  validate(children, "");
  const report: ReadReport = { missingPictures: [] };
  into.transact(() => {
    const keys = generateNKeysBetween(null, null, children.length);
    children.forEach((n, i) => insertAsIs(into, ROOT_ID, n, keys[i]!));
    const meta = metaOf(into);
    meta.set("version", version);
    for (const [k, v] of Object.entries(data)) if (k !== "children" && k !== "variables" && k !== "version" && v !== undefined) meta.set(k, v);
    const vars = variablesOf(into);
    if (isObject(data.variables)) for (const [k, v] of Object.entries(data.variables)) if (isObject(v)) vars.set(k, v as never);
    if (read) {
      const pictures = assetsOf(into);
      for (const url of imageUrls(into)) {
        const bytes = read(url);
        if (bytes) pictures.set(url, bytes);
        else report.missingPictures.push(url);
      }
    }
  });
  return report;
}
