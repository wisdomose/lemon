// The command palette (Ctrl+P, or the rail's "…"), as Pen's: every action by group, with its keys; an
// action that can't run now is dimmed with why ("Nothing selected"); settings are switches. Typing
// narrows the list (the match underlined); arrows and Enter pick. Actions Lemon doesn't have yet are
// listed as Pen lists them and say so.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Braces,
  Camera,
  Clipboard,
  Code,
  Component,
  Copy,
  CornerLeftUp,
  Crop,
  Diamond,
  Download,
  Eye,
  FileDown,
  FileInput,
  FilePlus,
  FileUp,
  Files,
  FlipHorizontal2,
  FlipVertical2,
  Folder,
  FolderOpen,
  Frame,
  Globe,
  Group,
  Hand,
  Image,
  Keyboard,
  LayoutGrid,
  Layers,
  Library,
  MessageCircle,
  MousePointer2,
  PanelLeft,
  PanelRight,
  PenTool,
  Pipette,
  Play,
  Presentation,
  Redo2,
  Rows3,
  Save,
  Scaling,
  Scissors,
  Search,
  Settings as Cog,
  Square,
  SquareDashed,
  Sun,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Ungroup,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
  Circle,
  Smile,
  StickyNote,
  RotateCw,
  RotateCcw,
  Grid3x3,
  Magnet,
  Sparkles,
  MousePointerClick,
} from "lucide-react";
import * as docStore from "../../doc/store.js";
import { ROOT_ID, type TreeNode } from "../../doc/schema.js";
import { bridge, currentScene, doc, edit, history } from "../scene.js";
import { store, useEditor, type Tool } from "../store.js";
import { getSettings, setSetting, useSettings, type Settings } from "../settings.js";
import { schedule, setZoom, zoomStep, zoomToFit } from "../canvas/canvas.js";
import { index, parents, selectAll, selectChildren, selectParents, unionBox } from "../canvas/pick.js";
import { placedFreely } from "../canvas/place.js";
import { step } from "../canvas/gestures.js";
import { deleteSelection, reorder, setLayout } from "./CanvasMenu.js";
import { convertScript } from "./PropertiesPanel.js";
import { detachSelected, goToMain, makeComponents, unmakeComponent } from "../components.js";
import { exportSelection } from "../export.js";
import { cx } from "../ui/kit.js";
import { clipboardCommand, duplicateSelection, frameSelection, groupSelection, ungroupSelection } from "../editing.js";

interface Action {
  group: string;
  label: string;
  icon: LucideIcon;
  keys?: string;
  /** Why it can't run now, if it can't. */
  blocked?: () => string | null;
  run?: () => void;
  /** A setting: shown as a switch. */
  on?: () => boolean;
}

const NOT_YET = () => "Not in Lemon yet";
const sel = () => store.get().selection;
const nodes = (): TreeNode[] => {
  const s = currentScene();
  if (!s) return [];
  const byId = index(s.tree);
  return sel().map((id) => byId.get(id)).filter((n): n is TreeNode => !!n);
};
const needSelection = () => (sel().length ? null : "Nothing selected");
const reselect = (rule: typeof selectAll) => {
  const s = currentScene();
  if (s) store.set({ selection: rule(s, sel()) });
};

/** Aligns the selection: several to their bounds, one to its parent; only freely placed nodes move. */
function align(side: "left" | "center" | "right" | "top" | "middle" | "bottom") {
  const s = currentScene();
  if (!s) return;
  const up = parents(s.tree);
  const list = nodes().filter((n) => up.get(n.id) && placedFreely(n, up.get(n.id)!));
  const target = sel().length > 1 ? unionBox(s.boxes, sel()) : up.get(sel()[0]!)?.id !== ROOT_ID ? s.boxes.get(up.get(sel()[0]!)!.id) : undefined;
  if (!target) return;
  edit(() => {
    for (const n of list) {
      const b = s.boxes.get(n.id)!;
      const pb = s.boxes.get(up.get(n.id)!.id) ?? { x: 0, y: 0, w: 0, h: 0 };
      const x = side === "left" ? target.x : side === "center" ? target.x + (target.w - b.w) / 2 : side === "right" ? target.x + target.w - b.w : b.x;
      const y = side === "top" ? target.y : side === "middle" ? target.y + (target.h - b.h) / 2 : side === "bottom" ? target.y + target.h - b.h : b.y;
      docStore.update(doc, n.id, { x: Math.round(x - pb.x), y: Math.round(y - pb.y) });
    }
  });
}

