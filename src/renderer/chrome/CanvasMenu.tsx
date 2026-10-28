// The right-click menu on the canvas and on layer rows, and the editing commands it shares with the keyboard.
import * as docStore from "../../doc/store.js";
import { doc, edit } from "../scene.js";
import { store, useEditor } from "../store.js";
import { ContextContent, ContextItem, ContextSeparator, ContextSub } from "../ui/menu.js";
import { detachSelected, makeComponents } from "../components.js";
import { clipboardCommand, frameSelection, groupSelection, pasteHere, pasteToReplace, ungroupSelection } from "../editing.js";
import { lastMenuPoint } from "../canvas/gestures.js";

export function deleteSelection() {
  const ids = store.get().selection.filter((id) => docStore.exists(doc, id));
  if (!ids.length) return;
  edit(() => ids.forEach((id) => docStore.exists(doc, id) && docStore.remove(doc, id)));
  store.set({ selection: [] });
}

/** Bring to front (`]`) or send to back (`[`), keeping the selected nodes' order among themselves. */
export function reorder(front: boolean) {
  const ids = store.get().selection.filter((id) => !docStore.isPart(id));
  edit(() => {
    for (const id of front ? ids : [...ids].reverse()) {
      const parent = docStore.parentOf(doc, id);
      if (parent) docStore.move(doc, id, parent, front ? undefined : 0);
    }
  });
}

export function setLayout(layout: "vertical" | "none") {
  const frames = store.get().selection.filter((id) => docStore.typeOf(doc, id) === "frame");
  if (frames.length) edit(() => frames.forEach((id) => docStore.update(doc, id, { layout })));
}

/** The canvas's right-click menu. Groups and labels follow the reference; items depend on the selection. */
export function CanvasMenu({ inLayers = false }: { inLayers?: boolean }) {
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const frames = selection.filter((id) => docStore.typeOf(doc, id) === "frame");
  const flex = frames.length > 0 && frames.every((id) => docStore.propsOf(doc, id).layout !== "none");
  const copies = selection.some((id) => !docStore.isPart(id) && docStore.isInstance(doc, id));
  return (
    <ContextContent>
      <ContextItem label="Copy" keys="Ctrl C" onSelect={() => clipboardCommand("copy")} />
      <ContextSub label="Copy as">
        <ContextItem label="Copy as HTML + CSS" />
        <ContextItem label="Copy as HTML + Tailwind" />
        <ContextItem label="Copy as JSON" />
        <ContextItem label="Copy as PNG" keys="Ctrl Shift C" />
      </ContextSub>
      {inLayers ? (
        <ContextItem label="Paste" onSelect={() => clipboardCommand("paste")} />
      ) : (
        <ContextItem label="Paste here" onSelect={() => pasteHere(lastMenuPoint())} />
      )}
      <ContextItem label="Paste to replace" keys="Ctrl Shift R" onSelect={pasteToReplace} />
      <ContextSeparator />
      <ContextItem label="Bring to Front" keys="]" onSelect={() => reorder(true)} />
      <ContextItem label="Send to Back" keys="[" onSelect={() => reorder(false)} />
      <ContextSeparator />
      <ContextItem label="Group selection" keys="Ctrl G" onSelect={groupSelection} />
      <ContextItem label="Frame selection" keys="Ctrl Alt G" onSelect={frameSelection} />
      {/* Pen offers Ungroup when a group or frame is selected. */}
      {selection.some((id) => ["group", "frame"].includes(docStore.typeOf(doc, id) ?? "")) && <ContextItem label="Ungroup" keys="Ctrl ⌫" onSelect={ungroupSelection} />}
      {/* As in Pen: Add always, and Remove too when a frame with flex layout is selected. */}
      <ContextItem label="Add flex layout" keys="Shift A" onSelect={() => setLayout("vertical")} />
      {flex && <ContextItem label="Remove flex layout" keys="Shift Alt A" onSelect={() => setLayout("none")} />}
      <ContextSeparator />
      <ContextItem label="Create Component" keys="Ctrl Alt K" onSelect={makeComponents} />
      {copies && <ContextItem label="Detach instance" keys="Ctrl Alt X" onSelect={detachSelected} />}
      <ContextSeparator />
      <ContextItem label="Flip horizontal" keys="Shift H" />
      <ContextItem label="Flip vertical" keys="Shift V" />
      <ContextSeparator />
      <ContextItem label="Delete" keys="⌫" danger onSelect={deleteSelection} />
      <ContextSeparator />
      <ContextSub label="Settings">
        <ContextItem label="Show pixel grid" />
        <ContextItem label="Snap to pixel grid" />
        <ContextItem label="Snap to objects" />
        <ContextItem label="Open settings…" onSelect={() => store.set({ settingsOpen: true })} />
      </ContextSub>
    </ContextContent>
  );
}
