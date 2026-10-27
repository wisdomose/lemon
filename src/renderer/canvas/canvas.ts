// The design canvas: draws the document with CanvasKit, plus the editor's overlays (frame names,
// hover and selection outlines, size pill, agent cursor), and handles panning, zooming and selecting.
import type { Canvas, SkPicture, Surface } from "canvaskit-wasm";
import { drawNode } from "../../render/draw.js";
import { ICON_GRID, ICON_LINE, iconPath } from "../../render/icons.js";
import type { TreeNode } from "../../doc/schema.js";
import type { Box } from "../../layout/layout.js";
import { CANVAS_UI_FONT, assets, bridge, currentScene, engine, type Scene } from "../scene.js";
import { pageImage, pagesVersion, startLivePages } from "./live-pages.js";
import { scriptOutput } from "../scripts.js";
import { store } from "../store.js";
import { overlay } from "./overlay.js";
import { index, unionBox } from "./pick.js";
import { COPY_COLOUR, MAIN_COLOUR, kindOf } from "../components.js";
import { findNode } from "../../render/screenshot.js";
import { drawTextEditing } from "./text-edit.js";
import { colorOf } from "../../doc/values.js";
import { getSettings } from "../settings.js";

// Overlay look, measured from the reference captures.
const SELECT = "#3d99ff";
/** A selected script's outline and size pill (measured from Pen). */
const SCRIPT_GREEN = "#00C787";
/** Frame names use the theme's muted text colour. */
const label = () => getComputedStyle(document.documentElement).getPropertyValue("--muted-foreground").trim() || "#a1a1aa";
const LABEL_SIZE = 12;
/** A frame label's top above the frame (measured from Pen at its corner). */
const LABEL_LIFT = LABEL_SIZE + 10;
const HANDLE = 8;
const PILL_H = 20;
const PILL_GAP = 6;
const BADGE = 16;
const RADIUS_HANDLE = 8;
const RADIUS_INSET = 12;
/** Snapping guides (capture 35) and the selection box's tint (capture 37). */
const GUIDE = "#f24822";
const MARQUEE_RGB = [61 / 255, 153 / 255, 255 / 255] as const;
/** A frame an agent is building: outline, tint and "Generating" label (measured from captures 22a and 23). */
const LIVE = "#607dff";
const LIVE_RGB = [96 / 255, 125 / 255, 255 / 255] as const;
/** The tint's strength at the bottom of the frame; it fades to nothing at the top. */
const LIVE_TINT = 0.36;
// The agent cursor moves like a hand: it glides to a spot, rests there a moment, and if the agent has
// moved on meanwhile goes straight to the newest spot rather than visiting each one in turn.
/** How long the cursor takes to glide to a new spot, and to draw across a box it just made. */
const GLIDE_MS = 450;
const DRAW_MS = 380;
/** How long it rests on a spot before moving on (and between the steps of drawing a box). */
const REST_MS = 280;
const DRAW_PAUSE_MS = 60;

