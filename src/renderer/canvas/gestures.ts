// What the pointer and keys do on the canvas: select (click, Shift/Ctrl/⌘, box), move with snapping
// guides, resize from the handles, round a rectangle's corners, draw shapes, frames and text, pan with
// the hand (H, Space or the middle button), nudge with the arrows. Icons, scripts, prompt cards and
// browsers are placed with a click; the pen draws paths point by point. The rules for what gets picked are
// in pick.ts, where moved or drawn nodes go in place.ts, snapping in snap.ts.
import * as docStore from "../../doc/store.js";
import { ROOT_ID, type NodeProps, type PenNode, type TreeNode } from "../../doc/schema.js";
import { kindOf, type Box } from "../../layout/layout.js";
import { currentScene, doc, edit, engine, history, type Scene } from "../scene.js";
import { store, type Tool } from "../store.js";
import { labelAt, radiusHandles, schedule, toPage, toScreen, view, zoomToFit } from "./canvas.js";
import { overlay, type PenPoint } from "./overlay.js";
import { browserBar, cardHeader, isCard, runButton } from "../../render/draw.js";
import { sendPrompt } from "../agent/chat.js";
import { bridge } from "../scene.js";
import { pageCursor } from "./live-pages.js";
import { boxPick, clickPick, doubleClickPick, index, parents, pathAt, unionBox } from "./pick.js";
import { startComment } from "../chrome/Comments.js";
import { flowSlot, flows, frameAround, frameAt, originIn, placedFreely } from "./place.js";
import { snapBox } from "./snap.js";
import { editingPointer, startTextEdit, stopTextEdit } from "./text-edit.js";
import { COMPONENT_DRAG, placeCopy } from "../components.js";
import { copyInPlace } from "../arrange.js";

/** A node of the person's own (not a part of a copy of a component, nor a script's output). */
const movable = (id: string) => docStore.nodesOf(doc).has(id);
import { carriesPictures, placePictures } from "../pictures.js";

/** How far (screen pixels) a press travels before it counts as a drag. */
const DRAG_START = 3;
/** How close (screen pixels) an edge comes before it snaps. */
const SNAP = 5;
/** How close (screen pixels) the pointer must be to grab a handle. */
const HANDLE_HIT = 6;
/** A shape drawn with a click instead of a drag (as in Figma). */
const DEFAULT_SIZE = 100;
/** New shapes, as Pen makes them (captures 04 and 03). */
const SHAPE_FILL = "#CCCCCC";

type Point = { x: number; y: number };
type Corner = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

/** One node being moved or resized: where it started. */
interface Held {
  node: TreeNode;
  parent: TreeNode;
  box: Box;
  parentBox: Box;
  free: boolean;
}

type Gesture =
  | { kind: "press"; at: Point; screen: Point; pick: string | null; shift: boolean; deep: boolean; fresh: boolean }
  | { kind: "marquee"; from: Point; base: string[]; deep: boolean }
  | { kind: "move"; from: Point; held: Held[]; union: Box; live: boolean; deep: boolean; originals: Held[]; copying: boolean; last: Point }
  | { kind: "resize"; from: Point; corner: Corner; held: Held[]; union: Box }
  | { kind: "radius"; id: string; box: Box; corner: number }
  | { kind: "draw"; tool: Tool; from: Point; container: TreeNode }
  | { kind: "place"; tool: Tool; at: Point; container: TreeNode }
  | { kind: "pen"; from: Point; screen: Point }
  | { kind: "page"; id: string }
  | { kind: "pan"; screen: Point };

let gesture: Gesture | null = null;
/** Where on the page the canvas menu was last opened (Paste here). */
let menuPoint = { x: 0, y: 0 };
export const lastMenuPoint = () => menuPoint;
let space = false;
let el: HTMLCanvasElement;

const PAGE: Box = { x: 0, y: 0, w: 0, h: 0 };
const boxOf = (s: Scene, id: string): Box => s.boxes.get(id) ?? PAGE;

/** The selected nodes without those inside another selected node (they move with it). */
function topMost(s: Scene, ids: string[]): TreeNode[] {
  const byId = index(s.tree);
  const up = parents(s.tree);
  const chosen = new Set(ids);
  return ids
    .filter((id) => {
      for (let p = up.get(id); p; p = up.get(p.id)) if (chosen.has(p.id)) return false;
      return true;
    })
    .map((id) => byId.get(id))
    .filter((n): n is TreeNode => !!n && n.id !== ROOT_ID);
}

function hold(s: Scene, ids: string[]): Held[] {
  const up = parents(s.tree);
  return topMost(s, ids).map((node) => {
    const parent = up.get(node.id)!;
    return { node, parent, box: boxOf(s, node.id), parentBox: { ...originIn(s, parent), w: 0, h: 0 }, free: placedFreely(node, parent) };
  });
}

