// Pictures in a document. Each is stored once in the "assets" map under an id made from its bytes
// (so the same picture added twice is stored once, and an id never changes meaning), and shapes
// show it with an image fill ({ type: "image", asset: id }). Files save only the pictures in use.
import * as Y from "yjs";
import type { NodeProps, Paint } from "./schema.js";
import { nodesOf } from "./store.js";

/** A picture's bytes by id, for drawing. */
export type Assets = (id: string) => Uint8Array | undefined;

export function assetsOf(doc: Y.Doc): Y.Map<Uint8Array> {
  return doc.getMap("assets");
}

/** The id for a picture's bytes: the start of their SHA-256, in hex. */
export async function assetId(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores a picture under its id (once). */
export function putAsset(doc: Y.Doc, id: string, bytes: Uint8Array): void {
  const map = assetsOf(doc);
  if (!map.has(id)) map.set(id, bytes);
}

export const assetLookup = (doc: Y.Doc): Assets => (id) => assetsOf(doc).get(id);

const isImage = (p: unknown): p is Extract<Paint, { type: "image" }> =>
  !!p && typeof p === "object" && (p as { type?: unknown }).type === "image" && typeof (p as { asset?: unknown }).asset === "string";

/** The pictures the document's nodes use (their own fills and copies' changes to their parts). */
export function assetsUsed(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  const props = (p: Partial<NodeProps> | undefined) => {
    if (isImage(p?.fill)) out.add(p.fill.asset);
  };
  for (const [, rec] of nodesOf(doc)) {
    props({ fill: rec.get("fill") as Paint | undefined });
    for (const [k, v] of rec) if (k.startsWith("/")) props(v as Partial<NodeProps>);
  }
  return out;
}
