// The left panel: tabs (Agent, Layers, Slides, Components, Libraries) and their content.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  ChevronRight,
  Circle,
  Component,
  Diamond,
  Eye,
  EyeOff,
  Hash,
  Layers,
  Library,
  MessageCircle,
  Play,
  Presentation,
  Search,
  Smile,
  Square,
  SquareDashed,
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
import { COMPONENT_DRAG, COPY_COLOUR, mainComponents, makeComponents, reveal } from "../components.js";
import { ContextRoot, ContextTrigger } from "../ui/menu.js";
import { CanvasMenu } from "./CanvasMenu.js";

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
// Measured from the reference: 28px rows indented 13px a level; frames, groups and copies in bold;
// a component and what is in it violet, a copy and what is in it periwinkle; hidden layers dimmed
// with a crossed-out eye; an eye on the hovered row; the selected row blue and the rows inside it a
// darker blue, joined into one block.
const expandAll = new URLSearchParams(location.search).get("expand") === "all";
const INDENT = 13;
const MAIN_ROW = "#a78bfa";
const COPY_ROW = "#a5b4fc";
const DROP = "#3d99ff";
const NO_DRAG_IMAGE = Object.assign(new Image(), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

function allIds(n: TreeNode): string[] {
  return [n.id, ...n.children.flatMap(allIds)];
}

/** Groups and frames without layout list their children top first, as they stack; flex frames list them in flow order. */
function stacks(type: string | undefined, layout: unknown): boolean {
  return type === "group" || (type === "frame" && layout === "none");
}
const listed = (n: TreeNode): TreeNode[] => (n.id === ROOT_ID || stacks(n.type, n.props.layout) ? [...n.children].reverse() : n.children);
const stacksIn = (id: string) => id === ROOT_ID || stacks(docStore.typeOf(doc, id), docStore.propsOf(doc, id).layout);

function typeIcon(n: TreeNode): LucideIcon {
  if (n.instance) return Diamond;
  if (n.props.reusable) return Component;
  if (n.type === "text") return Type;
  if (n.type === "ellipse") return Circle;
  if (n.type === "group") return SquareDashed;
  if (n.type !== "frame") return Square;
  if (n.props.layout === "none") return Hash;
  return n.props.layout === "vertical" ? AlignStartVertical : AlignStartHorizontal;
}

function labelOf(n: TreeNode): string {
  if (n.props.name) return n.props.name;
  if (n.type === "text" && n.props.content) return String(n.props.content).split("\n")[0]!;
  return n.type[0]!.toUpperCase() + n.type.slice(1);
}

const isHidden = (n: TreeNode) => n.props.enabled === false;

function setHidden(n: TreeNode, hide: boolean) {
  // A part of a copy shows again by its own change, in case its component's node is the hidden one.
  edit(() => docStore.update(doc, n.id, { enabled: hide ? false : docStore.isPart(n.id) ? true : null } as never));
}

function rename(id: string, name: string) {
  const current = docStore.exists(doc, id) ? docStore.propsOf(doc, id).name : undefined;
  if ((name.trim() || undefined) === current) return;
  edit(() => docStore.update(doc, id, { name: name.trim() || null } as never));
}

type Zone = "before" | "after" | "into";

/** Drops dragged layers next to a row (above or below it in the list) or into a frame or group row. */
function dropLayers(dragged: string[], row: TreeNode, zone: Zone) {
  const parent = zone === "into" ? row.id : docStore.parentOf(doc, row.id);
  if (!parent) return;
  // The parts of a copy of a component keep their places, and a copy takes no new ones.
  if (dragged.some(docStore.isPart) || docStore.isPart(parent) || docStore.isInstance(doc, parent)) return;
  // Nothing goes inside itself.
  for (let p: string | undefined = parent; p && p !== ROOT_ID; p = docStore.parentOf(doc, p)) if (dragged.includes(p)) return;
  // In a stacking parent the list runs last child first, so below a row means before it in the document.
  const reversed = stacksIn(parent);
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
      } else if (!reversed) at = 0;
      docStore.move(doc, id, parent, at);
      anchor = id;
    }
  });
}

interface Row {
  node: TreeNode;
  depth: number;
  /** Inside a component (violet) or a copy (periwinkle). */
  tone: string | null;
  /** Inside a selected layer. */
  inside: boolean;
}

