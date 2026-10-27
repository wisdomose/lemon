// Pictures in a document. In a .pen file a picture is a file beside it, named by an image fill's `url`
// ("./images/hero.jpg"); the document keeps each picture's bytes in the "assets" map under that url,
// so drawing never touches the disk and saving can write the ones that aren't there yet. A picture
// added in Lemon is named after its bytes ("./images/<hash>.png"), so the same picture added twice is
// one file, and a name never changes meaning.
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

export const assetLookup = (doc: Y.Doc): Assets => (url) => assetsOf(doc).get(url);

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
