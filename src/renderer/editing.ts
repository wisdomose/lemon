// The window's clipboard, duplicate and grouping actions on the selection (the rules are in arrange.ts).
// Copy, cut and paste run on the page's clipboard events, so the keys, the Edit menu and the palette
// (through the host) all come here.
import * as docStore from "../doc/store.js";
import { bridge, currentScene, doc, edit } from "./scene.js";
import { store } from "./store.js";
import { pageInView, schedule } from "./canvas/canvas.js";
import { copyNodes, duplicateNodes, groupNodes, pasteAt, pasteNodes, pasteReplacing, readClip, ungroupNodes } from "./arrange.js";

/** This window's mark on what it copies, so a paste here knows the nodes' places on the page. */
const SOURCE = crypto.randomUUID();

/** Runs one change to the selection as one undo step, then selects what it returns. */
function change(fn: (ids: string[]) => string[] | string | null): void {
  const ids = store.get().selection;
  if (!currentScene()) return;
  let next: string[] | string | null = null;
  edit(() => (next = fn(ids)));
  const list = typeof next === "string" ? [next] : (next ?? []);
  if (list.length) store.set({ selection: list });
  schedule();
}

export const groupSelection = () => change((ids) => groupNodes(doc, currentScene()!, ids, "group"));
export const frameSelection = () => change((ids) => groupNodes(doc, currentScene()!, ids, "frame"));
export const ungroupSelection = () => change((ids) => ungroupNodes(doc, currentScene()!, ids));
export const duplicateSelection = () => change((ids) => duplicateNodes(doc, currentScene()!, ids));

/** Copy, Cut and Paste from the palette or a menu: the host sends the page the clipboard event. */
export const clipboardCommand = (command: "copy" | "cut" | "paste") => void bridge.appCommand(command);

/** A copy or cut event outside a text field: the selection goes on the clipboard as Pen puts it there. */
export function onCopy(e: ClipboardEvent, cut: boolean): void {
  const clip = copyNodes(doc, store.get().selection, SOURCE);
  if (!clip || !e.clipboardData) return;
  e.preventDefault();
  e.clipboardData.setData("text/html", clip.html);
  e.clipboardData.setData("text/plain", clip.text);
  if (cut) {
    // A node inside another cut node is gone with it.
    edit(() => clip.ids.forEach((id) => docStore.exists(doc, id) && docStore.remove(doc, id)));
    store.set({ selection: [] });
    schedule();
  }
}

/** What the next paste event does instead of an ordinary paste (Paste here, Paste to replace). */
let pending: { at: { x: number; y: number } } | "replace" | null = null;

/** Paste here: the copy's top-left at a page point (where the canvas menu was opened). */
export function pasteHere(at: { x: number; y: number }): void {
  pending = { at };
  clipboardCommand("paste");
}

/** Paste to replace (Ctrl+Shift+R): the copy takes the selected nodes' places. */
export function pasteToReplace(): void {
  if (!store.get().selection.length) return;
  pending = "replace";
  clipboardCommand("paste");
}

/** A paste event outside a text field: nodes copied in Pen or Lemon go in. */
export function onPaste(e: ClipboardEvent): void {
  const mode = pending;
  pending = null;
  const clip = readClip(e.clipboardData?.getData("text/html") ?? "");
  if (!clip) return;
  e.preventDefault();
  const here = clip.source === SOURCE;
  const s = currentScene()!;
  if (mode === "replace") change((ids) => pasteReplacing(doc, s, clip, ids, here));
  else if (mode) change(() => pasteAt(doc, s, clip, mode.at, here));
  else change((ids) => pasteNodes(doc, s, clip, ids, pageInView(), here));
}
