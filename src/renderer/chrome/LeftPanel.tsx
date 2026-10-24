// The left panel: tabs (Agent, Layers, Slides, Components, Libraries) and their content.
import { useMemo, useState } from "react";
import {
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  ChevronRight,
  Circle,
  Component,
  Hash,
  Image as ImageIcon,
  Layers,
  Library,
  MessageCircle,
  Play,
  Presentation,
  Search,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { TreeNode } from "../../doc/schema.js";
import { screenshot } from "../../render/screenshot.js";
import { AgentPanel } from "../agent/AgentPanel.js";
import { currentScene, engine } from "../scene.js";
import { store, useEditor, type Tab } from "../store.js";
import { schedule } from "../canvas/canvas.js";
import { ICON, Island, cx } from "../ui/kit.js";

const TABS: { tab: Tab; icon: LucideIcon; label: string }[] = [
  { tab: "agent", icon: MessageCircle, label: "Agent" },
  { tab: "layers", icon: Layers, label: "Layers" },
  { tab: "slides", icon: Presentation, label: "Slides" },
  { tab: "components", icon: Component, label: "Components" },
  { tab: "libraries", icon: Library, label: "Libraries" },
];

export function LeftPanel() {
  const tab = useEditor((s) => s.tab);
  return (
    <Island className="absolute top-[58px] left-2 bottom-[107px] flex w-[378px] flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pt-3 pb-3">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            onClick={() => store.set({ tab: t.tab })}
            className={cx(
              "flex h-[29px] items-center gap-1.5 rounded-[8px] text-[13px] font-semibold text-[#d4d4d8]",
              t.tab === tab ? "bg-[#3a3a3c] px-2.5" : "w-[33px] justify-center hover:bg-white/5",
            )}
            aria-label={t.label}
          >
            <t.icon {...ICON} />
            {t.tab === tab && t.label}
          </button>
        ))}
      </div>
      {tab === "agent" && <AgentPanel />}
      {tab === "layers" && <LayersPanel />}
      {tab === "slides" && <SlidesPanel />}
      {tab === "components" && <ComponentsPanel />}
      {tab === "libraries" && <LibrariesPanel />}
    </Island>
  );
}

// ---- Layers ---------------------------------------------------------------------------------------
const expandAll = new URLSearchParams(location.search).get("expand") === "all";
function allIds(n: TreeNode): string[] {
  return [n.id, ...n.children.flatMap(allIds)];
}

function typeIcon(n: TreeNode): LucideIcon {
  if (n.type === "text") return Type;
  if (n.type === "rect") return Square;
  if (n.type === "ellipse") return Circle;
  if (n.type === "image") return ImageIcon;
  if (n.props.layout === "row") return AlignStartHorizontal;
  if (n.props.layout === "none") return Hash;
  return AlignStartVertical;
}

function LayersPanel() {
  useEditor((s) => s.docVersion);
  const selection = useEditor((s) => s.selection);
  const tree = currentScene()?.tree;
  // Headless checks can open every row with ?expand=all.
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandAll && tree ? allIds(tree) : []));
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (n: TreeNode, depth: number) => {
    rows.push({ node: n, depth });
    if (open.has(n.id)) n.children.forEach((c) => walk(c, depth + 1));
  };
  // Newest frames last on the canvas, first in the list.
  [...(tree?.children ?? [])].reverse().forEach((f) => walk(f, 0));
  return (
    <div className="-mt-1 min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
      {rows.map(({ node, depth }) => {
        const Icon = typeIcon(node);
        const label = node.props.name ?? (node.type === "text" ? node.props.text?.slice(0, 40) : node.type[0]!.toUpperCase() + node.type.slice(1));
        return (
          <div
            key={node.id}
            onClick={() => (store.set({ selection: node.id }), schedule())}
            onMouseEnter={() => (store.set({ hover: node.id }), schedule())}
            onMouseLeave={() => (store.set({ hover: null }), schedule())}
            className={cx(
              "flex h-7 cursor-default items-center rounded-[5px] pr-2 text-[12px] font-semibold",
              node.id === selection ? "bg-[#283751] text-[#bfdbfe]" : "text-[#d4d4d8] hover:bg-white/[0.04]",
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <span
              className="flex h-4 w-4 items-center justify-center text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                if (node.children.length) toggle(node.id);
              }}
            >
              {node.children.length > 0 &&
                (open.has(node.id) ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />)}
            </span>
            <Icon size={14} strokeWidth={1.5} className="mr-2 ml-1 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Slides ---------------------------------------------------------------------------------------
function SlidesPanel() {
  const version = useEditor((s) => s.docVersion);
  const thumbs = useMemo(() => {
    const s = currentScene();
    if (!s) return [];
    return s.tree.children.map((f) => {
      try {
        const pic = screenshot(engine.ck, s.tree, s.boxes, s.vars, engine.text, f.id, 400);
        return { id: f.id, url: URL.createObjectURL(new Blob([pic.png as BlobPart], { type: "image/png" })) };
      } catch {
        return { id: f.id, url: "" };
      }
    });
  }, [version]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3">
        {thumbs.map((t, i) => (
          <div key={t.id} className="relative flex h-[160px] items-center justify-center rounded-[10px] bg-[#202023]">
            <span className="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#3f3f46] text-[11px]">{i + 1}</span>
            {t.url && <img src={t.url} alt="" className="max-h-[148px] max-w-[200px] object-contain" />}
          </div>
        ))}
      </div>
      <div className="flex h-12 items-center justify-around text-[14px] font-semibold text-[#e4e4e7]">
        <button type="button" className="flex items-center gap-2"><Play size={14} strokeWidth={1.5} /> Present</button>
        <button type="button" className="flex items-center gap-2">Export PDF <ChevronDown size={14} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

// ---- Components and Libraries (empty states) -----------------------------------------------------
function ComponentsPanel() {
  const selection = useEditor((s) => s.selection);
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 text-[13px] leading-5 text-[#c8c8c8]">
      <div className="flex h-8 items-center gap-2 rounded-md border border-input px-2 text-muted-foreground">
        <Search size={14} strokeWidth={1.5} /> Search components...
      </div>
      <button
        type="button"
        disabled={!selection}
        className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-[#a1a1aa] font-semibold text-[#27272a] disabled:opacity-80"
      >
        <Component size={14} strokeWidth={1.5} /> Create Component
      </button>
      <p>Select an element to make it a component.</p>
      <p className="font-semibold text-[#e4e4e7]">No components yet.</p>
      <div>
        <div className="font-semibold text-[#e4e4e7]">Why components</div>
        <p className="mt-1">Change the main component once and every copy of it updates.</p>
      </div>
      <div>
        <div className="font-semibold text-[#e4e4e7]">Making one</div>
        <p className="mt-1">
          Select a frame, shape or text and press <kbd className="rounded bg-white/10 px-1 font-mono text-[11px]">Ctrl Alt K</kbd>, or click
          “Create Component” above. The original shows a magenta outline; copies show violet.
        </p>
      </div>
    </div>
  );
}

function LibrariesPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 text-[13px] text-[#c8c8c8]">
      <div className="font-semibold text-[#e4e4e7]">No libraries yet</div>
      <p className="mt-2 text-muted-foreground">Libraries let several files share the same components and variables.</p>
      <button type="button" className="mt-auto h-9 text-[14px] text-[#e4e4e7] hover:underline">
        Turn this file into a library
      </button>
    </div>
  );
}