// A drag is one undo step however long it pauses (the person's history otherwise merges changes
// less than half a second apart).
function beginChange() {
  history.stopCapturing();
  history.captureTimeout = 1e9;
}
function endChange() {
  history.captureTimeout = 500;
  history.stopCapturing();
}

// ---- Handles ---------------------------------------------------------------------------------------
/** The selection handle under the pointer (screen coordinates): a corner, an edge or a corner radius. */
function handleAt(s: Scene, sx: number, sy: number): { corner: Corner } | { radius: number; id: string } | null {
  const ids = store.get().selection;
  const b = unionBox(s.boxes, ids);
  if (!b || overlay.editing) return null;
  const [x, y] = toScreen(b.x, b.y);
  const w = b.w * view.zoom;
  const h = b.h * view.zoom;
  const near = (hx: number, hy: number) => Math.abs(sx - hx) <= HANDLE_HIT && Math.abs(sy - hy) <= HANDLE_HIT;
  if (ids.length === 1 && ["rectangle", "frame"].includes(index(s.tree).get(ids[0]!)?.type ?? "")) {
    const i = radiusHandles({ x, y, w, h }).findIndex(([hx, hy]) => near(hx, hy));
    if (i >= 0) return { radius: i, id: ids[0]! };
  }
  const corners: [Corner, number, number][] = [["nw", x, y], ["ne", x + w, y], ["sw", x, y + h], ["se", x + w, y + h]];
  for (const [c, hx, hy] of corners) if (near(hx, hy)) return { corner: c };
  const inX = sx > x && sx < x + w;
  const inY = sy > y && sy < y + h;
  if (inX && Math.abs(sy - y) <= 4) return { corner: "n" };
  if (inX && Math.abs(sy - (y + h)) <= 4) return { corner: "s" };
  if (inY && Math.abs(sx - x) <= 4) return { corner: "w" };
  if (inY && Math.abs(sx - (x + w)) <= 4) return { corner: "e" };
  return null;
}

const CURSORS: Record<Corner, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

function setCursor(c: string) {
  if (el.style.cursor !== c) el.style.cursor = c;
}

/** The pointer's look when nothing is held: depends on the tool, and on a handle under it. */
function idleCursor(s: Scene | undefined, sx: number, sy: number) {
  const tool = store.get().tool;
  if (space || tool === "hand") return setCursor("grab");
  if (tool === "text") return setCursor("text");
  if (tool === "comment") return setCursor("crosshair");
  if (DRAWN.has(tool) || PLACED.has(tool) || tool === "pen") return setCursor("crosshair");
  const h = s && handleAt(s, sx, sy);
  setCursor(h ? ("corner" in h ? CURSORS[h.corner] : "pointer") : "default");
}

// ---- Pointer ---------------------------------------------------------------------------------------
/** Where a page point falls in the browser node in use, if it does (node pixels from its corner). */
function inLivePage(s: Scene, px: number, py: number): { id: string; x: number; y: number } | null {
  const id = store.get().browserLive;
  const box = id ? s.boxes.get(id) : undefined;
  if (!id || !box || px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) return null;
  return { id, x: Math.round(px - box.x), y: Math.round(py - box.y) };
}

const BUTTONS = ["left", "middle", "right"] as const;

function onDown(e: PointerEvent) {
  const s = currentScene();
  if (!s) return;
  const screen = { x: e.offsetX, y: e.offsetY };
  const [px, py] = toPage(screen.x, screen.y);
  const at = { x: px, y: py };
  // A page in use takes presses inside it; a press anywhere else stops using it.
  if (store.get().browserLive) {
    const hit = inLivePage(s, px, py);
    if (hit && e.button <= 2) {
      bridge.browser.input(hit.id, { type: "mouseDown", x: hit.x, y: hit.y, button: BUTTONS[e.button]!, clickCount: e.detail || 1 });
      gesture = { kind: "page", id: hit.id };
      el.setPointerCapture(e.pointerId);
      return;
    }
    store.set({ browserLive: null });
  }
  if (e.button === 1 || (e.button === 0 && (space || store.get().tool === "hand"))) {
    gesture = { kind: "pan", screen };
    setCursor("grabbing");
  } else if (e.button !== 0) {
    menuPoint = at;
    // Right-click selects what is under the pointer (unless it is already selected) for the menu.
    const pick = labelAt(px, py) ?? clickPick(s, px, py, store.get().selection, e.ctrlKey || e.metaKey);
    if (!pick || !store.get().selection.includes(pick)) store.set({ selection: pick ? [pick] : [] });
    return;
  } else {
    if (editingPointer(e, at)) return;
    stopTextEdit();
    const tool = store.get().tool;
    if (tool !== "pen" && overlay.pen) finishPath(false);
    if (DRAWN.has(tool)) {
      gesture = { kind: "draw", tool, from: at, container: frameAt(s, px, py) };
    } else if (PLACED.has(tool)) {
      gesture = { kind: "place", tool, at, container: frameAt(s, px, py) };
    } else if (tool === "pen") {
      penDown(at, screen);
    } else if (tool === "comment") {
      // With a thread or a new comment open, a press elsewhere only closes it (as in Pen).
      const st = store.get();
      if (st.commentOpen || st.commentDraft) store.set({ commentOpen: null, commentDraft: null });
      else startComment(at, pathAt(s, px, py).at(-1)?.id ?? null);
    } else if (tool === "move" && cardPress(s, at, screen)) {
      return;
    } else if (tool === "move") {
      const h = handleAt(s, screen.x, screen.y);
      if (h && "corner" in h) {
        gesture = { kind: "resize", from: at, corner: h.corner, held: hold(s, store.get().selection), union: unionBox(s.boxes, store.get().selection)! };
        beginChange();
      } else if (h) {
        gesture = { kind: "radius", id: h.id, box: boxOf(s, h.id), corner: h.radius };
        beginChange();
      } else {
        const deep = e.ctrlKey || e.metaKey;
        const selection = store.get().selection;
        const pick = labelAt(px, py) ?? clickPick(s, px, py, selection, deep);
        const fresh = !!pick && !selection.includes(pick);
        // A press on something not yet selected selects it at once, so a drag moves it.
        if (fresh) store.set({ selection: e.shiftKey ? [...selection, pick!] : [pick!] });
        gesture = { kind: "press", at, screen, pick, shift: e.shiftKey, deep, fresh };
      }
    }
  }
  el.setPointerCapture(e.pointerId);
  schedule();
}