/** Zoom steps for the zoom buttons and Ctrl +/−. */
export const ZOOM_PRESETS = [0.02, 0.03, 0.05, 0.08, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** Page coordinates at the canvas's top-left corner, and the zoom. */
export const view = { x: 0, y: 0, zoom: 1 };
type Point = { x: number; y: number };
/**
 * An agent's cursor (page coordinates): gliding from `from` to `to` over `ms` from `movedAt`, then the
 * rest of its path (`path`); `next` is the newest spot it was sent to while busy. One per agent, by
 * its place in the team (0 when one agent works alone).
 */
interface Cursor {
  name: string;
  color: string;
  since: number;
  from: Point;
  to: Point;
  movedAt: number;
  ms: number;
  path: Point[];
  next: Point[] | undefined;
}
const cursors = new Map<number, Cursor>();

/** Starts the next leg once the cursor has arrived and rested: the rest of a box being drawn, or a new spot. */
function advance(c: Cursor, now: number): void {
  const rest = c.path.length ? DRAW_PAUSE_MS : REST_MS;
  if (now < c.movedAt + c.ms + rest) return;
  let ms = DRAW_MS;
  if (!c.path.length) {
    if (!c.next) return;
    c.path = c.next;
    c.next = undefined;
    ms = GLIDE_MS;
  }
  Object.assign(c, { from: c.to, to: c.path.shift()!, movedAt: now, ms });
}

function cursorAt(c: Cursor, now: number): Point {
  advance(c, now);
  const k = c.ms ? Math.min(1, (now - c.movedAt) / c.ms) : 1;
  const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
  return { x: c.from.x + (c.to.x - c.from.x) * e, y: c.from.y + (c.to.y - c.from.y) * e };
}

/**
 * Sends an agent's cursor along a path of page points (one spot, or a box's corners to draw it): it
 * fades in at the start the first time; while busy, the newest path waits and replaces older ones.
 */
export function moveCursor(path: Point[], who: { agent: number; name: string; color: string }): void {
  if (!path.length) return;
  const now = performance.now();
  const c = cursors.get(who.agent);
  if (!c) {
    cursors.set(who.agent, { name: who.name, color: who.color, since: now, from: path[0]!, to: path[0]!, movedAt: now, ms: 0, path: path.slice(1), next: undefined });
  } else c.next = path;
  schedule();
}

/** Hides one agent's cursor, or every cursor. */
export function hideCursor(agent?: number): void {
  if (agent === undefined) cursors.clear();
  else cursors.delete(agent);
  schedule();
}

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

export const toScreen = (px: number, py: number) => [(px - view.x) * view.zoom, (py - view.y) * view.zoom] as const;
export const toPage = (sx: number, sy: number) => [view.x + sx / view.zoom, view.y + sy / view.zoom] as const;

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
/** The top-level frame whose name label is at page (x, y): clicking a label selects its frame. */
export function labelAt(x: number, y: number): string | null {
  const s = currentScene();
  if (!s) return null;
  for (const f of [...s.tree.children].reverse()) {
    const b = s.boxes.get(f.id);
    if (b && labelHit(f, b, x, y)) return f.id;
  }
  return null;
}

export function labelHit(f: TreeNode, b: Box, x: number, y: number): boolean {
  if (!hasLabel(f)) return false;
  const [sx, sy] = toScreen(b.x, b.y);
  const [px, py] = toScreen(x, y);
  const w = labelWidth(f, b);
  return px >= sx && px <= sx + w && py >= sy - LABEL_LIFT - 2 && py <= sy - 2;
}

// ---- Drawing --------------------------------------------------------------------------------------
/** Every node of a scene by id (built once per scene). */
const indexes = new WeakMap<Scene, Map<string, TreeNode>>();
function nodeIn(s: Scene, id: string): TreeNode | undefined {
  let byId = indexes.get(s);
  if (!byId) indexes.set(s, (byId = index(s.tree)));
  return byId.get(id);
}

/** The outline colour for nodes: magenta for a main component, violet (dashed for the copy itself) inside a copy. */
function accent(s: Scene, ids: string[]): { color: string; dashed: boolean } {
  // Scripts are outlined in their own green (as in Pen).
  if (ids.length && ids.every((id) => nodeIn(s, id)?.type === "script")) return { color: SCRIPT_GREEN, dashed: false };
  const kinds = new Set(ids.map((id) => kindOf(nodeIn(s, id))));
  if (kinds.size !== 1) return { color: SELECT, dashed: false };
  const [k] = kinds;
  if (k === "main") return { color: MAIN_COLOUR, dashed: false };
  if (k === "instance" || k === "part") return { color: COPY_COLOUR, dashed: k === "instance" };
  return { color: SELECT, dashed: false };
}

function uiText(text: string, size: number, color: string, weight = 400) {
  return engine.text.paragraph({ content: text, fontFamily: CANVAS_UI_FONT, fontSize: size, fontWeight: String(weight), fill: color, lineHeight: 1.2 }, {});
}
/**
 * As in Pen, only top-level frames are labelled: by name, a component or a copy of one after its icon
 * (the icon alone when it has no name), and a plain frame without a name not at all. A placeholder an
 * agent builds reads "Generating: <name>" after a sparkle.
 */
function hasLabel(f: TreeNode): boolean {
  if (f.type !== "frame") return false;
  return !!(f.props.placeholder || f.props.name || f.instance || f.props.reusable);
}
const labelText = (f: TreeNode) => (f.props.placeholder ? `Generating: ${f.props.name ?? "Frame"}` : (f.props.name ?? ""));
/** The space before the text taken by the sparkle, or a component's or copy's icon (12px, then 7px; measured in Pen). */
const SPARKLE_W = 17;
const KIND_ICON = 12;
const KIND_W = 19;
const leadOf = (f: TreeNode) => (f.props.placeholder ? SPARKLE_W : f.instance || f.props.reusable ? KIND_W : 0);
/** The narrowest a label gets on a small frame: room for a letter or two and "…" (as Pen's "La…"). */
const LABEL_MIN_W = 24;

/** A frame's label as drawn: one line, cut with "…" to the frame's width on screen (as in Pen). */
function labelParagraph(f: TreeNode, b: Box, color: string) {
  const room = b.w * view.zoom - leadOf(f);
  return fitLabel(labelText(f), color, Math.max(LABEL_MIN_W, room));
}

function labelWidth(f: TreeNode, b: Box) {
  const text = labelText(f) ? labelParagraph(f, b, label()).getMaxIntrinsicWidth() : 0;
  return leadOf(f) + text || KIND_ICON;
}

/** `text` cut with "…" to fit `max` pixels (paragraphs are cached by the text engine; never deleted here). */
function fitLabel(text: string, color: string, max: number) {
  let p = uiText(text, LABEL_SIZE, color);
  p.layout(10000);
  if (p.getMaxIntrinsicWidth() <= max) return p;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    p = uiText(text.slice(0, mid).trimEnd() + "…", LABEL_SIZE, color);
    p.layout(10000);
    if (p.getMaxIntrinsicWidth() <= max) lo = mid;
    else hi = mid - 1;
  }
  p = uiText(text.slice(0, lo).trimEnd() + "…", LABEL_SIZE, color);
  p.layout(10000);
  return p;
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
    canvas.drawPicture(documentPicture(s));
    canvas.restore();
    for (const frame of s.tree.children) {
      if (frame.props.placeholder) drawGenerating(canvas, s.boxes.get(frame.id));
    }
    for (const frame of s.tree.children) {
      if (hasLabel(frame)) drawLabel(canvas, frame, s.boxes.get(frame.id), st.selection.includes(frame.id) || st.hover === frame.id);
    }
    if (st.hover && !st.selection.includes(st.hover) && !overlay.moving) outline(canvas, s.boxes.get(st.hover), accent(s, [st.hover]));
    drawSelection(canvas, s, st.selection);
    drawOverlay(canvas, s);
    for (const c of cursors.values()) drawCursor(canvas, c);
    canvas.restore();
  }
  surface.flush();
  // The cursor wobbles while shown and the "Generating" sheen moves: keep drawing (the document
  // itself is a recorded picture, so a frame costs little).
  if (cursors.size || overlay.editing || s?.tree.children.some((f) => f.props.placeholder)) schedule();
}

