// The design canvas: draws the document with CanvasKit, plus the editor's overlays (frame names,
// hover and selection outlines, size pill, agent cursor), and handles panning, zooming and selecting.
import type { Canvas, Surface } from "canvaskit-wasm";
import { drawNode } from "../../render/draw.js";
import type { TreeNode } from "../../doc/schema.js";
import type { Box } from "../../layout/layout.js";
import { CANVAS_UI_FONT, currentScene, engine } from "../scene.js";
import { store } from "../store.js";
import { getSettings } from "../settings.js";

// Overlay look, measured from the reference captures.
const SELECT = "#3d99ff";
/** Frame names use the theme's muted text colour. */
const label = () => getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground").trim() || "#a1a1aa";
const LABEL_SIZE = 12;
const HANDLE = 8;
const PILL_H = 20;
const PILL_GAP = 6;
const BADGE = 16;

/** Zoom steps for the zoom buttons and Ctrl +/−. */
export const ZOOM_PRESETS = [0.02, 0.03, 0.05, 0.08, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** Page coordinates at the canvas's top-left corner, and the zoom. */
export const view = { x: 0, y: 0, zoom: 1 };
export const cursor = { name: "", x: 0, y: 0, shown: false, since: 0 };

let el: HTMLCanvasElement;
let surface: Surface | null = null;
let queued = false;
let fitted = false;

export function schedule(): void {
  if (queued || !el) return;
  queued = true;
  requestAnimationFrame(draw);
}

function makeSurface() {
  const dpr = devicePixelRatio || 1;
  el.width = Math.round(el.clientWidth * dpr);
  el.height = Math.round(el.clientHeight * dpr);
  surface?.delete();
  // WebGL when the machine has a GPU; CanvasKit's software surface otherwise.
  try {
    surface = engine.ck.MakeWebGLCanvasSurface(el);
  } catch {
    surface = null;
  }
  surface ??= engine.ck.MakeSWCanvasSurface(el);
}

const toScreen = (px: number, py: number) => [(px - view.x) * view.zoom, (py - view.y) * view.zoom] as const;
const toPage = (sx: number, sy: number) => [view.x + sx / view.zoom, view.y + sy / view.zoom] as const;

export function setZoom(zoom: number, sx = el.clientWidth / 2, sy = el.clientHeight / 2): void {
  zoom = Math.min(32, Math.max(0.02, zoom));
  const [px, py] = toPage(sx, sy); // keep this point under the cursor
  view.zoom = zoom;
  view.x = px - sx / zoom;
  view.y = py - sy / zoom;
  store.set({ zoom });
  schedule();
}

export function zoomStep(dir: 1 | -1): void {
  const next =
    dir > 0
      ? ZOOM_PRESETS.find((p) => p > view.zoom + 1e-6)
      : [...ZOOM_PRESETS].reverse().find((p) => p < view.zoom - 1e-6);
  if (next) setZoom(next);
}

let animation: number | undefined;
/** Fits `box` (default: all top-level frames) in the free area right of the panels. */
export function zoomToFit(animate = true, box?: Box, maxZoom = 1): void {
  const s = currentScene();
  if (!s) return;
  if (!box) {
    let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of s.tree.children) {
      const bx = s.boxes.get(f.id);
      if (!bx) continue;
      [l, t, r, b] = [Math.min(l, bx.x), Math.min(t, bx.y), Math.max(r, bx.x + bx.w), Math.max(b, bx.y + bx.h)];
    }
    if (l === Infinity) return;
    box = { x: l, y: t, w: r - l, h: b - t };
  }
  const left = obstructionLeft();
  const pad = 64;
  const availW = el.clientWidth - left - pad * 2;
  const availH = el.clientHeight - pad * 2;
  const zoom = Math.min(maxZoom, availW / box.w, availH / box.h);
  const target = {
    zoom,
    x: box.x - (left + pad + (availW - box.w * zoom) / 2) / zoom,
    y: box.y - (pad + (availH - box.h * zoom) / 2) / zoom,
  };
  if (animation) cancelAnimationFrame(animation);
  if (!animate) {
    Object.assign(view, target);
    store.set({ zoom });
    return schedule();
  }
  const from = { ...view };
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / 300);
    const e = 1 - (1 - k) ** 3; // ease out, as measured in the recordings
    view.zoom = from.zoom + (target.zoom - from.zoom) * e;
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    store.set({ zoom: view.zoom });
    schedule();
    animation = k < 1 ? requestAnimationFrame(tick) : undefined;
  };
  animation = requestAnimationFrame(tick);
}