function onMove(e: PointerEvent) {
  const s = currentScene();
  const screen = { x: e.offsetX, y: e.offsetY };
  const [px, py] = toPage(screen.x, screen.y);
  if (gesture?.kind === "page" || (!gesture && s && inLivePage(s, px, py))) {
    const live = s && inLivePage(s, px, py);
    const id = gesture?.kind === "page" ? gesture.id : live!.id;
    const box = s?.boxes.get(id);
    if (box) bridge.browser.input(id, { type: "mouseMove", x: Math.round(px - box.x), y: Math.round(py - box.y) });
    setCursor(pageCursor(id));
    return;
  }
  if (!gesture) {
    if (!s) return;
    idleCursor(s, screen.x, screen.y);
    if (overlay.pen) (overlay.pen.cursor = { x: px, y: py }), schedule();
    const tool = store.get().tool;
    const hover = tool === "move" && !space ? (labelAt(px, py) ?? clickPick(s, px, py, store.get().selection, e.ctrlKey || e.metaKey)) : null;
    if (hover !== store.get().hover) (store.set({ hover }), schedule());
    return;
  }
  if (!s) return;
  const g = gesture;
  if (g.kind === "pan") {
    view.x -= (screen.x - g.screen.x) / view.zoom;
    view.y -= (screen.y - g.screen.y) / view.zoom;
    g.screen = screen;
  } else if (g.kind === "press") {
    if (Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) < DRAG_START) return;
    store.set({ hover: null });
    if (g.pick) {
      const union = unionBox(s.boxes, store.get().selection)!;
      const held = hold(s, store.get().selection);
      beginChange();
      const move: Gesture = { kind: "move", from: g.at, held, union, live: false, deep: false, originals: held, copying: false, last: g.at };
      gesture = move;
      setCopying(move, e.altKey);
      overlay.moving = true;
    } else gesture = { kind: "marquee", from: g.at, base: g.shift ? store.get().selection : [], deep: g.deep };
    return onMove(e);
  } else if (g.kind === "marquee") {
    const rect = rectBetween(g.from, { x: px, y: py });
    overlay.marquee = rect;
    const picked = boxPick(s, rect, g.from, g.deep || e.ctrlKey || e.metaKey);
    store.set({ selection: [...new Set([...g.base, ...picked])] });
  } else if (g.kind === "move") {
    setCopying(g, e.altKey);
    g.last = { x: px, y: py };
    moveTo(s, g, px, py, e.ctrlKey || e.metaKey);
  }
  else if (g.kind === "resize") resizeTo(g, px, py, e.shiftKey, e.altKey);
  else if (g.kind === "radius") roundTo(g, px, py);
  else if (g.kind === "draw") {
    overlay.draft = drawnBox(g, { x: px, y: py }, e.shiftKey);
  } else if (g.kind === "pen") penDrag(g, { x: px, y: py }, screen);
  schedule();
}