/** The document drawn once per change and replayed for every frame of animation. */
let recorded: { scene: Scene; pages: number; picture: SkPicture } | undefined;
function documentPicture(s: Scene): SkPicture {
  // Drawn again when the document or a live page changes.
  if (recorded?.scene === s && recorded.pages === pagesVersion) return recorded.picture;
  const { ck } = engine;
  const recorder = new ck.PictureRecorder();
  const c = recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7));
  for (const frame of s.tree.children) drawNode({ ck, text: engine.text, vars: s.vars, boxes: s.boxes, assets, pages: pageImage, scripts: scriptOutput }, c, frame);
  const picture = recorder.finishRecordingAsPicture();
  recorder.delete();
  recorded?.picture.delete();
  recorded = { scene: s, pages: pagesVersion, picture };
  return picture;
}

/** A frame an agent is building: a blue-violet tint growing towards the bottom, a slow sheen, a blue outline. */
function drawGenerating(canvas: Canvas, b: Box | undefined) {
  if (!b) return;
  const { ck } = engine;
  const [x, y] = toScreen(b.x, b.y);
  const w = b.w * view.zoom;
  const h = b.h * view.zoom;
  const rect = ck.XYWHRect(x, y, w, h);
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  const tint = ck.Shader.MakeLinearGradient([x, y], [x, y + h], [ck.Color4f(...LIVE_RGB, 0), ck.Color4f(...LIVE_RGB, LIVE_TINT)], null, ck.TileMode.Clamp);
  paint.setShader(tint);
  canvas.drawRect(rect, paint);
  tint.delete();
  // The sheen: a soft light band crossing the frame diagonally every couple of seconds.
  const span = w + h;
  const at = x - h + ((performance.now() / 2400) % 1) * (span + h);
  const sheen = ck.Shader.MakeLinearGradient(
    [at, y],
    [at + h * 0.6, y + h * 0.6],
    [ck.Color4f(1, 1, 1, 0), ck.Color4f(1, 1, 1, 0.12), ck.Color4f(1, 1, 1, 0)],
    [0, 0.5, 1],
    ck.TileMode.Decal,
  );
  canvas.save();
  canvas.clipRect(rect, ck.ClipOp.Intersect, true);
  paint.setShader(sheen);
  canvas.drawRect(rect, paint);
  canvas.restore();
  sheen.delete();
  paint.setShader(null);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(2);
  paint.setColor(ck.parseColorString(LIVE));
  canvas.drawRect(ck.XYWHRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(w) + 2, Math.round(h) + 2), paint);
  paint.delete();
}

