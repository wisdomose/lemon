// The editor window: full-window canvas with the floating islands over it.
import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";
import * as docStore from "../doc/store.js";
import { attach, schedule, setZoom, zoomStep, zoomToFit } from "./canvas/canvas.js";
import { attachGestures, canvasKey, canvasKeyUp } from "./canvas/gestures.js";
import { ChatInput } from "./agent/ChatInput.js";
import { LeftPanel } from "./chrome/LeftPanel.js";
import { PropertiesPanel } from "./chrome/PropertiesPanel.js";
import { ToolRail } from "./chrome/ToolRail.js";
import { TopBar } from "./chrome/TopBar.js";
import { ZoomControl } from "./chrome/ZoomControl.js";
import { bridge, doc, edit, currentScene, history } from "./scene.js";
import { store } from "./store.js";
import { TipProvider } from "./ui/kit.js";
import { ContextContent, ContextItem, ContextRoot, ContextSeparator, ContextSub, ContextTrigger } from "./ui/menu.js";
import { useEditor } from "./store.js";
import { selectAll, selectChildren, selectParents, unionBox, type Laid } from "./canvas/pick.js";
import { SettingsDialog } from "./chrome/SettingsDialog.js";
import { detachSelected, makeComponents } from "./components.js";

export function App({ initial }: { initial: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    const detach = [attach(canvasRef.current!), attachGestures(canvasRef.current!)];
    return () => detach.forEach((d) => d());
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Keys typed into a text field (including the prompt editor) are not shortcuts.
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (canvasKey(e)) schedule();
      else if (mod && e.key === ",") (e.preventDefault(), store.set({ settingsOpen: true }));
      else if (mod && e.altKey && e.code === "KeyK") (e.preventDefault(), makeComponents());
      else if (mod && e.altKey && e.code === "KeyX") (e.preventDefault(), detachSelected());
      else if (mod && key === "z" && !e.shiftKey) (e.preventDefault(), history.undo());
      else if (mod && ((key === "z" && e.shiftKey) || key === "y")) (e.preventDefault(), history.redo());
      else if (e.key === "Escape") store.set({ selection: [] });
      else if (mod && key === "a") (e.preventDefault(), reselect(selectAll));
      else if (e.key === "Enter") (e.preventDefault(), reselect(e.shiftKey ? selectParents : selectChildren));
      else if (e.shiftKey && e.code === "Digit1") zoomToFit();
      else if (e.shiftKey && e.code === "Digit2") {
        const s = currentScene();
        const box = s && unionBox(s.boxes, store.get().selection);
        if (box) zoomToFit(true, box, 32);
      } else if (!mod && e.key === "]") reorder(true);
      else if (!mod && e.key === "[") reorder(false);
      else if (mod && (e.key === "=" || e.key === "+")) (e.preventDefault(), zoomStep(1));
      else if (mod && e.key === "-") (e.preventDefault(), zoomStep(-1));
      else if (mod && e.key === "0") (e.preventDefault(), setZoom(1));
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelection();
      else if (e.key === "\\") setPanelOpen((o) => !o);
      schedule();
    };
    const onKeyUp = (e: KeyboardEvent) => canvasKeyUp(e);
    // The menu bar's editing commands: in a text field they act on its text, elsewhere on the design.
    bridge.onMenuCommand((command) => {
      const target = document.activeElement as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (command === "settings") store.set({ settingsOpen: true });
      else if (command === "toggle-ui") setPanelOpen((o) => !o);
      else if (typing) document.execCommand(command === "select-all" ? "selectAll" : command);
      else if (command === "undo") history.undo();
      else if (command === "redo") history.redo();
      else if (command === "delete") deleteSelection();
      else if (command === "select-all") reselect(selectAll);
      schedule();
    });
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKeyUp);
    return () => (removeEventListener("keydown", onKey), removeEventListener("keyup", onKeyUp));
  }, []);

  return (
    <TipProvider>
      <div className="fixed inset-0 bg-canvas">
        <ContextRoot>
          <ContextTrigger asChild>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          </ContextTrigger>
          <CanvasMenu />
        </ContextRoot>
        <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">
          <TopBar initial={initial} />
          <ToolRail panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((o) => !o)} />
          {panelOpen && (
            // The panel and the chat box share the left column: the chat box grows with its text up to
            // half the column, and the panel gives up that space (measured from the reference).
            <div className="absolute top-[58px] bottom-2 left-2 flex w-[378px] flex-col gap-2">
              <LeftPanel />
              <ChatInput />
            </div>
          )}
          <PropertiesPanel />
          <ZoomControl />
        </div>
        <SettingsHost />
      </div>
      <Toaster position="bottom-center" theme="dark" />
    </TipProvider>
  );
}

/** Replaces the selection by a rule of canvas/pick.ts. */
function reselect(rule: (s: Laid, selection: string[]) => string[]) {
  const s = currentScene();
  if (s) store.set({ selection: rule(s, store.get().selection) });
}

function deleteSelection() {
  const ids = store.get().selection.filter((id) => docStore.exists(doc, id));
  if (!ids.length) return;
  edit(() => ids.forEach((id) => docStore.exists(doc, id) && docStore.remove(doc, id)));
  store.set({ selection: [] });
}

/** Bring to front (`]`) or send to back (`[`), keeping the selected nodes' order among themselves. */
function reorder(front: boolean) {
  const ids = store.get().selection.filter((id) => !docStore.isPart(id));
  edit(() => {
    for (const id of front ? ids : [...ids].reverse()) {
      const parent = docStore.parentOf(doc, id);
      if (parent) docStore.move(doc, id, parent, front ? undefined : 0);
    }
  });
}

function setLayout(layout: "column" | "none") {
  const frames = store.get().selection.filter((id) => docStore.typeOf(doc, id) === "frame");
  if (frames.length) edit(() => frames.forEach((id) => docStore.update(doc, id, { layout })));
}

/** The canvas's right-click menu. Groups and labels follow the reference; items depend on the selection. */
function CanvasMenu() {
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const frames = selection.filter((id) => docStore.typeOf(doc, id) === "frame");
  const flex = frames.length > 0 && frames.every((id) => docStore.propsOf(doc, id).layout !== "none");
  const copies = selection.some((id) => !docStore.isPart(id) && docStore.isInstance(doc, id));
  return (
    <ContextContent>
      <ContextItem label="Copy" keys="Ctrl C" />
      <ContextSub label="Copy as">
        <ContextItem label="Copy as HTML + CSS" />
        <ContextItem label="Copy as HTML + Tailwind" />
        <ContextItem label="Copy as JSON" />
        <ContextItem label="Copy as PNG" keys="Ctrl Shift C" />
      </ContextSub>
      <ContextItem label="Paste here" />
      <ContextItem label="Paste to replace" keys="Ctrl Shift R" />
      <ContextSeparator />
      <ContextItem label="Bring to Front" keys="]" onSelect={() => reorder(true)} />
      <ContextItem label="Send to Back" keys="[" onSelect={() => reorder(false)} />
      <ContextSeparator />
      <ContextItem label="Group selection" keys="Ctrl G" />
      <ContextItem label="Frame selection" keys="Ctrl Alt G" />
      {flex ? (
        <ContextItem label="Remove flex layout" keys="Shift Alt A" onSelect={() => setLayout("none")} />
      ) : (
        <ContextItem label="Add flex layout" keys="Shift A" onSelect={() => setLayout("column")} />
      )}
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

function SettingsHost() {
  const open = useEditor((s) => s.settingsOpen);
  return <SettingsDialog open={open} onOpenChange={(o) => store.set({ settingsOpen: o })} />;
}