const tool = (t: Tool) => () => store.set({ tool: t });
const setting = <K extends keyof Settings>(k: K) => ({ on: () => getSettings()[k] === true, run: () => setSetting(k, !getSettings()[k] as Settings[K]) });

function actions(): Action[] {
  const a = (group: string, label: string, icon: LucideIcon, rest: Partial<Action> = {}): Action => ({ group, label, icon, ...rest });
  const flip = (key: "flipX" | "flipY") => () => edit(() => nodes().forEach((n) => docStore.update(doc, n.id, { [key]: n.props[key] === true ? null : true } as never)));
  const rotate = (by: number) => () =>
    edit(() => nodes().forEach((n) => docStore.update(doc, n.id, { rotation: ((((Number(n.props.rotation ?? 0) + by) % 360) + 540) % 360) - 180 || null } as never)));
  const selectLayers = () => (sel().length ? null : "Select layers to align");
  return [
    a("File", "Open dashboard", LayoutGrid, { run: () => void bridge.appCommand("home") }),
    a("File", "Save", Save, { keys: "Ctrl S", run: () => void bridge.appCommand("save") }),
    a("File", "Save as...", FileDown, { keys: "Ctrl ⇧ S", run: () => void bridge.appCommand("save-as") }),
    a("File", "New file", FilePlus, { keys: "Ctrl ⇧ N", run: () => void bridge.appCommand("new-file") }),
    a("File", "Open file...", FolderOpen, { keys: "Ctrl O", run: () => void bridge.appCommand("open") }),
    a("File", "Close tab", XCircle, { keys: "Ctrl W", run: () => void bridge.appCommand("close-tab") }),
    a("File", "Rename file...", FileInput, { blocked: NOT_YET }),
    a("File", "Export snapshot...", FileUp, { blocked: NOT_YET }),
    a("File", "Import snapshot...", Files, { blocked: NOT_YET }),

    a("Edit", "Convert to layers", Layers, {
      blocked: () => (nodes().some((n) => n.type === "script") ? null : "Select a script"),
      run: () => nodes().filter((n) => n.type === "script").forEach(convertScript),
    }),
    a("Edit", "Paste to replace", Clipboard, { keys: "Ctrl ⇧ R", blocked: NOT_YET }),
    a("Edit", "Undo", Undo2, { keys: "Ctrl Z", run: () => history.undo() }),
    a("Edit", "Redo", Redo2, { keys: "Ctrl ⇧ Z", run: () => history.redo() }),
    a("Edit", "Duplicate", Copy, { keys: "Ctrl D", blocked: needSelection, run: duplicateSelection }),
    a("Edit", "Delete", Trash2, { keys: "⌫", blocked: needSelection, run: deleteSelection }),
    a("Edit", "Copy", Copy, { keys: "Ctrl C", blocked: needSelection, run: () => clipboardCommand("copy") }),
    a("Edit", "Cut", Scissors, { keys: "Ctrl X", blocked: needSelection, run: () => clipboardCommand("cut") }),
    a("Edit", "Paste", Clipboard, { keys: "Ctrl V", run: () => clipboardCommand("paste") }),
    a("Edit", "Import image or SVG...", Image, { blocked: NOT_YET }),

    a("Arrange", "Group selection", Group, { keys: "Ctrl G", blocked: needSelection, run: groupSelection }),
    a("Arrange", "Frame selection", Frame, { keys: "Ctrl Alt G", blocked: needSelection, run: frameSelection }),
    a("Arrange", "Ungroup", Ungroup, {
      keys: "Ctrl ⌫",
      blocked: () => (nodes().some((n) => (n.type === "group" || n.type === "frame") && !n.instance) ? null : "Select a group or frame"),
      run: ungroupSelection,
    }),
    a("Arrange", "Align left", AlignStartVertical, { keys: "Alt A", blocked: selectLayers, run: () => align("left") }),
    a("Arrange", "Align center", AlignCenterVertical, { keys: "Alt H", blocked: selectLayers, run: () => align("center") }),
    a("Arrange", "Align right", AlignEndVertical, { keys: "Alt D", blocked: selectLayers, run: () => align("right") }),
    a("Arrange", "Align top", AlignStartHorizontal, { keys: "Alt W", blocked: selectLayers, run: () => align("top") }),
    a("Arrange", "Align middle", AlignCenterHorizontal, { keys: "Alt V", blocked: selectLayers, run: () => align("middle") }),
    a("Arrange", "Align bottom", AlignEndHorizontal, { keys: "Alt S", blocked: selectLayers, run: () => align("bottom") }),
    a("Arrange", "Flip horizontal", FlipHorizontal2, { keys: "⇧ H", blocked: needSelection, run: flip("flipX") }),
    a("Arrange", "Flip vertical", FlipVertical2, { keys: "⇧ V", blocked: needSelection, run: flip("flipY") }),
    a("Arrange", "Rotate 90° right", RotateCw, { blocked: needSelection, run: rotate(-90) }),
    a("Arrange", "Rotate 90° left", RotateCcw, { blocked: needSelection, run: rotate(90) }),
    a("Arrange", "Bring to Front", ArrowUpToLine, { keys: "]", blocked: needSelection, run: () => reorder(true) }),
    a("Arrange", "Bring forward", ArrowUp, { keys: "Ctrl ]", blocked: needSelection, run: () => step(1) }),
    a("Arrange", "Send backward", ArrowDown, { keys: "Ctrl [", blocked: needSelection, run: () => step(-1) }),
    a("Arrange", "Send to Back", ArrowDownToLine, { keys: "[", blocked: needSelection, run: () => reorder(false) }),

    a("Layout", "Add flex layout", Rows3, {
      keys: "⇧ A",
      blocked: () => (nodes().some((n) => n.type === "frame") ? null : "Nothing selected"),
      run: () => setLayout("vertical"),
    }),
    a("Layout", "Remove flex layout", Square, {
      keys: "⇧ Alt A",
      blocked: () => (nodes().some((n) => n.type === "frame" && n.props.layout !== "none") ? null : "Select a frame with flex layout"),
      run: () => setLayout("none"),
    }),

    a("Components", "Create Component", Component, {
      keys: "Ctrl Alt K",
      blocked: () => (nodes().some((n) => !n.props.reusable && !docStore.isPart(n.id)) ? null : "Select a layer that isn't a component"),
      run: makeComponents,
    }),
    a("Components", "Detach Component", Diamond, {
      keys: "Ctrl Alt K",
      blocked: () => (nodes().some((n) => n.props.reusable) ? null : "Select a component"),
      run: () => nodes().filter((n) => n.props.reusable).forEach((n) => unmakeComponent(n.id)),
    }),
    a("Components", "Detach Instance", Diamond, {
      keys: "Ctrl Alt X",
      blocked: () => (nodes().some((n) => !!n.instance) ? null : "Select an instance"),
      run: detachSelected,
    }),
    a("Components", "Go to component", CornerLeftUp, {
      blocked: () => (nodes().some((n) => !!n.instance) ? null : "Select an instance of a local component"),
      run: () => goToMain(nodes().find((n) => n.instance)!.id),
    }),
    a("Components", "Make slot", SquareDashed, { blocked: NOT_YET }),
    a("Components", "Remove slot", SquareDashed, { blocked: NOT_YET }),
    a("Components", "Replace inside instance", Crop, { keys: "⇧ Alt R", blocked: NOT_YET }),

    a("Selection", "Deselect", X, { keys: "Esc", blocked: needSelection, run: () => store.set({ selection: [] }) }),
    a("Selection", "Select all", MousePointerClick, { keys: "Ctrl A", run: () => reselect(selectAll) }),
    a("Selection", "Select parent", CornerLeftUp, { keys: "⇧ Enter", blocked: needSelection, run: () => reselect(selectParents) }),
    a("Selection", "Edit selection", PenTool, { keys: "Enter", blocked: needSelection, run: () => reselect(selectChildren) }),

    a("Copy as", "Copy as HTML + CSS", Code, { blocked: NOT_YET }),
    a("Copy as", "Copy as HTML + Tailwind", Code, { blocked: NOT_YET }),
    a("Copy as", "Copy as JSON", Braces, { blocked: NOT_YET }),
    a("Copy as", "Copy as PNG", Image, { keys: "Ctrl ⇧ C", blocked: NOT_YET }),

    a("Export", "Export code to file...", Code, { blocked: NOT_YET }),
    a("Export", "Export selection as PNG", Download, { blocked: needSelection, run: () => void exportSelection("png") }),
    a("Export", "Export selection as JPEG", Download, { blocked: needSelection, run: () => void exportSelection("jpeg") }),
    a("Export", "Export selection as WebP", Download, { blocked: needSelection, run: () => void exportSelection("webp") }),
    a("Export", "Export selection as PDF", Download, { blocked: NOT_YET }),

    a("View", "Show comment markers", MessageCircle, { keys: "⇧ C", on: () => store.get().showComments, run: () => store.set((s) => ({ showComments: !s.showComments })) }),
    a("View", "Zoom in", ZoomIn, { keys: "Ctrl +", run: () => zoomStep(1) }),
    a("View", "Zoom out", ZoomOut, { keys: "Ctrl -", run: () => zoomStep(-1) }),
    a("View", "Zoom to 100%", Scaling, { keys: "Ctrl 0", run: () => setZoom(1) }),
    a("View", "Zoom to 50%", ZoomOut, { run: () => setZoom(0.5) }),
    a("View", "Zoom to 200%", ZoomIn, { run: () => setZoom(2) }),
    a("View", "Zoom to fit", Scaling, { keys: "⇧ 1", run: () => zoomToFit() }),
    a("View", "Zoom to selection", Search, {
      keys: "⇧ 2",
      blocked: needSelection,
      run: () => {
        const s = currentScene();
        const box = s && unionBox(s.boxes, sel());
        if (box) zoomToFit(true, box, 32);
      },
    }),
    a("View", "Start presentation", Play, { keys: "Ctrl Enter", blocked: NOT_YET }),
    a("View", "Present browser", Play, { blocked: NOT_YET }),
    a("View", "Hide left sidebar", PanelLeft, { run: () => store.set((s) => ({ panelOpen: !s.panelOpen })) }),
    a("View", "Hide right sidebar", PanelRight, { blocked: NOT_YET }),
    a("View", "Hide UI", Eye, { keys: "Ctrl \\", run: () => store.set((s) => ({ panelOpen: !s.panelOpen })) }),
    a("View", "Show agent chat", MessageCircle, { run: () => store.set({ tab: "agent", panelOpen: true }) }),
    a("View", "Show layers", Layers, { run: () => store.set({ tab: "layers", panelOpen: true }) }),
    a("View", "Show slides", Presentation, { run: () => store.set({ tab: "slides", panelOpen: true }) }),
    a("View", "Show components", Component, { run: () => store.set({ tab: "components", panelOpen: true }) }),
    a("View", "Show libraries", Library, { run: () => store.set({ tab: "libraries", panelOpen: true }) }),
    a("View", "Show variables panel", Diamond, { blocked: NOT_YET }),
    a("View", "Show browser panel", Globe, { blocked: NOT_YET }),

    a("Tools", "Eyedropper", Pipette, { keys: "I", blocked: NOT_YET }),
    a("Tools", "Move tool", MousePointer2, { keys: "V", run: tool("move") }),
    a("Tools", "Hand tool", Hand, { keys: "H", run: tool("hand") }),
    a("Tools", "Comment tool", MessageCircle, { keys: "C", run: tool("comment") }),
    a("Tools", "Scale tool", Scaling, { keys: "K", blocked: NOT_YET }),
    a("Tools", "Frame tool", Frame, { keys: "A", run: tool("frame") }),
    a("Tools", "Text tool", Type, { keys: "T", run: tool("text") }),
    a("Tools", "Sticky note tool", StickyNote, { keys: "N", run: tool("note") }),
    a("Tools", "Rectangle tool", Square, { keys: "R", run: tool("rect") }),
    a("Tools", "Ellipse tool", Circle, { keys: "O", run: tool("ellipse") }),
    a("Tools", "Pen tool", PenTool, { keys: "P", run: tool("pen") }),
    a("Tools", "Polygon tool", Triangle, { run: tool("polygon") }),
    a("Tools", "Icon tool", Smile, { run: tool("icon") }),
    a("Tools", "Script tool", Code, { run: tool("script") }),
    a("Tools", "Browser tool", Globe, { run: tool("browser") }),

    a("Settings", "Snap to pixel grid", Grid3x3, { keys: "Ctrl ⇧ '", ...setting("snapToPixels") }),
    a("Settings", "Show pixel grid", Grid3x3, { keys: "Ctrl '", ...setting("pixelGrid") }),
    a("Settings", "Open settings...", Cog, { run: () => store.set({ settingsOpen: true }) }),
    a("Settings", "Open agent settings...", Cog, { run: () => store.set({ settingsOpen: true }) }),
    a("Settings", getSettings().theme === "dark" ? "Switch to light mode" : "Switch to dark mode", Sun, { run: () => setSetting("theme", getSettings().theme === "dark" ? "light" : "dark") }),
    a("Settings", "Open account...", Folder, { blocked: NOT_YET }),
    a("Settings", "Open usage...", Camera, { blocked: NOT_YET }),
    a("Settings", "Animations & effects", Sparkles, setting("animations")),
    a("Settings", "Snap to objects", Magnet, setting("snapToObjects")),
    a("Settings", "Use scroll wheel to zoom", MousePointer2, setting("wheelZooms")),
    a("Settings", "Invert zoom direction", ArrowDown, setting("invertZoom")),
    a("Settings", "Include HTML metadata when importing pages", Code, setting("htmlMetadata")),
    a("Settings", "Show agent input on dashboard", LayoutGrid, setting("dashboardPrompt")),
    a("Settings", "Keyboard shortcuts", Keyboard, { keys: "?", run: () => store.set({ shortcutsOpen: true }) }),
  ];
}