/** A frame's label above its top-left corner: blue while it is selected or pointed at, a component's or copy's in its own colour. */
function drawLabel(canvas: Canvas, f: TreeNode, b: Box | undefined, lit: boolean) {
  if (!b) return;
  const [x, y] = toScreen(b.x, b.y);
  if (f.props.placeholder) {
    drawSparkle(canvas, x + 6, y - LABEL_SIZE / 2 - 9);
    canvas.drawParagraph(labelParagraph(f, b, LIVE), x + SPARKLE_W, y - LABEL_SIZE - 8);
    return;
  }
  const kind = kindOf(f);
  const colour = kind === "main" ? MAIN_COLOUR : kind === "instance" ? COPY_COLOUR : lit ? SELECT : label();
  if (kind === "main" || kind === "instance") drawKindIcon(canvas, kind === "main" ? "component" : "diamond", colour, x, y - LABEL_LIFT + LABEL_SIZE / 2);
  if (labelText(f)) canvas.drawParagraph(labelParagraph(f, b, colour), x + leadOf(f), y - LABEL_LIFT);
}

/** A component's icon (four diamonds) or a copy's (one diamond): the shape 12px across, its left edge at x, centred on cy. */
function drawKindIcon(canvas: Canvas, name: string, colour: string, x: number, cy: number) {
  const { ck } = engine;
  const path = iconPath(ck, name);
  if (!path) return;
  // Lucide's shapes leave 2 of their 24 units clear on each side.
  const box = (KIND_ICON * ICON_GRID) / (ICON_GRID - 4);
  const k = box / ICON_GRID;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(ICON_LINE);
  paint.setStrokeCap(ck.StrokeCap.Round);
  paint.setStrokeJoin(ck.StrokeJoin.Round);
  paint.setColor(ck.parseColorString(colour));
  canvas.save();
  canvas.translate(x + 2 - 2 * k, cy - box / 2 + 2);
  canvas.scale(k, k);
  canvas.drawPath(path, paint);
  canvas.restore();
  paint.delete();
}

/** The sparkle before "Generating": a four-point star with a small one above it. */
function drawSparkle(canvas: Canvas, cx: number, cy: number) {
  const { ck } = engine;
  const star = (x: number, y: number, r: number) => {
    const k = r * 0.28;
    return [x, y - r, x + k, y - k, x + r, y, x + k, y + k, x, y + r, x - k, y + k, x - r, y, x - k, y - k];
  };
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.parseColorString(LIVE));
  for (const pts of [star(cx, cy + 1, 5), star(cx + 5, cy - 4, 2.5)]) {
    const path = new ck.PathBuilder().addPolygon(pts, true).detachAndDelete();
    canvas.drawPath(path, paint);
    path.delete();
  }
  paint.delete();
}