function LayersPanel() {
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [target, setTarget] = useState<{ id: string; zone: Zone } | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEditor((s) => s.docVersion);
  const selection = useEditor((s) => s.selection);
  const hover = useEditor((s) => s.hover);
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

  // What is selected elsewhere (on the canvas) opens the rows above it and scrolls into view.
  useEffect(() => {
    if (!tree || !selection.length) return;
    const parents = new Map<string, string>();
    const walk = (n: TreeNode) => n.children.forEach((c) => (parents.set(c.id, n.id), walk(c)));
    walk(tree);
    const up = new Set<string>();
    for (const id of selection) for (let p = parents.get(id); p && p !== ROOT_ID; p = parents.get(p)) up.add(p);
    if ([...up].some((id) => !open.has(id))) setOpen((o) => new Set([...o, ...up]));
    requestAnimationFrame(() => list.current?.querySelector(`[data-layer="${CSS.escape(selection[0]!)}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [selection.join("\n")]);

  const rows: Row[] = [];
  const walk = (n: TreeNode, depth: number, tone: string | null, inside: boolean) => {
    const own = n.instance ? COPY_ROW : n.props.reusable && !docStore.isPart(n.id) ? MAIN_ROW : tone;
    rows.push({ node: n, depth, tone: own, inside });
    if (open.has(n.id)) listed(n).forEach((c) => walk(c, depth + 1, own, inside || selection.includes(n.id)));
  };
  if (tree) listed(tree).forEach((f) => walk(f, 0, null, false));
  const lit = (r: Row | undefined) => !!r && (r.inside || selection.includes(r.node.id));

  const pick = (e: MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current && rows.some((r) => r.node.id === anchor.current)) {
      // Shift picks every row between the last one clicked and this one.
      const ids = rows.map((r) => r.node.id);
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      store.set({ selection: ids.slice(a, b! + 1) });
    } else if (e.ctrlKey || e.metaKey) {
      store.set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] }));
      anchor.current = id;
    } else {
      store.set({ selection: [id] });
      anchor.current = id;
    }
    schedule();
  };

  return (
    <ContextRoot>
      <ContextTrigger asChild>
        <div
          ref={list}
          className="-mt-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-2"
          // Only a layer row has a menu.
          onContextMenu={(e) => !(e.target as Element).closest("[data-layer]") && e.preventDefault()}
        >
          {rows.map((row, i) => {
            const { node, depth, tone } = row;
            const Icon = typeIcon(node);
            const selected = selection.includes(node.id);
            const hidden = isHidden(node);
            const container = node.type === "frame" || node.type === "group" || !!node.instance;
            const block = lit(row);
            const top = !block || !lit(rows[i - 1]);
            const bottom = !block || !lit(rows[i + 1]);
            return (
              <div
                key={node.id}
                data-layer={node.id}
                draggable={!docStore.isPart(node.id) && naming !== node.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  // The reference shows only the drop line, no picture of the row under the pointer.
                  e.dataTransfer.setDragImage(NO_DRAG_IMAGE, 0, 0);
                  if (!selected) store.set({ selection: [node.id] });
                  setDragging(selected ? selection : [node.id]);
                }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const k = (e.clientY - r.top) / r.height;
                  const holds = (node.type === "frame" || node.type === "group") && !node.instance && !docStore.isPart(node.id);
                  const zone: Zone = holds && k > 0.3 && k < 0.7 ? "into" : k < 0.5 ? "before" : "after";
                  if (target?.id !== node.id || target.zone !== zone) setTarget({ id: node.id, zone });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging && target) dropLayers(dragging, node, target.zone);
                  setDragging(null);
                  setTarget(null);
                }}
                onDragEnd={() => (setDragging(null), setTarget(null))}
                onClick={(e) => pick(e, node.id)}
                onDoubleClick={() => setNaming(node.id)}
                onContextMenu={() => {
                  if (selected) return;
                  store.set({ selection: [node.id] });
                  anchor.current = node.id;
                  schedule();
                }}
                onMouseEnter={() => (store.set({ hover: node.id }), schedule())}
                onMouseLeave={() => (store.set({ hover: null }), schedule())}
                className={cx(
                  "group relative flex h-7 cursor-default items-center pr-[10px] text-[12px]",
                  container ? "font-semibold" : "font-normal",
                  selected ? "bg-layer-active text-layer-active-text" : block ? "bg-layer-inside text-foreground" : "text-foreground",
                  !block && (hover === node.id ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.06]"),
                  target?.id === node.id && target.zone === "into" && "ring-1 ring-inset ring-[#3d99ff]",
                )}
                style={{
                  paddingLeft: 2 + depth * INDENT,
                  borderTopLeftRadius: top ? 5 : 0,
                  borderTopRightRadius: top ? 5 : 0,
                  borderBottomLeftRadius: bottom ? 5 : 0,
                  borderBottomRightRadius: bottom ? 5 : 0,
                }}
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (node.children.length) toggle(node.id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {node.children.length > 0 && (open.has(node.id) ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />)}
                </span>
                <span className={cx("flex min-w-0 flex-1 items-center", hidden && "opacity-40")}>
                  <Icon size={14} strokeWidth={1.5} className="mr-[10px] ml-[5px] shrink-0 text-muted-foreground" style={tone ? { color: tone } : undefined} />
                  {naming === node.id ? (
                    <NameField
                      initial={labelOf(node)}
                      onDone={(name) => {
                        if (name !== null) rename(node.id, name);
                        setNaming(null);
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap" style={tone ? { color: tone } : undefined}>
                      {labelOf(node)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={hidden ? "Show layer" : "Hide layer"}
                  className={cx(
                    "ml-2 h-4 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground",
                    hidden || hover === node.id ? "flex" : "hidden group-hover:flex",
                  )}
                  onClick={(e) => (e.stopPropagation(), setHidden(node, !hidden), schedule())}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {hidden ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                </button>
                {target?.id === node.id && target.zone !== "into" && (
                  <span className={cx("pointer-events-none absolute right-0 -left-1.5 h-px", target.zone === "before" ? "top-0" : "bottom-0")} style={{ background: DROP }} />
                )}
              </div>
            );
          })}
        </div>
      </ContextTrigger>
      <CanvasMenu inLayers />
    </ContextRoot>
  );
}

/** A layer's name being edited, all of it selected: Enter or clicking away keeps it, Escape drops it. */
function NameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="-ml-[5px] h-[26px] w-[154px] max-w-full min-w-0 rounded-[5px] border border-[#3d99ff] bg-[#18191b] px-1 text-[12px] text-foreground outline-none"
    />
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
