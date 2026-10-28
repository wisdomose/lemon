// Pictures in the window: choosing one for a fill (the colour picker's Image tab), showing one in the
// picker, and dropping picture files onto the canvas, where each becomes an image the size of the
// picture (no wider than MAX_SIDE), in the frame it was dropped on.
import { assetsOf, pictureUrl, putAsset } from "../doc/assets.js";
import { ROOT_ID, type ImageFill, type PenNode } from "../doc/schema.js";
import * as docStore from "../doc/store.js";
import type { PictureSource } from "./ui/ColourPicker.js";
import { flowSlot, flows, frameAt } from "./canvas/place.js";
import { currentScene, doc, edit } from "./scene.js";
import { store } from "./store.js";

/** The picture types the canvas takes (what CanvasKit decodes). */
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** A dropped picture's largest side on the canvas. */
const MAX_SIDE = 1200;

/** Stores a picture file in the document (saved beside the .pen as "./images/…"); its url and natural size. */
async function storeFile(file: Blob): Promise<{ url: string; width: number; height: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = await pictureUrl(bytes);
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  edit(() => putAsset(doc, url, bytes));
  return { url, ...size };
}

/** Asks for a picture file; its fill once stored. */
function choose(): Promise<ImageFill | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT.join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      storeFile(file).then(({ url }) => resolve({ type: "image", url, mode: "cover" }), () => resolve(undefined));
    };
    input.addEventListener("cancel", () => resolve(undefined));
    input.click();
  });
}

const urls = new Map<string, string>();
/** A picture's address for <img> (made once per picture). */
function url(picture: string): string | undefined {
  const known = urls.get(picture);
  if (known) return known;
  const bytes = assetsOf(doc).get(picture);
  if (!bytes) return undefined;
  const made = URL.createObjectURL(new Blob([bytes as BlobPart]));
  urls.set(picture, made);
  return made;
}

export const pictures: PictureSource = { choose, url };

/** Whether a drag carries picture files. */
export const carriesPictures = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file" && ACCEPT.includes(i.type));

/** Places dropped picture files at page point (x, y), side by side, and selects them. */
export async function placePictures(files: File[], x: number, y: number): Promise<void> {
  const stored = await Promise.all(files.filter((f) => ACCEPT.includes(f.type)).map(async (f) => ({ name: f.name.replace(/\.[^.]+$/, ""), ...(await storeFile(f)) })));
  const s = currentScene();
  if (!s || !stored.length) return;
  const container = frameAt(s, x, y);
  const ids: string[] = [];
  let left = x;
  edit(() => {
    for (const p of stored) {
      const k = Math.min(1, MAX_SIDE / Math.max(p.width, p.height));
      const spec: PenNode = { type: "rectangle", name: p.name, width: Math.round(p.width * k), height: Math.round(p.height * k), fill: { type: "image", url: p.url, mode: "cover" } };
      if (flows(container)) ids.push(docStore.insert(doc, container.id, spec, flowSlot(s, container, x, y).index));
      else {
        const cb = container.id === ROOT_ID ? { x: 0, y: 0 } : s.boxes.get(container.id)!;
        ids.push(docStore.insert(doc, container.id, { ...spec, x: Math.round(left - cb.x), y: Math.round(y - cb.y) }));
        left += (spec.width as number) + 20;
      }
    }
  });
  store.set({ selection: ids });
}