function onUp(e: PointerEvent) {
  const g = gesture;
  gesture = null;
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  const s = currentScene();
  if (!g || !s) return;
  const [px, py] = toPage(e.offsetX, e.offsetY);
  if (g.kind === "page") {
    const box = s.boxes.get(g.id);
    if (box) bridge.browser.input(g.id, { type: "mouseUp", x: Math.round(px - box.x), y: Math.round(py - box.y), button: BUTTONS[e.button] ?? "left", clickCount: e.detail || 1 });
    return;
  }
  if (g.kind === "press") {
    // A click (no drag) on something already selected narrows the selection to it; with Shift it
    // takes it out. A click on nothing clears the selection.
    const selection = store.get().selection;
    if (!g.pick) {
      if (!g.shift) store.set({ selection: [] });
    } else if (!g.fresh) {
      if (g.shift) store.set({ selection: selection.filter((id) => id !== g.pick) });
      else store.set({ selection: [g.pick] });
    }
  } else if (g.kind === "move") {
    drop(s, g, px, py);
    endChange();
  } else if (g.kind === "resize" || g.kind === "radius") endChange();
  else if (g.kind === "draw") draw(s, g, { x: px, y: py }, e.shiftKey);
  else if (g.kind === "place") place(s, g);
  Object.assign(overlay, { marquee: null, guides: [], drop: null, ghosts: [], draft: null, moving: false, resizing: false });
  idleCursor(s, e.offsetX, e.offsetY);
  schedule();
}

function onDoubleClick(e: MouseEvent) {
  const s = currentScene();
  if (!s || store.get().tool !== "move" || overlay.editing) return;
  const [px, py] = toPage(e.offsetX, e.offsetY);
  // A double-click on a browser showing a page starts using the page (Escape stops), as in Pen.
  const under = clickPick(s, px, py, store.get().selection, false);
  const node = under ? index(s.tree).get(under) : undefined;
  if (node?.type === "browser" && node.props.url) {
    store.set({ browserLive: node.id, selection: [node.id], hover: null });
    schedule();
    return;
  }
  const r = doubleClickPick(s, px, py, store.get().selection);
  if (r.edit && r.id) startTextEdit(r.id, { x: px, y: py });
  else if (r.id) store.set({ selection: [r.id] });
  schedule();
}

const rectBetween = (a: Point, b: Point): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

// ---- Moving ----------------------------------------------------------------------------------------
/** The ids being moved, for skipping them (and what is inside them) as drop targets. */
const movingIds = (g: { held: Held[] }) => new Set(g.held.map((h) => h.node.id));

/**
 * Where a move would drop, as in Pen: into the deepest frame under the pointer (the page when none),
 * top-level frames too. Nodes in a row or column stay in it (they change place) while the pointer is
 * inside it, unless Ctrl/⌘ is held; nodes in a group stay in it while over the group's frame.
 */
function dropTarget(s: Scene, g: { held: Held[] }, px: number, py: number, deep: boolean): TreeNode {
  const parent = g.held[0]!.parent;
  // Parts of a copy of a component stay where they are (only their own x and y can change).
  if (g.held.some((h) => docStore.isPart(h.node.id))) return parent;
  const pb = s.boxes.get(parent.id);
  const inside = !!pb && px >= pb.x && px <= pb.x + pb.w && py >= pb.y && py <= pb.y + pb.h;
  const together = g.held.every((h) => h.parent.id === parent.id);
  if (!deep && inside && flows(parent) && together) return parent;
  const frame = frameAt(s, px, py, movingIds(g));
  if (together && parent.type === "group" && frameAround(parents(s.tree), parent).id === frame.id) return parent;
  return frame;
}

/**
 * Alt during a move, as in Pen: held, the drag carries copies (made right after each node, where it
 * started) and the nodes go back; let go, the copies go and the nodes themselves move again.
 */
function setCopying(g: Extract<Gesture, { kind: "move" }>, on: boolean): void {
  if (on === g.copying || !g.originals.every((h) => movable(h.node.id))) return;
  edit(() => {
    // What moved so far goes back to where it started.
    if (g.live) g.held.forEach((h) => docStore.update(doc, h.node.id, { x: Math.round(h.box.x - h.parentBox.x), y: Math.round(h.box.y - h.parentBox.y) }));
    if (on) {
      const copies = g.originals.map((h) => copyInPlace(doc, h.node.id));
      g.held = g.originals.map((h, i) => ({ ...h, node: { ...h.node, id: copies[i]! } }));
    } else {
      g.held.forEach((h) => docStore.remove(doc, h.node.id));
      g.held = g.originals;
    }
  });
  g.live = false;
  g.copying = on;
  store.set({ selection: g.held.map((h) => h.node.id) });
}

