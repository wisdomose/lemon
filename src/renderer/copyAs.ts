// Copy as…: the selection on the clipboard as HTML + CSS, HTML + Tailwind, JSON (as a .pen file holds it) or a PNG.
import { toast } from "sonner";
import { nodeAsPen } from "../doc/file.js";
import { findNode } from "../render/screenshot.js";
import { htmlFor, type CodegenOptions } from "./codegen.js";
import { assets, doc, currentScene, engine, fontFamilies } from "./scene.js";
import { store } from "./store.js";
import { renderSelection } from "./export.js";

async function put(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied as ${what}.`);
  } catch {
    toast(`Couldn't copy as ${what}.`);
  }
}

export async function copyAsPng(): Promise<void> {
  const out = await renderSelection("png", "copy");
  if (!out) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([out.bytes as BlobPart], { type: "image/png" }) })]);
    toast("Copied as PNG.");
  } catch {
    toast("Couldn't copy the picture.");
  }
}

export async function copyAsJson(): Promise<void> {
  const ids = store.get().selection;
  const s = currentScene();
  const list = s ? ids.filter((id) => findNode(s.tree, id)) : [];
  if (!list.length) return void toast("Select something to copy first.");
  const nodes = list.map((id) => nodeAsPen(doc, id));
  await put(JSON.stringify(nodes.length === 1 ? nodes[0] : nodes, null, 2), "JSON");
}

/** A picture's bytes as a data: URL, typed by what the bytes are. */
function dataUrl(bytes: Uint8Array): string {
  const b = bytes;
  const type = b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : b[0] === 0x47 && b[1] === 0x49 ? "image/gif" : b[0] === 0x52 && b[8] === 0x57 ? "image/webp" : b[0] === 0x3c ? "image/svg+xml" : "image/png";
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** What the generator needs from the document and the engine. */
export function codegenOptions(): CodegenOptions {
  const urls = new Map<string, string | undefined>();
  const web = new Set(fontFamilies);
  return {
    webFont: (family) => web.has(family),
    // The document's own pictures go in the copy, so it shows them wherever it is pasted.
    picture(url) {
      if (!urls.has(url)) {
        const bytes = assets(url);
        urls.set(url, bytes ? dataUrl(bytes) : undefined);
      }
      return urls.get(url);
    },
    pathBounds(d) {
      const path = engine.ck.Path.MakeFromSVGString(d);
      if (!path) return null;
      const [l, t, r, b] = path.getBounds();
      path.delete();
      return [l!, t!, r! - l!, b! - t!];
    },
  };
}

export async function copyAsHtml(style: "css" | "tailwind"): Promise<void> {
  const s = currentScene();
  const nodes = s ? store.get().selection.map((id) => findNode(s.tree, id)).filter((n): n is NonNullable<typeof n> => !!n) : [];
  const html = s && htmlFor(nodes, s.vars, s.boxes, style, codegenOptions());
  if (!html) return void toast("Select something to copy first.");
  await put(html, style === "css" ? "HTML + CSS" : "HTML + Tailwind");
}