function outline(canvas: Canvas, b: Box | undefined, look: { color: string; dashed: boolean } = { color: SELECT, dashed: false }) {
  if (!b) return;
  const { ck } = engine;
  const [x, y] = toScreen(b.x, b.y);
  const paint = new ck.Paint();
  paint.setColor(ck.parseColorString(look.color));
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  // A copy's dashes: 4 on, 3 off (capture 39).
  const dash = look.dashed ? ck.PathEffect.MakeDash([4, 3], 0) : null;
  if (dash) paint.setPathEffect(dash);
  canvas.drawRect(ck.XYWHRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(b.w * view.zoom), Math.round(b.h * view.zoom)), paint);
  dash?.delete();
  paint.delete();
}

/**
 * The selection: each selected node outlined, and around them all (or the one node) corner handles,
 * the size pill and, for a top-level frame, the badge. A rectangle also gets its corner-radius handles.
 */
function drawSelection(canvas: Canvas, s: Scene, ids: string[]) {
  const b = unionBox(s.boxes, ids);
  if (!b) return;
  const { ck } = engine;
  // While moving, Pen shows the moved nodes bare (capture 35).
  if (overlay.moving) return;
  const look = accent(s, ids);
  if (ids.length > 1) for (const id of ids) outline(canvas, s.boxes.get(id), accent(s, [id]));
  outline(canvas, b, look);
  if (overlay.editing) return;
  const tree = s.tree;
  const id = ids.length === 1 ? ids[0]! : undefined;
  const [x, y] = toScreen(b.x, b.y);
  const w = b.w * view.zoom;
  const h = b.h * view.zoom;
  const fill = new ck.Paint();
  fill.setAntiAlias(true);
  const stroke = new ck.Paint();
  stroke.setStyle(ck.PaintStyle.Stroke);
  stroke.setStrokeWidth(1);
  stroke.setColor(ck.parseColorString(look.color));
  // Corner handles, and a rectangle's corner-radius handles inside them.
  fill.setColor(ck.WHITE);
  if (!overlay.resizing) {
    for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
      const r = ck.XYWHRect(Math.round(hx - HANDLE / 2) + 0.5, Math.round(hy - HANDLE / 2) + 0.5, HANDLE - 1, HANDLE - 1);
      canvas.drawRect(r, fill);
      canvas.drawRect(r, stroke);
    }
    const node = id ? findNode(tree, id) : undefined;
    if (node?.type === "rectangle" || node?.type === "frame") {
      for (const [hx, hy] of radiusHandles({ x, y, w, h })) {
        canvas.drawCircle(hx, hy, RADIUS_HANDLE / 2, fill);
        canvas.drawCircle(hx, hy, RADIUS_HANDLE / 2, stroke);
      }
    }
  }

  drawPill(canvas, b, look.color);
  fill.setColor(ck.parseColorString(look.color));
  // A selected top-level frame shows a small badge outside its top-right corner.
  if (id && !overlay.resizing && tree.children.some((f) => f.id === id)) {
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

/** The size pill ("764 × 270"), centred below a box (page coordinates). */
function drawPill(canvas: Canvas, b: Box, color = SELECT) {
  const { ck } = engine;
  const [x, y] = toScreen(b.x, b.y);
  const label = uiText(`${Math.round(b.w)} × ${Math.round(b.h)}`, 12, "#ffffff");
  label.layout(10000);
  const pw = Math.ceil(label.getMaxIntrinsicWidth()) + 12;
  const px = Math.round(x + (b.w * view.zoom) / 2 - pw / 2);
  const py = Math.round(y + b.h * view.zoom + PILL_GAP);
  const fill = new ck.Paint();
  fill.setAntiAlias(true);
  fill.setColor(ck.parseColorString(color));
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(px, py, pw, PILL_H), 4, 4), fill);
  canvas.drawParagraph(label, px + 6, py + (PILL_H - label.getHeight()) / 2);
  fill.delete();
}