function moveTo(s: Scene, g: Extract<Gesture, { kind: "move" }>, px: number, py: number, deep: boolean) {
  g.deep = deep;
  let dx = px - g.from.x;
  let dy = py - g.from.y;
  const target = dropTarget(s, g, px, py, deep);
  const parent = g.held[0]!.parent;
  const stays = g.held.every((h) => h.parent.id === target.id && h.free);
  if (stays) {
    // Moving within its own place: the nodes follow the pointer, snapping to what is beside them.
    const moving = movingIds(g);
    const others = parent.children.filter((c) => !moving.has(c.id) && c.props.enabled !== false).map((c) => boxOf(s, c.id));
    if (parent.id !== ROOT_ID) others.push(boxOf(s, parent.id));
    const snap = snapBox({ ...g.union, x: g.union.x + dx, y: g.union.y + dy }, others, SNAP / view.zoom);
    dx += snap.dx;
    dy += snap.dy;
    overlay.guides = snap.guides;
    overlay.ghosts = [];
    overlay.drop = null;
    g.live = true;
    edit(() => {
      for (const h of g.held) docStore.update(doc, h.node.id, { x: Math.round(h.box.x - h.parentBox.x + dx), y: Math.round(h.box.y - h.parentBox.y + dy) });
    });
    return;
  }
  // Going somewhere else (another frame, or a place in a row or column): show where, move on drop.
  if (g.live) {
    edit(() => g.held.forEach((h) => docStore.update(doc, h.node.id, { x: Math.round(h.box.x - h.parentBox.x), y: Math.round(h.box.y - h.parentBox.y) })));
    g.live = false;
  }
  overlay.guides = [];
  overlay.ghosts = g.held.map((h) => ({ ...h.box, x: h.box.x + dx, y: h.box.y + dy }));
  overlay.drop = flows(target) ? flowSlot(s, target, px, py, movingIds(g)).line : null;
}

function drop(s: Scene, g: Extract<Gesture, { kind: "move" }>, px: number, py: number) {
  const target = dropTarget(s, g, px, py, g.deep);
  if (g.held.every((h) => h.parent.id === target.id && h.free)) return; // moved as it went
  if (g.held.some((h) => docStore.isPart(h.node.id))) return;
  const dx = px - g.from.x;
  const dy = py - g.from.y;
  edit(() => {
    if (flows(target)) {
      // Into a row or column: before the child now at the slot, keeping the moved nodes' order.
      const moving = movingIds(g);
      const { index: at } = flowSlot(s, target, px, py, moving);
      const anchor = target.children.filter((c) => !moving.has(c.id))[at]?.id;
      for (const h of g.held) {
        const siblings = docStore.childIds(doc, target.id).filter((c) => c !== h.node.id);
        docStore.move(doc, h.node.id, target.id, anchor ? siblings.indexOf(anchor) : undefined);
        // The row or column places it: an x and y from before would only be stale.
        if (h.node.props.layoutPosition !== "absolute") docStore.update(doc, h.node.id, { x: null, y: null } as never);
      }
    } else {
      const tb = originIn(s, target);
      for (const h of g.held) {
        docStore.move(doc, h.node.id, target.id);
        docStore.update(doc, h.node.id, { x: Math.round(h.box.x + dx - tb.x), y: Math.round(h.box.y + dy - tb.y) });
      }
    }
  });
}

// ---- Resizing --------------------------------------------------------------------------------------
function resizeTo(g: Extract<Gesture, { kind: "resize" }>, px: number, py: number, keepRatio: boolean, fromCentre: boolean) {
  overlay.resizing = true;
  const u = g.union;
  const dx = px - g.from.x;
  const dy = py - g.from.y;
  let [l, t, r, b] = [u.x, u.y, u.x + u.w, u.y + u.h];
  const c = g.corner;
  if (c.includes("w")) l += dx;
  if (c.includes("e")) r += dx;
  if (c.includes("n")) t += dy;
  if (c.includes("s")) b += dy;
  if (fromCentre) {
    if (c.includes("w")) r -= dx;
    if (c.includes("e")) l -= dx;
    if (c.includes("n")) b -= dy;
    if (c.includes("s")) t -= dy;
  }
  let w = Math.max(1, Math.abs(r - l));
  let h = Math.max(1, Math.abs(b - t));
  if (keepRatio && c.length === 2) {
    const k = Math.max(w / u.w, h / u.h);
    [w, h] = [u.w * k, u.h * k];
    if (c.includes("w")) l = r - w;
    if (c.includes("n")) t = b - h;
  }
  const box = { x: Math.min(l, r), y: Math.min(t, b), w, h };
  const sx = box.w / u.w;
  const sy = box.h / u.h;
  const horizontal = c !== "n" && c !== "s";
  const vertical = c !== "e" && c !== "w";
  edit(() => {
    for (const hd of g.held) {
      const props: Partial<NodeProps> = {};
      if (horizontal) props.width = Math.max(1, Math.round(hd.box.w * sx));
      if (vertical) props.height = Math.max(1, Math.round(hd.box.h * sy));
      if (hd.free) {
        props.x = Math.round(box.x + (hd.box.x - u.x) * sx - hd.parentBox.x);
        props.y = Math.round(box.y + (hd.box.y - u.y) * sy - hd.parentBox.y);
      }
      docStore.update(doc, hd.node.id, props);
    }
  });
}

