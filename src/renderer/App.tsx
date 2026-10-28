// The editor window: full-window canvas with the floating islands over it.
import { useEffect, useRef } from "react";
import { Toaster } from "sonner";
import { attach, schedule, setZoom, zoomStep, zoomToFit } from "./canvas/canvas.js";
import { attachGestures, canvasKey, canvasKeyUp } from "./canvas/gestures.js";
import { ChatInput } from "./agent/ChatInput.js";
import { LeftPanel } from "./chrome/LeftPanel.js";
import { PropertiesPanel } from "./chrome/PropertiesPanel.js";
import { ToolRail } from "./chrome/ToolRail.js";
import { TopBar } from "./chrome/TopBar.js";
import { ZoomControl } from "./chrome/ZoomControl.js";
import { bridge, currentScene, history } from "./scene.js";
import { store } from "./store.js";
import { TipProvider } from "./ui/kit.js";
import { ContextRoot, ContextTrigger } from "./ui/menu.js";
import { useEditor } from "./store.js";
import { selectAll, selectChildren, selectParents, unionBox, type Laid } from "./canvas/pick.js";
import { SettingsDialog } from "./chrome/SettingsDialog.js";
import { detachSelected, makeComponents } from "./components.js";
import { CanvasMenu, deleteSelection, reorder } from "./chrome/CanvasMenu.js";
import { BrowserLiveBar, BrowserUrlField, CardKindMenu } from "./chrome/CanvasFields.js";
import { pageKey } from "./canvas/live-pages.js";
import { exportSelection, type ExportFormat } from "./export.js";
import { sharedCommand } from "./settings.js";
import { CommentLayer, CommentsPanel } from "./chrome/Comments.js";
import { ShortcutsDialog } from "./chrome/ShortcutsDialog.js";
import { CommandPalette } from "./chrome/CommandPalette.js";
import { duplicateSelection, frameSelection, groupSelection, onCopy, onPaste, ungroupSelection } from "./editing.js";

export function App({ initial }: { initial: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelOpen = useEditor((s) => s.panelOpen);
  // The Comment tool swaps the properties panel for the comments, as in Pen.
  const commenting = useEditor((s) => s.tool === "comment");
  const setPanelOpen = (fn: (o: boolean) => boolean) => store.set((s) => ({ panelOpen: fn(s.panelOpen) }));
  useEffect(() => {
    const detach = [attach(canvasRef.current!), attachGestures(canvasRef.current!)];
    return () => detach.forEach((d) => d());
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Keys typed into a text field (including the prompt editor) are not shortcuts.
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      // A browser page in use takes the keys; Escape stops using it.
      const live = store.get().browserLive;
      if (live) {
        e.preventDefault();
        if (e.key === "Escape") store.set({ browserLive: null });
        else pageKey(live, e, "keyDown");
        schedule();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (canvasKey(e)) schedule();
      else if (mod && e.key === ",") (e.preventDefault(), store.set({ settingsOpen: true }));
      else if (mod && key === "p") (e.preventDefault(), store.set({ paletteOpen: true }));
      else if (!mod && e.key === "?") store.set({ shortcutsOpen: true });
      else if (!mod && e.shiftKey && key === "c") store.set((s) => ({ showComments: !s.showComments }));
      else if (mod && e.altKey && e.code === "KeyG") (e.preventDefault(), frameSelection());
      else if (mod && e.shiftKey && e.code === "KeyG") (e.preventDefault(), ungroupSelection());
      else if (mod && e.code === "KeyG") (e.preventDefault(), groupSelection());
      else if (mod && e.key === "Backspace") (e.preventDefault(), ungroupSelection());
      else if (mod && e.code === "KeyD") (e.preventDefault(), duplicateSelection());
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
    const onKeyUp = (e: KeyboardEvent) => {
      const live = store.get().browserLive;
      if (live) pageKey(live, e, "keyUp");
      else canvasKeyUp(e);
    };
    // The menu bar's editing commands: in a text field they act on its text, elsewhere on the design.
    bridge.onMenuCommand((command) => {
      const target = document.activeElement as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (command === "settings") store.set({ settingsOpen: true });
      else if (command === "toggle-ui") setPanelOpen((o) => !o);
      else if (sharedCommand(command)) return;
      else if (command.startsWith("export-")) void exportSelection(command.slice(7) as ExportFormat);
      else if (typing) document.execCommand(command === "select-all" ? "selectAll" : command);
      else if (command === "undo") history.undo();
      else if (command === "redo") history.redo();
      else if (command === "delete") deleteSelection();
      else if (command === "select-all") reselect(selectAll);
      schedule();
    });
    // Copy, cut and paste (keys, the Edit menu, the palette): in a text field they act on its text.
    const typing = (e: Event) => {
      const t = e.target as HTMLElement;
      return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
    };
    const copy = (e: ClipboardEvent) => typing(e) || onCopy(e, false);
    const cut = (e: ClipboardEvent) => typing(e) || onCopy(e, true);
    const paste = (e: ClipboardEvent) => typing(e) || onPaste(e);
    addEventListener("keydown", onKey);
    addEventListener("keyup", onKeyUp);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", paste);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKeyUp);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", paste);
    };
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
          <TopBar bridge={bridge} initial={initial} />
          <ToolRail panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((o) => !o)} />
          {panelOpen && (
            // The panel and the chat box share the left column: the chat box grows with its text up to
            // half the column, and the panel gives up that space (measured from the reference).
            <div className="absolute top-[58px] bottom-2 left-2 flex w-[378px] flex-col gap-2">
              <LeftPanel />
              <ChatInput />
            </div>
          )}
          {commenting ? <CommentsPanel /> : <PropertiesPanel />}
          <CardKindMenu />
          <BrowserUrlField />
          <BrowserLiveBar />
          <ZoomControl />
          <CommentLayer />
        </div>
        <SettingsHost />
        <ShortcutsDialog />
        <CommandPalette />
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

function SettingsHost() {
  const open = useEditor((s) => s.settingsOpen);
  return <SettingsDialog open={open} onOpenChange={(o) => store.set({ settingsOpen: o })} />;
}