/** Where a rectangle's corner-radius handles sit (screen coordinates), when it is big enough to show them. */
export function radiusHandles(r: Box): [number, number][] {
  const inset = RADIUS_INSET;
  if (r.w < inset * 4 || r.h < inset * 4) return [];
  return [[r.x + inset, r.y + inset], [r.x + r.w - inset, r.y + inset], [r.x + inset, r.y + r.h - inset], [r.x + r.w - inset, r.y + r.h - inset]];
}

/** The selection box, snapping guides, drop line, dragged outlines and the shape being drawn. */
function drawOverlay(canvas: Canvas, s: Scene) {
  const { ck } = engine;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  const rect = (b: Box) => {
    const [x, y] = toScreen(b.x, b.y);
    return ck.XYWHRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(b.w * view.zoom), Math.round(b.h * view.zoom));
  };
  if (overlay.marquee) {
    paint.setColor(ck.Color4f(...MARQUEE_RGB, 0.12));
    canvas.drawRect(rect(overlay.marquee), paint);
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setColor(ck.parseColorString(SELECT));
    canvas.drawRect(rect(overlay.marquee), paint);
    paint.setStyle(ck.PaintStyle.Fill);
  }
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  paint.setColor(ck.parseColorString(SELECT));
  for (const g of overlay.ghosts) canvas.drawRect(rect(g), paint);
  if (overlay.draft) canvas.drawRect(rect(overlay.draft), paint);
  if (overlay.drop) {
    paint.setStrokeWidth(2);
    const [x1, y1] = toScreen(overlay.drop.x1, overlay.drop.y1);
    const [x2, y2] = toScreen(overlay.drop.x2, overlay.drop.y2);
    canvas.drawLine(x1, y1, x2, y2, paint);
  }
  // Snapping guides: red lines with a small cross at each end (capture 35).
  paint.setStrokeWidth(1);
  paint.setColor(ck.parseColorString(GUIDE));
  for (const g of overlay.guides) {
    const [x1, y1] = toScreen(g.x1, g.y1);
    const [x2, y2] = toScreen(g.x2, g.y2);
    const [ax, ay, bx, by] = [Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2) + 0.5, Math.round(y2) + 0.5];
    canvas.drawLine(ax, ay, bx, by, paint);
    for (const [cx, cy] of [[ax, ay], [bx, by]]) {
      canvas.drawLine(cx! - 2, cy! - 2, cx! + 2, cy! + 2, paint);
      canvas.drawLine(cx! - 2, cy! + 2, cx! + 2, cy! - 2, paint);
    }
  }
  if (overlay.draft) drawPill(canvas, overlay.draft);
  // A browser page in use: a green outline with a soft glow (as in Pen).
  const live = store.get().browserLive;
  const liveBox = live ? s.boxes.get(live) : undefined;
  if (liveBox) {
    const [x, y] = toScreen(liveBox.x, liveBox.y);
    const r = ck.XYWHRect(x, y, liveBox.w * view.zoom, liveBox.h * view.zoom);
    const rr = ck.RRectXY(r, 16 * view.zoom, 16 * view.zoom);
    paint.setStyle(ck.PaintStyle.Stroke);
    const glow = ck.MaskFilter.MakeBlur(ck.BlurStyle.Outer, 8, true);
    paint.setMaskFilter(glow);
    paint.setStrokeWidth(4);
    paint.setColor(ck.Color4f(0, 199 / 255, 135 / 255, 0.35));
    canvas.drawRRect(rr, paint);
    paint.setMaskFilter(null);
    glow.delete();
    paint.setStrokeWidth(1.5);
    paint.setColor(ck.parseColorString(SCRIPT_GREEN));
    canvas.drawRRect(rr, paint);
  }
  // The path being drawn with the pen: its segments, a line on to the pointer, and its points.
  if (overlay.pen) {
    const pts = overlay.pen.points;
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(1);
    paint.setColor(ck.parseColorString(SELECT));
    const at = (q: { x: number; y: number }) => toScreen(q.x, q.y);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      const b0 = new ck.PathBuilder();
      b0.moveTo(...at(a)).cubicTo(...at(a.out ?? a), ...at(b.in ?? b), ...at(b));
      const seg = b0.detachAndDelete();
      canvas.drawPath(seg, paint);
      seg.delete();
    }
    const last = pts.at(-1);
    if (last && overlay.pen.cursor) {
      // On to the pointer: curving away along the last point's handle, if it has one.
      const b1 = new ck.PathBuilder();
      b1.moveTo(...at(last)).cubicTo(...at(last.out ?? last), ...at(overlay.pen.cursor), ...at(overlay.pen.cursor));
      const next = b1.detachAndDelete();
      canvas.drawPath(next, paint);
      next.delete();
    }
    // The last point's handles: lines out to small diamonds.
    if (last?.in && last.out) {
      for (const h of [last.in, last.out]) {
        canvas.drawLine(...at(last), ...at(h), paint);
        const [hx, hy] = at(h);
        const d = new ck.PathBuilder();
        d.moveTo(hx, hy - 3.5).lineTo(hx + 3.5, hy).lineTo(hx, hy + 3.5).lineTo(hx - 3.5, hy).close();
        const diamond = d.detachAndDelete();
        paint.setStyle(ck.PaintStyle.Fill);
        paint.setColor(ck.parseColorString("#ffffff"));
        canvas.drawPath(diamond, paint);
        paint.setStyle(ck.PaintStyle.Stroke);
        paint.setColor(ck.parseColorString(SELECT));
        canvas.drawPath(diamond, paint);
        diamond.delete();
      }
    }
    for (const q of pts) {
      const [x, y] = at(q);
      paint.setStyle(ck.PaintStyle.Fill);
      paint.setColor(ck.parseColorString("#ffffff"));
      canvas.drawCircle(x, y, 3.5, paint);
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setColor(ck.parseColorString(SELECT));
      canvas.drawCircle(x, y, 3.5, paint);
    }
  }
  paint.delete();
  if (overlay.editing) drawTextEditing(canvas, s);
}

