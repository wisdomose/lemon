// Copy as…: the selection on the clipboard as HTML + CSS, HTML + Tailwind, JSON (as a .pen file holds it) or a PNG.
import { toast } from "sonner";
import { nodeAsPen } from "../doc/file.js";
import { findNode } from "../render/screenshot.js";
import { htmlFor } from "./codegen.js";
import { doc, currentScene } from "./scene.js";
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

export async function copyAsHtml(style: "css" | "tailwind"): Promise<void> {
  const s = currentScene();
  const nodes = s ? store.get().selection.map((id) => findNode(s.tree, id)).filter((n): n is NonNullable<typeof n> => !!n) : [];
  const html = s && htmlFor(nodes, s.vars, s.boxes, style);
  if (!html) return void toast("Select something to copy first.");
  await put(html, style === "css" ? "HTML + CSS" : "HTML + Tailwind");
}