/** Dragging a corner-radius handle towards the middle rounds all four corners. */
function roundTo(g: Extract<Gesture, { kind: "radius" }>, px: number, py: number) {
  const b = g.box;
  const [cx, cy] = [g.corner % 2 ? b.x + b.w : b.x, g.corner < 2 ? b.y : b.y + b.h];
  const inward = (Math.abs(px - cx) + Math.abs(py - cy)) / 2;
  const radius = Math.round(Math.max(0, Math.min(Math.min(b.w, b.h) / 2, inward)));
  edit(() => docStore.update(doc, g.id, { cornerRadius: radius }));
}

// ---- Drawing ---------------------------------------------------------------------------------------
function drawnBox(g: Extract<Gesture, { kind: "draw" }>, to: Point, square: boolean): Box {
  let w = to.x - g.from.x;
  let h = to.y - g.from.y;
  if (square) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    [w, h] = [Math.sign(w || 1) * side, Math.sign(h || 1) * side];
  }
  return rectBetween(g.from, { x: g.from.x + w, y: g.from.y + h });
}

function draw(s: Scene, g: Extract<Gesture, { kind: "draw" }>, to: Point, square: boolean) {
  const dragged = Math.hypot(to.x - g.from.x, to.y - g.from.y) * view.zoom >= DRAG_START;
  const box = dragged ? drawnBox(g, to, square) : { x: g.from.x, y: g.from.y, w: DEFAULT_SIZE, h: DEFAULT_SIZE };
  const size = { width: Math.max(1, Math.round(box.w)), height: Math.max(1, Math.round(box.h)) };
  const spec: PenNode =
    g.tool === "rect"
      ? { type: "rectangle", name: "Rectangle", ...size, fill: SHAPE_FILL }
      : g.tool === "ellipse"
        ? { type: "ellipse", name: "Ellipse", ...size, fill: SHAPE_FILL }
        : g.tool === "polygon"
          ? { type: "polygon", name: "Polygon", ...size, polygonCount: 3, fill: SHAPE_FILL }
        : g.tool === "frame"
          ? { type: "frame", name: "Frame", ...size, fill: "#FFFFFF", layout: "none" }
          : { type: "text", content: "", fontFamily: "Inter", fontSize: 14, fill: "#000000", ...(dragged ? { textGrowth: "fixed-width", width: size.width } : {}) };
  const c = g.container;
  let id = "";
  edit(() => {
    if (flows(c)) id = docStore.insert(doc, c.id, spec, flowSlot(s, c, g.from.x, g.from.y).index);
    else {
      const cb = c.id === ROOT_ID ? PAGE : boxOf(s, c.id);
      id = docStore.insert(doc, c.id, { ...spec, x: Math.round(box.x - cb.x), y: Math.round(box.y - cb.y) });
    }
  });
  store.set({ selection: [id], tool: "move" });
  if (g.tool === "text") startTextEdit(id);
}

/** Tools that draw a box with a drag (or a click, at their default size). */
const DRAWN = new Set<Tool>(["rect", "ellipse", "polygon", "frame", "text"]);
/**
 * Tools that place a node of a fixed size centred on the click (measured in Pen): an icon (a heart,
 * 24 × 24), a script (200 × 200), a prompt card (the Sticky Note tool, 250 × 219, on the page) and a
 * browser (1200 × 1200, on the page). A drag doesn't size them.
 */
const PLACED = new Set<Tool>(["icon", "script", "note", "browser"]);

function place(s: Scene, g: Extract<Gesture, { kind: "place" }>) {
  const spec: PenNode =
    g.tool === "icon"
      ? { type: "icon", name: "Icon", icon: "heart", library: "lucide", fill: "#FFFFFF", width: 24, height: 24 }
      : g.tool === "script"
        ? { type: "script", name: "Script", width: 200, height: 200 }
        : g.tool === "note"
          ? { type: "prompt", content: "", width: 250, height: 219 }
          : { type: "browser", name: "Browser", width: 1200, height: 1200, cornerRadius: 16 };
  const w = Number(spec.width);
  const h = Number(spec.height);
  const box = { x: Math.round(g.at.x - w / 2), y: Math.round(g.at.y - h / 2), w, h };
  // Cards and browsers go on the page; icons and scripts into the frame under the pointer.
  const c = g.tool === "note" || g.tool === "browser" ? s.tree : g.container;
  let id = "";
  edit(() => {
    if (flows(c)) id = docStore.insert(doc, c.id, spec, flowSlot(s, c, g.at.x, g.at.y).index);
    else {
      const cb = c.id === ROOT_ID ? PAGE : boxOf(s, c.id);
      id = docStore.insert(doc, c.id, { ...spec, x: box.x - cb.x, y: box.y - cb.y });
    }
  });
  store.set({ selection: [id], tool: "move" });
  if (g.tool === "note") startTextEdit(id);
  if (g.tool === "browser") {
    zoomToFit(true, box, 1);
    store.set({ urlEdit: id });
  }
}