function drawCursor(canvas: Canvas, c: Cursor) {
  const { ck } = engine;
  const now = performance.now();
  const alpha = Math.min(1, (now - c.since) / 200);
  const at = cursorAt(c, now);
  // At rest it wobbles by a pixel or two, as Pen's does (each agent's a little out of step).
  const [sx, sy] = toScreen(at.x, at.y);
  const x = sx + Math.sin(now / 650 + c.since) * 1.5;
  const y = sy + Math.sin(now / 830 + 1 + c.since) * 1.5;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  const [r, g, b] = colorOf(c.color, {});
  paint.setColor(ck.Color4f(r, g, b, alpha));
  const path = new ck.PathBuilder().addPolygon([x, y, x + 4, y + 16, x + 7.5, y + 9.5, x + 14, y + 7], true).detachAndDelete();
  canvas.drawPath(path, paint);
  path.delete();
  const label = uiText(c.name, 11, "#ffffff", 600);
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
  startLivePages(schedule);
  const onResize = () => (makeSurface(), schedule());
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Over a page in use, the wheel scrolls the page.
    const live = store.get().browserLive;
    const box = live ? currentScene()?.boxes.get(live) : undefined;
    if (live && box && !e.ctrlKey && !e.metaKey) {
      const [px, py] = toPage(e.offsetX, e.offsetY);
      if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        bridge.browser.input(live, { type: "mouseWheel", x: Math.round(px - box.x), y: Math.round(py - box.y), deltaX: -e.deltaX, deltaY: -e.deltaY });
        return;
      }
    }
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
  addEventListener("resize", onResize);
  el.addEventListener("wheel", onWheel, { passive: false });
  const unsub = store.subscribe(schedule);
  schedule();
  return () => {
    unsub();
    removeEventListener("resize", onResize);
    el.removeEventListener("wheel", onWheel);
  };
}

/** Sets the view directly (headless checks reproduce a capture's view this way). */
export function setView(x: number, y: number, zoom: number): void {
  fitted = true;
  Object.assign(view, { x, y, zoom });
  store.set({ zoom });
  schedule();
}