/** How much of the canvas's left side the floating panels cover (left panel + tool rail). */
function obstructionLeft(): number {
  const rail = document.querySelector("[data-rail]")?.getBoundingClientRect();
  return rail ? rail.right : 0;
}

// ---- Hit testing ----------------------------------------------------------------------------------
function contains(b: Box | undefined, x: number, y: number) {
  return !!b && x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
}

/**
 * What a click at page (x, y) selects: a frame's name label selects the frame; inside a top-level
 * frame, the frame's topmost direct child under the point (as Pen does), otherwise the frame itself.
 */
export function hitTest(x: number, y: number): string | null {
  const s = currentScene();
  if (!s) return null;
  const frames = [...s.tree.children].reverse();
  for (const f of frames) {
    const b = s.boxes.get(f.id);
    if (b && labelHit(f, b, x, y)) return f.id;
  }
  for (const f of frames) {
    if (!contains(s.boxes.get(f.id), x, y)) continue;
    const child = [...f.children].reverse().find((c) => c.props.visible !== false && contains(s.boxes.get(c.id), x, y));
    return child ? child.id : f.id;
  }
  return null;
}

function labelHit(f: TreeNode, b: Box, x: number, y: number): boolean {
  const [sx, sy] = toScreen(b.x, b.y);
  const [px, py] = toScreen(x, y);
  const w = labelWidth(f);
  return px >= sx && px <= sx + w && py >= sy - LABEL_SIZE - 10 && py <= sy - 2;
}

// ---- Drawing --------------------------------------------------------------------------------------
function uiText(text: string, size: number, color: string, weight = 400) {
  return engine.text.paragraph({ text, font: CANVAS_UI_FONT, size, weight, color, lineHeight: 1.2 }, {});
}
function labelWidth(f: TreeNode) {
  const p = uiText(f.props.name ?? "Frame", LABEL_SIZE, label());
  p.layout(10000);
  return p.getMaxIntrinsicWidth();
}

function draw() {
  queued = false;
  if (!surface) return;
  const { ck } = engine;
  const canvas = surface.getCanvas();
  const dpr = devicePixelRatio || 1;
  canvas.clear(ck.parseColorString(getComputedStyle(document.body).getPropertyValue("--canvas-bg").trim() || "#18181b"));
  const s = currentScene(schedule);
  if (s && !fitted && s.tree.children.length) {
    fitted = true;
    zoomToFit(false);
    return draw();
  }
  if (s) {
    const st = store.get();
    canvas.save();
    canvas.scale(dpr, dpr);
    canvas.save();
    canvas.scale(view.zoom, view.zoom);
    canvas.translate(-view.x, -view.y);
    for (const frame of s.tree.children) drawNode({ ck, text: engine.text, vars: s.vars, boxes: s.boxes }, canvas, frame);
    canvas.restore();
    for (const frame of s.tree.children) drawLabel(canvas, frame, s.boxes.get(frame.id), frame.id === st.selection);
    if (st.hover && st.hover !== st.selection) outline(canvas, s.boxes.get(st.hover));
    if (st.selection) drawSelection(canvas, s.tree, s.boxes.get(st.selection), st.selection);
    if (cursor.shown) drawCursor(canvas);
    canvas.restore();
  }
  surface.flush();
  if (cursor.shown && performance.now() - cursor.since < 250) schedule(); // fade in
}

function drawLabel(canvas: Canvas, f: TreeNode, b: Box | undefined, selected: boolean) {
  if (!b) return;
  const [x, y] = toScreen(b.x, b.y);
  const p = uiText(f.props.name ?? "Frame", LABEL_SIZE, selected ? SELECT : label());
  p.layout(Math.max(40, b.w * view.zoom));
  canvas.drawParagraph(p, x, y - LABEL_SIZE - 8);
}

function outline(canvas: Canvas, b: Box | undefined) {
  if (!b) return;
  const { ck } = engine;
  const [x, y] = toScreen(b.x, b.y);
  const paint = new ck.Paint();
  paint.setColor(ck.parseColorString(SELECT));
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  canvas.drawRect(ck.XYWHRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(b.w * view.zoom), Math.round(b.h * view.zoom)), paint);
  paint.delete();
}