// ---- The pen -------------------------------------------------------------------------------------
/** How close (screen pixels) a click must be to the first point to close the path. */
const CLOSE_HIT = 8;

/** A press with the pen: a new point (a drag pulls out its curve handles), or the first point again to close. */
function penDown(at: Point, screen: Point) {
  const pen = (overlay.pen ??= { points: [], cursor: at });
  const first = pen.points[0];
  if (first && pen.points.length > 1) {
    const [fx, fy] = toScreen(first.x, first.y);
    if (Math.hypot(fx - screen.x, fy - screen.y) <= CLOSE_HIT) return finishPath(true);
  }
  pen.points.push({ x: at.x, y: at.y });
  gesture = { kind: "pen", from: at, screen };
}

/** Dragging after a press: the point's outgoing handle follows the pointer, the incoming one mirrors it. */
function penDrag(g: Extract<Gesture, { kind: "pen" }>, to: Point, screen: Point) {
  const p = overlay.pen?.points.at(-1);
  if (!p || Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) < DRAG_START) return;
  p.out = { x: to.x, y: to.y };
  p.in = { x: 2 * p.x - to.x, y: 2 * p.y - to.y };
}

/** The path's SVG commands, offset by (dx, dy). */
function pathData(points: PenPoint[], closed: boolean, dx = 0, dy = 0): string {
  const f = (n: number) => String(Math.round(n * 100) / 100);
  const pt = (q: Point) => `${f(q.x - dx)} ${f(q.y - dy)}`;
  const seg = (a: PenPoint, b: PenPoint) => (a.out || b.in ? `C${pt(a.out ?? a)} ${pt(b.in ?? b)} ${pt(b)}` : `L${pt(b)}`);
  let d = `M${pt(points[0]!)}`;
  for (let i = 1; i < points.length; i++) d += seg(points[i - 1]!, points[i]!);
  if (closed) d += `${seg(points.at(-1)!, points[0]!)}Z`;
  return d;
}

/** Ends the path being drawn (Enter, Escape, the first point again, or another tool): it becomes a Path node, as in Pen (a 1px black stroke). */
export function finishPath(closed: boolean): void {
  const pen = overlay.pen;
  overlay.pen = null;
  const s = currentScene();
  // The pen gives way to the move tool; a tool picked meanwhile stays.
  const done = () => store.get().tool === "pen" && store.set({ tool: "move" });
  if (!pen || !s || pen.points.length < 2) return void (done(), schedule());
  const { ck } = engine;
  const shape = ck.Path.MakeFromSVGString(pathData(pen.points, closed));
  const [l, t, r, b] = shape ? Array.from(shape.computeTightBounds()) : [0, 0, 1, 1];
  shape?.delete();
  const spec: PenNode = {
    type: "path",
    name: "Path",
    geometry: pathData(pen.points, closed, l!, t!),
    width: Math.max(1, Math.round((r! - l!) * 100) / 100),
    height: Math.max(1, Math.round((b! - t!) * 100) / 100),
    stroke: "#000000",
    strokeWidth: 1,
  };
  let id = "";
  edit(() => (id = docStore.insert(doc, ROOT_ID, { ...spec, x: Math.round(l! * 100) / 100, y: Math.round(t! * 100) / 100 })));
  store.set({ selection: [id] });
  done();
  schedule();
}

// ---- Cards ---------------------------------------------------------------------------------------
/**
 * A press on a prompt card's Run button sends its text to the agent; on a selected card's header it
 * opens the menu that changes its kind (note, context, prompt); on a selected empty browser's address
 * bar it opens the address field. Returns whether it was any of these.
 */
function cardPress(s: Scene, at: Point, screen: Point): boolean {
  const inside = (b: { x: number; y: number; w: number; h: number }) => at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h;
  for (const n of index(s.tree).values()) {
    if (n.props.enabled === false) continue;
    const box = s.boxes.get(n.id);
    if (!box) continue;
    // A selected browser with no address: its bar takes the address.
    if (n.type === "browser" && !n.props.url && store.get().selection.includes(n.id) && inside(browserBar(box))) {
      store.set({ urlEdit: n.id });
      return true;
    }
    if (!isCard(n.type)) continue;
    if (n.type === "prompt" && inside(runButton(box))) {
      sendPrompt(String(n.props.content ?? ""));
      return true;
    }
    const head = cardHeader(box);
    if (store.get().selection.includes(n.id) && inside({ ...head, w: Math.min(head.w, 120) })) {
      const [, sy] = toScreen(head.x, head.y + head.h);
      store.set({ cardMenu: { id: n.id, x: screen.x, y: sy } });
      return true;
    }
  }
  return false;
}

// ---- Keys ------------------------------------------------------------------------------------------
const TOOL_KEYS: Record<string, Tool> = { v: "move", h: "hand", r: "rect", o: "ellipse", f: "frame", a: "frame", t: "text", p: "pen", n: "note", c: "comment" };

