// The left panel: tabs (Agent, Layers, Slides, Components, Libraries) and their content.
import { useMemo, useState } from "react";
import {
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  ChevronRight,
  Circle,
  Component,
  Diamond,
  Hash,
  Image as ImageIcon,
  Layers,
  Library,
  MessageCircle,
  Play,
  Presentation,
  Search,
  Smile,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { TreeNode } from "../../doc/schema.js";
import { screenshot } from "../../render/screenshot.js";
import { AgentPanel } from "../agent/AgentPanel.js";
import { assets, currentScene, doc, edit, engine } from "../scene.js";
import * as docStore from "../../doc/store.js";
import { ROOT_ID } from "../../doc/schema.js";
import { store, useEditor, type Tab } from "../store.js";
import { schedule } from "../canvas/canvas.js";
import { ICON, Island, cx } from "../ui/kit.js";
import { COMPONENT_DRAG, COPY_COLOUR, kindOf, mainComponents, makeComponents, reveal } from "../components.js";

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
    <Island className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pt-3 pb-3">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            onClick={() => store.set({ tab: t.tab })}
            className={cx(
              "flex h-[29px] items-center gap-1.5 rounded-[8px] text-[13px] font-semibold text-foreground",
              t.tab === tab ? "bg-tab-active px-2.5" : "w-[33px] justify-center hover:bg-foreground/5",
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
  if (n.instance) return Diamond;
  if (n.props.reusable) return Component;
  if (n.type === "text") return Type;
  if (n.type === "rectangle") return Array.isArray(n.props.fill) ? Square : typeof n.props.fill === "object" && n.props.fill?.type === "image" ? ImageIcon : Square;
  if (n.type === "ellipse") return Circle;
  if (n.type === "icon") return Smile;
  if (n.type === "group" || n.props.layout === "none") return Hash;
  if (n.type !== "frame") return Square;
  if (n.props.layout === "vertical") return AlignStartVertical;
  return AlignStartHorizontal;
}

/** A click on a layer row selects it; with Shift or Ctrl/⌘ it adds it to the selection, or takes it out. */
function pickRow(selection: string[], id: string, add: boolean): string[] {
  if (!add) return [id];
  return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
}

type Zone = "before" | "after" | "into";

/**
 * Drops dragged layers next to a row (above or below it in the list) or into a frame row. The list
 * shows the page's frames newest first, so above a top-level frame means after it in the document.
 */
function dropLayers(dragged: string[], row: TreeNode, zone: Zone) {
  const parent = zone === "into" ? row.id : docStore.parentOf(doc, row.id);
  if (!parent) return;
  // The parts of a copy of a component keep their places, and a copy takes no new ones.
  if (dragged.some(docStore.isPart) || docStore.isPart(parent) || docStore.isInstance(doc, parent)) return;
  // Nothing goes inside itself.
  for (let p: string | undefined = parent; p && p !== ROOT_ID; p = docStore.parentOf(doc, p)) if (dragged.includes(p)) return;
  const reversed = parent === ROOT_ID;
  edit(() => {
    let anchor = zone === "into" ? null : row.id;
    // Each dragged layer lands just after the previous one, in list order.
    for (const id of dragged) {
      if (id === anchor) continue;
      const siblings = docStore.childIds(doc, parent).filter((c) => c !== id);
      let at: number | undefined;
      if (anchor) {
        const i = siblings.indexOf(anchor);
        const listAfter = zone === "after" || anchor !== row.id;
        at = listAfter !== reversed ? i + 1 : i;
      }
      docStore.move(doc, id, parent, at);
      anchor = id;
    }
  });
}

function LayersPanel() {
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [target, setTarget] = useState<{ id: string; zone: Zone } | null>(null);
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
        const kind = kindOf(node);
        const label = node.props.name ?? (node.type === "text" ? node.props.content?.slice(0, 40) : node.type[0]!.toUpperCase() + node.type.slice(1));
        return (
          <div
            key={node.id}
            data-layer={node.id}
            draggable={!docStore.isPart(node.id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragging(selection.includes(node.id) ? selection : [node.id]);
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const k = (e.clientY - r.top) / r.height;
              const zone: Zone = node.type === "frame" && !node.instance && !docStore.isPart(node.id) && k > 0.3 && k < 0.7 ? "into" : k < 0.5 ? "before" : "after";
              if (target?.id !== node.id || target.zone !== zone) setTarget({ id: node.id, zone });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && target) dropLayers(dragging, node, target.zone);
              setDragging(null);
              setTarget(null);
            }}
            onDragEnd={() => (setDragging(null), setTarget(null))}
            onClick={(e) => (store.set((s) => ({ selection: pickRow(s.selection, node.id, e.shiftKey || e.ctrlKey || e.metaKey) })), schedule())}
            onMouseEnter={() => (store.set({ hover: node.id }), schedule())}
            onMouseLeave={() => (store.set({ hover: null }), schedule())}
            className={cx(
              "relative flex h-7 cursor-default items-center rounded-[5px] pr-2 text-[12px] font-semibold",
              target?.id === node.id && target.zone === "into" && "ring-1 ring-inset ring-[#3d99ff]",
              selection.includes(node.id) ? "bg-layer-active text-layer-active-text" : "text-foreground hover:bg-foreground/[0.04]",
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
            <Icon size={14} strokeWidth={1.5} className="mr-2 ml-1 shrink-0 text-muted-foreground" style={kind === "main" || kind === "instance" ? { color: COPY_COLOUR } : undefined} />
            <span className="truncate" style={kind === "main" || kind === "instance" ? { color: COPY_COLOUR } : undefined}>{label}</span>
            {target?.id === node.id && target.zone !== "into" && (
              <span className={cx("pointer-events-none absolute right-1 h-0.5 bg-[#3d99ff]", target.zone === "before" ? "-top-px" : "-bottom-px")} style={{ left: 6 + depth * 12 }} />
            )}
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
        const pic = screenshot(engine.ck, s.tree, s.boxes, s.vars, engine.text, assets, f.id, 400);
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
          <div key={t.id} className="relative flex h-[160px] items-center justify-center rounded-[10px] bg-thumb">
            <span className="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-full bg-input text-[11px]">{i + 1}</span>
            {t.url && <img src={t.url} alt="" className="max-h-[148px] max-w-[200px] object-contain" />}
          </div>
        ))}
      </div>
      <div className="flex h-12 items-center justify-around text-[14px] font-semibold text-foreground">
        <button type="button" className="flex items-center gap-2"><Play size={14} strokeWidth={1.5} /> Present</button>
        <button type="button" className="flex items-center gap-2">Export PDF <ChevronDown size={14} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

// ---- Components ----------------------------------------------------------------------------------
function ComponentsPanel() {
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const [query, setQuery] = useState("");
  const tree = currentScene()?.tree;
  const mains = tree ? mainComponents(tree) : [];
  const shown = mains.filter((m) => (m.props.name ?? "").toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4 text-[13px] leading-5 text-foreground">
      <label className="flex h-8 items-center gap-2 rounded-md border border-input px-2 text-muted-foreground">
        <Search size={14} strokeWidth={1.5} className="shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search components..." className="w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
      <button
        type="button"
        disabled={!selection.length}
        onClick={makeComponents}
        className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-muted-foreground font-semibold text-background disabled:opacity-80"
      >
        <Component size={14} strokeWidth={1.5} /> Create Component
      </button>
      {mains.length ? (
        <div className="-mx-1.5">
          {shown.map((m) => (
            <div
              key={m.id}
              data-component={m.id}
              draggable
              title="Drag onto the canvas to place a copy"
              onDragStart={(e) => {
                e.dataTransfer.setData(COMPONENT_DRAG, m.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => (reveal(m.id), schedule())}
              className={cx(
                "flex h-7 cursor-default items-center gap-2 rounded-[5px] px-1.5 text-[12px] font-semibold",
                selection.includes(m.id) ? "bg-layer-active text-layer-active-text" : "hover:bg-foreground/[0.04]",
              )}
            >
              <Component size={14} strokeWidth={1.5} className="shrink-0" style={{ color: COPY_COLOUR }} />
              <span className="truncate">{m.props.name ?? "Component"}</span>
            </div>
          ))}
          {!shown.length && <p className="px-1.5 text-muted-foreground">No components match.</p>}
        </div>
      ) : (
        <>
          <p>Select an element to make it a component.</p>
          <p className="font-semibold text-foreground">No components yet.</p>
          <div>
            <div className="font-semibold text-foreground">Why components</div>
            <p className="mt-1">Change the main component once and every copy of it updates.</p>
          </div>
          <div>
            <div className="font-semibold text-foreground">Making one</div>
            <p className="mt-1">
              Select a frame, shape or text and press <kbd className="rounded bg-input px-1 font-mono text-[11px]">Ctrl Alt K</kbd>, or click
              “Create Component” above. The original shows a magenta outline; copies show violet.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Libraries (empty state) ---------------------------------------------------------------------
function LibrariesPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 text-[13px] text-foreground">
      <div className="font-semibold text-foreground">No libraries yet</div>
      <p className="mt-2 text-muted-foreground">Libraries let several files share the same components and variables.</p>
      <button type="button" className="mt-auto h-9 text-[14px] text-foreground hover:underline">
        Turn this file into a library
      </button>
    </div>
  );
}
