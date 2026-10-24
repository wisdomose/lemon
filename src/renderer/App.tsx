// The editor window: full-window canvas with the floating islands over it.
import { useEffect, useRef, useState } from "react";
import { PRODUCT } from "../product.js";
import { Toaster } from "sonner";
import * as docStore from "../doc/store.js";
import { attach, schedule, setZoom, zoomStep, zoomToFit } from "./canvas/canvas.js";
import { ChatInput } from "./agent/ChatInput.js";
import { LeftPanel } from "./chrome/LeftPanel.js";
import { PropertiesPanel } from "./chrome/PropertiesPanel.js";
import { ToolRail } from "./chrome/ToolRail.js";
import { TopBar } from "./chrome/TopBar.js";
import { ZoomControl } from "./chrome/ZoomControl.js";
import { doc, edit, currentScene } from "./scene.js";
import { store } from "./store.js";
import { TipProvider } from "./ui/kit.js";
import { ContextContent, ContextItem, ContextRoot, ContextSeparator, ContextSub, ContextTrigger } from "./ui/menu.js";
import { useEditor } from "./store.js";
import { SettingsDialog } from "./chrome/SettingsDialog.js";

export function App({ initial }: { initial: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => attach(canvasRef.current!), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === ",") (e.preventDefault(), store.set({ settingsOpen: true }));
      else if (e.key === "Escape") store.set({ selection: null });
      else if (e.shiftKey && e.code === "Digit1") zoomToFit();
      else if (e.shiftKey && e.code === "Digit2") {
        const id = store.get().selection;
        const box = id ? currentScene()?.boxes.get(id) : undefined;
        if (box) zoomToFit(true, box, 32);
      } else if (mod && (e.key === "=" || e.key === "+")) (e.preventDefault(), zoomStep(1));
      else if (mod && e.key === "-") (e.preventDefault(), zoomStep(-1));
      else if (mod && e.key === "0") (e.preventDefault(), setZoom(1));
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelection();
      else if (!mod && e.key === "\\") setPanelOpen((o) => !o);
      schedule();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
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
          <TopBar fileName={`untitled.${PRODUCT.fileExtension}`} saveState="Auto-saved" initial={initial} />
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

function deleteSelection() {
  const id = store.get().selection;
  if (!id || !docStore.exists(doc, id)) return;
  edit(() => docStore.remove(doc, id));
  store.set({ selection: null });
}

function reorder(front: boolean) {
  const id = store.get().selection;
  const parent = id ? docStore.parentOf(doc, id) : undefined;
  if (!id || !parent) return;
  edit(() => docStore.move(doc, id, parent, front ? undefined : 0));
}

function setLayout(layout: "column" | "none") {
  const id = store.get().selection;
  if (!id || docStore.typeOf(doc, id) !== "frame") return;
  edit(() => docStore.update(doc, id, { layout }));
}

/** The canvas's right-click menu. Groups and labels follow the reference; items depend on the selection. */
function CanvasMenu() {
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const type = selection ? docStore.typeOf(doc, selection) : undefined;
  const flex = type === "frame" && docStore.propsOf(doc, selection!).layout !== "none";
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
      <ContextItem label="Create Component" keys="Ctrl Alt K" />
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
