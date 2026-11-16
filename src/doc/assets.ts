// Pictures in a document. In a .pen file a picture is a file beside it, named by an image fill's `url`
// ("./images/hero.jpg"), and that file is where its bytes stay: a board of ten thousand photos is ten
// gigabytes on disk and a few megabytes of document. Only a picture just added is carried in the
// document, in the "assets" map under its url, until the file is saved and it is beside the .pen like
// the rest; then it leaves the map. Each process reads a saved picture when it draws it, through the
// document's reader (the main process and the scripts' process read the file; the window asks the
// main process, see renderer/picture-store.ts). A picture added in Lemon is named after its bytes
// ("./images/<hash>.png"), so the same picture added twice is one file, and a name never changes meaning.
import * as Y from "yjs";
import type { Fills, ImageFill } from "./schema.js";
import { nodesOf } from "./store.js";

/** A picture's bytes by url, for drawing. */
export type Assets = (url: string) => Uint8Array | undefined;

export function assetsOf(doc: Y.Doc): Y.Map<Uint8Array> {
  return doc.getMap("assets");
}

/** The file type of a picture's bytes (what CanvasKit decodes). */
function extensionOf(bytes: Uint8Array): string {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b[0] === 0x47 && b[1] === 0x49) return "gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "webp";
  return "png";
}

/** The url for a picture's bytes: "./images/" and the start of their SHA-256, in hex. */
export async function pictureUrl(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  const name = [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `./images/${name}.${extensionOf(bytes)}`;
}

/** Stores a picture under its url (once). */
export function putAsset(doc: Y.Doc, url: string, bytes: Uint8Array): void {
  const map = assetsOf(doc);
  if (!map.has(url)) map.set(url, bytes);
}

/** Reads a document's saved pictures (the files beside it) in this process. */
export interface PictureReader {
  read(url: string): Uint8Array | undefined;
  /** Whether the picture is there, without reading it. */
  has?(url: string): boolean;
}
const readers = new WeakMap<Y.Doc, PictureReader>();

/** Says where this process finds the document's saved pictures (none: only the ones it carries). */
export function setPictureReader(doc: Y.Doc, reader: PictureReader | undefined): void {
  if (reader) readers.set(doc, reader);
  else readers.delete(doc);
}

/** A picture's bytes: one the document carries (not saved yet), or its file through the reader. */
export const assetLookup = (doc: Y.Doc): Assets => (url) => assetsOf(doc).get(url) ?? readers.get(doc)?.read(url);

/** Whether the document has a picture under `url`: carried, or saved beside it. */
export function hasPicture(doc: Y.Doc, url: string): boolean {
  if (assetsOf(doc).has(url)) return true;
  const r = readers.get(doc);
  return !!r && (r.has ? r.has(url) : !!r.read(url));
}

/** The origin of the change that lets go of pictures once they are saved (nothing to save or redraw). */
export const PICTURES_SAVED = "pictures-saved";

/** Lets go of carried pictures (they are beside the file now). */
export function releaseAssets(doc: Y.Doc, urls: string[]): void {
  const map = assetsOf(doc);
  const held = urls.filter((u) => map.has(u));
  if (held.length) doc.transact(() => held.forEach((u) => map.delete(u)), PICTURES_SAVED);
}

/** Whether a url names a file beside the .pen (not a web address or an empty one). */
export const isLocalUrl = (url: unknown): url is string => typeof url === "string" && url.length > 0 && !/^[a-z][a-z0-9+.-]*:/i.test(url);

/** The image fills in a fill or fill list. */
export function imageFills(fills: Fills | undefined): ImageFill[] {
  const list = Array.isArray(fills) ? fills : fills === undefined ? [] : [fills];
  return list.filter((f): f is ImageFill => !!f && typeof f === "object" && f.type === "image");
}

/** The pictures (local urls) the document's nodes use: in fills and strokes, and in refs' changes. */
export function imageUrls(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  const props = (p: Record<string, unknown> | undefined) => {
    for (const key of ["fill", "stroke"]) for (const f of imageFills(p?.[key] as Fills | undefined)) if (isLocalUrl(f.url)) out.add(f.url);
  };
  for (const [, rec] of nodesOf(doc)) {
    props({ fill: rec.get("fill"), stroke: rec.get("stroke") });
    for (const [k, v] of rec) if (k.startsWith("/")) props(v as Record<string, unknown>);
  }
  return out;
}