/** Handles a key meant for the canvas; returns whether it did. */
export function canvasKey(e: KeyboardEvent): boolean {
  if (altDuringMove(e)) return true;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === " " && !mod) {
    e.preventDefault();
    if (!space) (space = true), el && idleCursor(currentScene(), -1, -1);
    return true;
  }
  if (overlay.pen && (e.key === "Enter" || e.key === "Escape")) {
    e.preventDefault();
    finishPath(false);
    return true;
  }
  if (!mod && !e.altKey && !e.shiftKey && TOOL_KEYS[key]) {
    if (overlay.pen) finishPath(false);
    store.set({ tool: TOOL_KEYS[key]! });
    return true;
  }
  if (e.key === "Escape" && store.get().tool !== "move") {
    // Leaving the Comment tool drops an unsent comment; the pins stay.
    store.set({ tool: "move", commentDraft: null });
    return true;
  }
  if (e.key.startsWith("Arrow") && !mod) {
    e.preventDefault();
    nudge(e.key.slice(5).toLowerCase() as "left" | "right" | "up" | "down", e.shiftKey ? 10 : 1);
    return true;
  }
  if (mod && (e.key === "]" || e.key === "[")) {
    e.preventDefault();
    step(e.key === "]" ? 1 : -1);
    return true;
  }
  return false;
}

/** Alt pressed or let go while moving: switches between moving the nodes and moving copies. */
function altDuringMove(e: KeyboardEvent): boolean {
  const s = currentScene();
  if (e.key !== "Alt" || gesture?.kind !== "move" || !s) return false;
  // Alt alone would also open the window's menu bar.
  e.preventDefault();
  setCopying(gesture, e.type === "keydown");
  moveTo(s, gesture, gesture.last.x, gesture.last.y, gesture.deep);
  schedule();
  return true;
}

export function canvasKeyUp(e: KeyboardEvent): void {
  if (altDuringMove(e)) return;
  if (e.key === " ") (space = false), el && idleCursor(currentScene(), -1, -1);
}

/**
 * The arrows move freely placed nodes by a pixel (ten with Shift); a node in a row or column moves one
 * place along it instead.
 */
function nudge(dir: "left" | "right" | "up" | "down", by: number) {
  const s = currentScene();
  if (!s) return;
  const held = hold(s, store.get().selection);
  if (!held.length) return;
  const [dx, dy] = { left: [-by, 0], right: [by, 0], up: [0, -by], down: [0, by] }[dir];
  edit(() => {
    for (const h of held) {
      if (h.free) {
        docStore.update(doc, h.node.id, { x: Math.round(h.box.x - h.parentBox.x + dx!), y: Math.round(h.box.y - h.parentBox.y + dy!) });
        continue;
      }
      const row = kindOf(h.parent) === "row";
      if ((row && dy) || (!row && dx) || docStore.isPart(h.node.id)) continue;
      const siblings = docStore.childIds(doc, h.parent.id);
      const at = siblings.indexOf(h.node.id) + Math.sign(dx! + dy!);
      if (at >= 0 && at < siblings.length) docStore.move(doc, h.node.id, h.parent.id, at);
    }
  });
}

/** Ctrl/⌘ + ] and [: bring forward or send backward one place. */
export function step(dir: 1 | -1) {
  const ids = store.get().selection.filter((id) => !docStore.isPart(id));
  edit(() => {
    for (const id of dir > 0 ? [...ids].reverse() : ids) {
      const parent = docStore.parentOf(doc, id);
      if (!parent) continue;
      const siblings = docStore.childIds(doc, parent);
      const at = siblings.indexOf(id) + dir;
      if (at >= 0 && at < siblings.length) docStore.move(doc, id, parent, at);
    }
  });
}

export function attachGestures(canvas: HTMLCanvasElement): () => void {
  el = canvas;
  const onLeave = () => (store.get().hover && store.set({ hover: null }), schedule());
  // A component dragged from the Components panel (a copy of it goes where it is dropped), or picture
  // files (each becomes an image there).
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes(COMPONENT_DRAG) || carriesPictures(e)) (e.preventDefault(), (e.dataTransfer!.dropEffect = "copy"));
  };
  const onDrop = (e: DragEvent) => {
    const [px, py] = toPage(e.offsetX, e.offsetY);
    const main = e.dataTransfer?.getData(COMPONENT_DRAG);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!main && !files.length) return;
    e.preventDefault();
    if (main) placeCopy(main, px, py);
    else void placePictures(files, px, py).then(schedule);
    schedule();
  };
  el.addEventListener("dragover", onDragOver);
  el.addEventListener("drop", onDrop);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("dblclick", onDoubleClick);
  el.addEventListener("pointerleave", onLeave);
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("dblclick", onDoubleClick);
    el.removeEventListener("pointerleave", onLeave);
    el.removeEventListener("dragover", onDragOver);
    el.removeEventListener("drop", onDrop);
  };
}
