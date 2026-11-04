// File › Export Selection to…: the selection drawn at its own size (1x) as PNG, JPEG or WebP, saved
// where the person chooses. Several selected nodes go into one picture of everything they cover.
import { drawNode } from "../render/draw.js";
import { findNode } from "../render/screenshot.js";
import { assets, bridge, currentScene, engine } from "./scene.js";
import { store } from "./store.js";
import { unionBox } from "./canvas/pick.js";
import { toast } from "sonner";

export type ExportFormat = "png" | "jpeg" | "webp";

export async function exportSelection(format: ExportFormat): Promise<void> {
  const s = currentScene();
  const ids = store.get().selection;
  const box = s && unionBox(s.boxes, ids);
  if (!s || !box) return void toast("Select something to export first.");
  const { ck } = engine;
  const width = Math.max(1, Math.round(box.w));
  const height = Math.max(1, Math.round(box.h));
  const surface = ck.MakeSurface(width, height);
  if (!surface) return void toast("Couldn't draw the selection.");
  let bytes: Uint8Array | null = null;
  try {
    const canvas = surface.getCanvas();
    // JPEG has no transparency: a white background, as for a page.
    canvas.clear(format === "jpeg" ? ck.WHITE : ck.TRANSPARENT);
    canvas.translate(-box.x, -box.y);
    for (const id of ids) {
      const node = findNode(s.tree, id);
      if (node) drawNode({ ck, text: engine.text, vars: s.vars, boxes: s.boxes, assets }, canvas, node);
    }
    const image = surface.makeImageSnapshot();
    if (format === "png") bytes = image.encodeToBytes(ck.ImageFormat.PNG, 100);
    else {
      // This CanvasKit encodes only PNG: the page's own canvas encodes JPEG and WebP.
      const pixels = image.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
      if (pixels) {
        const page = new OffscreenCanvas(width, height);
        page.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
        const blob = await page.convertToBlob({ type: format === "jpeg" ? "image/jpeg" : "image/webp", quality: 0.92 });
        bytes = new Uint8Array(await blob.arrayBuffer());
      }
    }
    image.delete();
  } finally {
    surface.delete();
  }
  if (!bytes) return void toast(`Couldn't make a ${format.toUpperCase()} of the selection.`);
  const first = findNode(s.tree, ids[0]!);
  const name = String(first?.props.name ?? first?.type ?? "Export").replace(/[\\/:*?"<>|]/g, "-");
  await bridge.saveExport(bytes, name, format === "jpeg" ? "jpg" : format);
}
