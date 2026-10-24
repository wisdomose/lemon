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

export function App({ initial }: { initial: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => attach(canvasRef.current!), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") store.set({ selection: null });
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
          <ContextContent>
            <ContextItem label="Copy" keys="Ctrl C" />
            <ContextSub label="Copy as">
              <ContextItem label="HTML + CSS" />
              <ContextItem label="HTML + Tailwind" />
              <ContextItem label="JSON" />
              <ContextItem label="PNG" keys="Ctrl Shift C" />
            </ContextSub>
            <ContextItem label="Paste here" />
            <ContextItem label="Paste to replace" keys="Ctrl Shift R" />
            <ContextSeparator />
            <ContextItem label="Bring to Front" keys="]" onSelect={() => reorder(true)} />
            <ContextItem label="Send to Back" keys="[" onSelect={() => reorder(false)} />
            <ContextSeparator />
            <ContextItem label="Group selection" keys="Ctrl G" />
            <ContextItem label="Frame selection" keys="Ctrl Alt G" />
            <ContextItem label="Ungroup" keys="Ctrl ⌫" />
            <ContextItem label="Add flex layout" keys="Shift A" onSelect={() => setLayout("column")} />
            <ContextItem label="Remove flex layout" keys="Shift Alt A" onSelect={() => setLayout("none")} />
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
            </ContextSub>
          </ContextContent>
        </ContextRoot>
        <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto">
          <TopBar fileName={`untitled.${PRODUCT.fileExtension}`} saveState="Auto-saved" initial={initial} />
          {panelOpen && <LeftPanel />}
          <ToolRail panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((o) => !o)} />
          {panelOpen && <ChatInput />}
          <PropertiesPanel />
          <ZoomControl />
        </div>
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