/** `label` with the part matching `query` underlined. */
function Marked({ label, query }: { label: string; query: string }) {
  const i = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="underline underline-offset-2">{label.slice(i, i + query.length)}</span>
      {label.slice(i + query.length)}
    </>
  );
}

export function CommandPalette() {
  const open = useEditor((s) => s.paletteOpen);
  useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  useSettings();
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(actions, [open]);
  const q = query.trim().toLowerCase();
  // Best matches first: names starting with the text, then containing it.
  const shown = q
    ? all.filter((x) => x.label.toLowerCase().includes(q)).sort((x, y) => x.label.toLowerCase().indexOf(q) - y.label.toLowerCase().indexOf(q))
    : all;
  const usable = (x: Action) => !x.blocked?.();
  useEffect(() => {
    if (open) (setQuery(""), setAt(0));
  }, [open]);
  useEffect(() => setAt(Math.max(0, shown.findIndex(usable))), [query]);
  // Braced: scrollIntoView returns a promise here, which React would take for a cleanup.
  useEffect(() => {
    void list.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const run = (x: Action | undefined) => {
    if (!x || !usable(x) || !x.run) return;
    if (!x.on) store.set({ paletteOpen: false });
    x.run();
    schedule();
  };
  const move = (by: 1 | -1) => {
    for (let i = at + by; i >= 0 && i < shown.length; i += by) if (usable(shown[i]!)) return setAt(i);
  };
  let lastGroup = "";
  return (
    <D.Root open={open} onOpenChange={(o) => store.set({ paletteOpen: o })}>
      <D.Portal>
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[136px] left-1/2 z-50 flex max-h-[452px] w-[561px] -translate-x-1/2 flex-col overflow-hidden rounded-[12px] border border-input bg-popover text-foreground shadow-island outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), move(1));
            else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
            else if (e.key === "Enter") (e.preventDefault(), run(shown[at]));
          }}
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <label className="flex h-[48px] shrink-0 items-center gap-2 px-4">
            <Search size={15} strokeWidth={1.5} className="text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search actions..."
              className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:none]">
            {!shown.length && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No matching actions.</p>}
            {shown.map((x, i) => {
              const why = x.blocked?.() ?? null;
              const head = !q && x.group !== lastGroup ? x.group : null;
              lastGroup = x.group;
              return (
                <div key={`${x.group}-${x.label}`}>
                  {head && <div className="px-2.5 pt-2.5 pb-1 text-[11px] text-muted-foreground">{head}</div>}
                  <div
                    data-at={i}
                    onMouseMove={() => !why && at !== i && setAt(i)}
                    onClick={() => run(x)}
                    className={cx(
                      "flex h-9 cursor-default items-center gap-2.5 rounded-[8px] px-2.5 text-[13px]",
                      why ? "text-foreground/40" : at === i ? "bg-[#2f7cf6] text-white" : "text-foreground",
                    )}
                  >
                    <x.icon size={14} strokeWidth={1.5} className={cx("shrink-0", at === i && !why ? "text-white" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1 truncate">
                      <Marked label={x.label} query={q} />
                    </span>
                    {why && <span className="shrink-0 text-[11px] text-muted-foreground">{why}</span>}
                    {x.keys && (
                      <span className="flex shrink-0 gap-1">
                        {x.keys.split(" ").map((k, j) => (
                          <kbd key={j} className={cx("flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-sans text-[10px]", at === i && !why ? "bg-white/20 text-white" : "bg-input text-muted-foreground")}>
                            {k}
                          </kbd>
                        ))}
                      </span>
                    )}
                    {x.on && (
                      <span className={cx("relative h-[14px] w-[24px] shrink-0 rounded-full", x.on() ? "bg-[#22c55e]" : "bg-input")}>
                        <span className={cx("absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white", x.on() ? "left-[12px]" : "left-[2px]")} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
