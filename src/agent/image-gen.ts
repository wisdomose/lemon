// Images made by an image model, as Pen's Generate("ai", …): a script marks the node's fill with a
// pending url during the call, and the picture lands after the script has returned. The main process
// asks the model (an OpenAI-style /v1/images/generations endpoint, set up in Settings → Images) and
// then rewrites the pending url, wherever it is in the document, to the picture's own url. A picture
// that can't be made leaves no url behind: its image fill is taken off again, as in Pen.
import type * as Y from "yjs";
import { pictureUrl, putAsset } from "../doc/assets.js";
import type { Fill, Fills } from "../doc/schema.js";
import { nodesOf } from "../doc/store.js";

/** A picture asked for by a script, waiting to be made. */
export interface Generation {
  /** The pending url the node's fill holds until the picture arrives. */
  url: string;
  prompt: string;
  /** The node's size when it was asked for, for the picture's shape. */
  width: number;
  height: number;
}

/** Where the image model is, and its key. */
export interface ImageModel {
  baseUrl: string;
  apiKey: string;
}

/** What Settings → Images shows: the server, and a masked preview of the key when one is saved. */
export interface ImageSettings {
  baseUrl: string;
  keyMasked?: string;
}

export const DEFAULT_IMAGE_SERVER = "https://images.chat-buddy.xyz";

const PENDING = "lemon:pending-image-";
export const isPendingImage = (url: unknown): url is string => typeof url === "string" && url.startsWith(PENDING);
export const pendingImageUrl = (): string => PENDING + crypto.randomUUID();

/** The longest side asked of the model, and the shortest. The model works in steps of 64 pixels. */
const LONG_SIDE = 768;
const SHORT_MIN = 256;
const STEP = 64;

/** The picture size for a node: its shape, with the longest side at LONG_SIDE, in steps of 64. */
export function pictureSize(width: number, height: number): { width: number; height: number } {
  const w = width > 0 ? width : 1;
  const h = height > 0 ? height : 1;
  const round = (n: number) => Math.min(LONG_SIDE, Math.max(SHORT_MIN, Math.round(n / STEP) * STEP));
  return w >= h ? { width: LONG_SIDE, height: round((LONG_SIDE * h) / w) } : { width: round((LONG_SIDE * w) / h), height: LONG_SIDE };
}

/** Asks the model for one picture; resolves to its bytes (PNG) or throws with what went wrong. */
export async function requestPicture(model: ImageModel, g: Pick<Generation, "prompt" | "width" | "height">, signal?: AbortSignal): Promise<Uint8Array> {
  const base = model.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const size = pictureSize(g.width, g.height);
  const res = await fetch(`${base}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: g.prompt, n: 1, size: `${size.width}x${size.height}`, response_format: "b64_json" }),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  let body: { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } } | undefined;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(body?.error?.message ?? `The image server answered ${res.status}.`);
  const first = body?.data?.[0];
  if (first?.b64_json) return new Uint8Array(Buffer.from(first.b64_json, "base64"));
  if (first?.url) {
    const pic = await fetch(first.url, signal ? { signal } : {});
    if (!pic.ok) throw new Error(`The picture couldn't be downloaded (${pic.status}).`);
    return new Uint8Array(await pic.arrayBuffer());
  }
  throw new Error("The image server sent no picture.");
}

/** A fill or fill list with `from`'s image url changed to `to` (or, with no `to`, those image fills taken out). */
function swapped(fills: Fills, from: string, to: string | undefined): Fills | undefined {
  const one = (f: Fill): Fill | undefined =>
    f && typeof f === "object" && f.type === "image" && f.url === from ? (to ? { ...f, url: to } : undefined) : f;
  if (!Array.isArray(fills)) return one(fills as Fill);
  return fills.map(one).filter((f): f is Fill => f !== undefined);
}

const holds = (fills: unknown, url: string): boolean =>
  (Array.isArray(fills) ? fills : [fills]).some((f) => !!f && typeof f === "object" && (f as { url?: unknown }).url === url);

/**
 * Puts a made picture where its pending url is (or, with no bytes, takes that image fill off): in nodes'
 * fills and strokes, and in instances' changes. Returns whether any node still held the url.
 */
export async function landPicture(doc: Y.Doc, pending: string, bytes: Uint8Array | undefined, origin: unknown): Promise<boolean> {
  const url = bytes ? await pictureUrl(bytes) : undefined;
  let found = false;
  doc.transact(() => {
    const fix = (props: Record<string, unknown>, set: (key: string, v: unknown) => void, remove: (key: string) => void) => {
      for (const key of ["fill", "stroke"]) {
        const v = props[key];
        if (v === undefined || !holds(v, pending)) continue;
        found = true;
        const next = swapped(v as Fills, pending, url);
        if (next === undefined || (Array.isArray(next) && !next.length)) remove(key);
        else set(key, next);
      }
    };
    for (const [, rec] of nodesOf(doc)) {
      fix({ fill: rec.get("fill"), stroke: rec.get("stroke") }, (k, v) => rec.set(k, v), (k) => rec.delete(k));
      for (const [k, v] of rec) {
        if (!k.startsWith("/") || !v || typeof v !== "object") continue;
        const part = { ...(v as Record<string, unknown>) };
        let changed = false;
        fix(part, (key, val) => ((part[key] = val), (changed = true)), (key) => (delete part[key], (changed = true)));
        if (changed) rec.set(k, part);
      }
    }
    if (found && url && bytes) putAsset(doc, url, bytes);
  }, origin);
  return found;
}

/** Makes each picture a script asked for and lands it in `doc`; failures are logged and leave no url. */
export function makePictures(doc: Y.Doc, generations: Generation[], origin: unknown, model: () => ImageModel | undefined, log: (msg: string) => void): Promise<void> {
  return Promise.all(
    generations.map(async (g) => {
      let bytes: Uint8Array | undefined;
      try {
        const m = model();
        if (!m) throw new Error("No image model key is set (Settings → Images).");
        bytes = await requestPicture(m, g);
      } catch (e) {
        log(`image generation failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!doc.isDestroyed) await landPicture(doc, g.url, bytes, origin);
    }),
  ).then(() => undefined);
}