function drawSelection(canvas: Canvas, tree: TreeNode, b: Box | undefined, id: string) {
  if (!b) return;
  const { ck } = engine;
  outline(canvas, b);
  const [x, y] = toScreen(b.x, b.y);
  const w = b.w * view.zoom;
  const h = b.h * view.zoom;
  const fill = new ck.Paint();
  fill.setAntiAlias(true);
  const stroke = new ck.Paint();
  stroke.setStyle(ck.PaintStyle.Stroke);
  stroke.setStrokeWidth(1);
  stroke.setColor(ck.parseColorString(SELECT));
  // Corner handles.
  fill.setColor(ck.WHITE);
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
    const r = ck.XYWHRect(Math.round(hx - HANDLE / 2) + 0.5, Math.round(hy - HANDLE / 2) + 0.5, HANDLE - 1, HANDLE - 1);
    canvas.drawRect(r, fill);
    canvas.drawRect(r, stroke);
  }
  // Size pill, centred below.
  const label = uiText(`${Math.round(b.w)} × ${Math.round(b.h)}`, 12, "#ffffff");
  label.layout(10000);
  const tw = Math.ceil(label.getMaxIntrinsicWidth());
  const pw = tw + 12;
  const px = Math.round(x + w / 2 - pw / 2);
  const py = Math.round(y + h + PILL_GAP);
  fill.setColor(ck.parseColorString(SELECT));
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(px, py, pw, PILL_H), 4, 4), fill);
  canvas.drawParagraph(label, px + 6, py + (PILL_H - label.getHeight()) / 2);
  // A selected top-level frame shows a small badge outside its top-right corner.
  if (tree.children.some((f) => f.id === id)) {
    const bx = Math.round(x + w + 7);
    const by = Math.round(y + 7);
    canvas.drawRRect(ck.RRectXY(ck.XYWHRect(bx, by, BADGE, BADGE), 4, 4), fill);
    const star = new ck.Paint();
    star.setColor(ck.WHITE);
    star.setStyle(ck.PaintStyle.Stroke);
    star.setStrokeWidth(1.5);
    star.setAntiAlias(true);
    const cx = bx + BADGE / 2;
    const cy = by + BADGE / 2;
    for (const a of [0, 60, 120]) {
      const r = (a * Math.PI) / 180;
      canvas.drawLine(cx - Math.sin(r) * 4, cy - Math.cos(r) * 4, cx + Math.sin(r) * 4, cy + Math.cos(r) * 4, star);
    }
    star.delete();
  }
  fill.delete();
  stroke.delete();
}

function drawCursor(canvas: Canvas) {
  const { ck } = engine;
  const alpha = Math.min(1, (performance.now() - cursor.since) / 200);
  const [x, y] = toScreen(cursor.x, cursor.y);
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.Color4f(0.66, 0.33, 0.97, alpha));
  const path = new ck.PathBuilder().addPolygon([x, y, x + 4, y + 16, x + 7.5, y + 9.5, x + 14, y + 7], true).detachAndDelete();
  canvas.drawPath(path, paint);
  path.delete();
  const label = uiText(cursor.name, 11, "#ffffff", 600);
  label.layout(200);
  const w = Math.ceil(label.getMaxIntrinsicWidth()) + 10;
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + 12, y + 14, w, 17), 3, 3), paint);
  canvas.drawParagraph(label, x + 17, y + 15);
  paint.delete();
}

// ---- Input ----------------------------------------------------------------------------------------
export function attach(canvasEl: HTMLCanvasElement): () => void {
  el = canvasEl;
  makeSurface();
  const onResize = () => (makeSurface(), schedule());
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { wheelZooms, invertZoom } = getSettings();
    // Ctrl/⌘ + wheel always zooms; the plain wheel zooms only when that setting is on.
    if (e.ctrlKey || e.metaKey || wheelZooms) {
      const dy = invertZoom ? -e.deltaY : e.deltaY;
      setZoom(view.zoom * Math.exp(-dy * 0.01), e.offsetX, e.offsetY);
    }
    else {
      view.x += (e.shiftKey ? e.deltaY : e.deltaX) / view.zoom;
      view.y += (e.shiftKey ? 0 : e.deltaY) / view.zoom;
      schedule();
    }
  };
  const onMove = (e: PointerEvent) => {
    const [px, py] = toPage(e.offsetX, e.offsetY);
    const hover = hitTest(px, py);
    if (hover !== store.get().hover) {
      store.set({ hover });
      schedule();
    }
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    const [px, py] = toPage(e.offsetX, e.offsetY);
    store.set({ selection: hitTest(px, py) });
    schedule();
  };
  const onLeave = () => {
    store.set({ hover: null });
    schedule();
  };
  addEventListener("resize", onResize);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerleave", onLeave);
  const unsub = store.subscribe(schedule);
  schedule();
  return () => {
    unsub();
    removeEventListener("resize", onResize);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointerleave", onLeave);
  };
}

/** Sets the view directly (headless checks reproduce a capture's view this way). */
export function setView(x: number, y: number, zoom: number): void {
  fitted = true;
  Object.assign(view, { x, y, zoom });
  store.set({ zoom });
  schedule();
}
