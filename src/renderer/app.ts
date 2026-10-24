// The window: a full-window canvas showing the document live, with the agent panel floating over it.
import * as Y from "yjs";
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import type { Surface } from "canvaskit-wasm";
import { PRODUCT } from "../product.js";
import { createEngine } from "../engine.js";
import { getVars, toTree } from "../doc/store.js";
import { layout, type Boxes } from "../layout/layout.js";
import { drawNode } from "../render/draw.js";
import { DEFAULT_FONT, FontsNeeded } from "../text/fonts.js";
import type { TreeNode, Vars } from "../doc/schema.js";
import type { AgentEvent } from "../agent/agent.js";
import { AGENT_NAME, DEFAULT_MODEL, modelLabel } from "../agent/models.js";
import { browserBridge } from "./bridge.js";
import { markdown } from "./markdown.js";

const bridge = window.lemon ?? browserBridge();
document.title = PRODUCT.name;
document.querySelector(".brand")!.textContent = PRODUCT.name;
document.querySelector("#model")!.textContent = modelLabel(DEFAULT_MODEL);

const catalogue = await bridge.fontCatalogue();
const engine = await createEngine(
  { styles: (family) => catalogue[family], load: (face) => bridge.loadFont(face) },
  () => wasmUrl,
);
const { ck } = engine;
// Fonts the window's own drawing uses (frame names, the agent's cursor label).
await engine.fonts.ensure([
  { family: DEFAULT_FONT, weight: 400, italic: false },
  { family: DEFAULT_FONT, weight: 600, italic: false },
]);

// ---- Document mirror -------------------------------------------------------------------------------
const doc = new Y.Doc();
Y.applyUpdate(doc, await bridge.docState());
bridge.onDocUpdate((u) => Y.applyUpdate(doc, u));
doc.on("update", () => invalidate());

let scene: { tree: TreeNode; boxes: Boxes; vars: Vars } | undefined;
let stale = true;
let loadingFonts = false;
function invalidate() {
  stale = true;
  schedule();
}
function current() {
  if (!stale) return scene;
  const tree = toTree(doc);
  const vars = getVars(doc);
  try {
    scene = { tree, vars, boxes: layout(tree, vars, engine.text) };
    stale = false;
  } catch (e) {
    if (!(e instanceof FontsNeeded)) throw e;
    if (!loadingFonts) {
      loadingFonts = true;
      engine.fonts.ensure(e.faces).finally(() => {
        loadingFonts = false;
        invalidate();
      });
    }
  }
  return scene; // the previous picture until the fonts arrive
}

// ---- View: page coordinates at the window's top-left, and zoom ---------------------------------------
const PRESETS = [0.02, 0.03, 0.05, 0.08, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
const view = { x: -400, y: -100, zoom: 1 };
const PANEL_RIGHT = 384;
const zoomLabel = document.querySelector("#zoom-level")!;

function zoomAt(zoom: number, sx: number, sy: number) {
  zoom = Math.min(32, Math.max(0.02, zoom));
  // Keep the page point under the cursor where it is.
  const px = view.x + sx / view.zoom;
  const py = view.y + sy / view.zoom;
  view.zoom = zoom;
  view.x = px - sx / zoom;
  view.y = py - sy / zoom;
  schedule();
}
function step(dir: 1 | -1, sx = innerWidth / 2, sy = innerHeight / 2) {
  const next = dir > 0 ? PRESETS.find((p) => p > view.zoom + 1e-6) : [...PRESETS].reverse().find((p) => p < view.zoom - 1e-6);
  if (next) zoomAt(next, sx, sy);
}

let animation: number | undefined;
function zoomToFit(animate = true) {
  const s = current();
  if (!s || !s.tree.children.length) return;
  let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of s.tree.children) {
    const bx = s.boxes.get(f.id);
    if (!bx) continue;
    l = Math.min(l, bx.x);
    t = Math.min(t, bx.y);
    r = Math.max(r, bx.x + bx.w);
    b = Math.max(b, bx.y + bx.h);
  }
  const pad = 64;
  const availW = innerWidth - PANEL_RIGHT - pad * 2;
  const availH = innerHeight - pad * 2;
  const zoom = Math.min(1, availW / (r - l), availH / (b - t));
  const target = {
    zoom,
    x: l - (PANEL_RIGHT + pad + (availW - (r - l) * zoom) / 2) / zoom,
    y: t - (pad + (availH - (b - t) * zoom) / 2) / zoom,
  };
  if (!animate) return Object.assign(view, target), schedule();
  const from = { ...view };
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / 300);
    const e = 1 - (1 - k) ** 3; // ease out
    view.zoom = from.zoom + (target.zoom - from.zoom) * e;
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    schedule();
    animation = k < 1 ? requestAnimationFrame(tick) : undefined;
  };
  if (animation) cancelAnimationFrame(animation);
  animation = requestAnimationFrame(tick);
}

const el = document.querySelector<HTMLCanvasElement>("#canvas")!;
el.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(view.zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else {
      view.x += e.deltaX / view.zoom;
      view.y += e.deltaY / view.zoom;
      schedule();
    }
  },
  { passive: false },
);
document.querySelectorAll<HTMLButtonElement>("#zoom button").forEach((b) =>
  b.addEventListener("click", () => step(Number(b.dataset.zoom) as 1 | -1)),
);
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
  if (e.shiftKey && e.key === "!") zoomToFit();
  else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) (e.preventDefault(), step(1));
  else if ((e.ctrlKey || e.metaKey) && e.key === "-") (e.preventDefault(), step(-1));
});

// ---- Drawing --------------------------------------------------------------------------------------
let surface: Surface | null = null;
function makeSurface() {
  const dpr = devicePixelRatio || 1;
  el.width = Math.round(innerWidth * dpr);
  el.height = Math.round(innerHeight * dpr);
  surface?.delete();
  // WebGL when the machine has a GPU; CanvasKit's software surface otherwise.
  try {
    surface = ck.MakeWebGLCanvasSurface(el);
  } catch {
    surface = null;
  }
  surface ??= ck.MakeSWCanvasSurface(el);
}
addEventListener("resize", () => (makeSurface(), schedule()));
makeSurface();

const cursor = { name: AGENT_NAME, x: 0, y: 0, shown: false, since: 0 };
let queued = false;
let fitted = false; // fit the page to the window once it has first been laid out
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(draw);
}

function draw() {
  queued = false;
  if (!surface) return;
  const canvas = surface.getCanvas();
  const dpr = devicePixelRatio || 1;
  canvas.clear(ck.Color4f(0.118, 0.118, 0.118, 1));
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  const s = current();
  if (s && !fitted && s.tree.children.length) {
    fitted = true;
    zoomToFit(false);
  }
  if (s) {
    canvas.save();
    canvas.scale(dpr, dpr);
    canvas.save();
    canvas.scale(view.zoom, view.zoom);
    canvas.translate(-view.x, -view.y);
    for (const frame of s.tree.children) drawNode({ ck, text: engine.text, vars: s.vars, boxes: s.boxes }, canvas, frame);
    canvas.restore();
    // Frame names, at a constant size above each top-level frame.
    for (const frame of s.tree.children) {
      const b = s.boxes.get(frame.id);
      if (!b) continue;
      const para = engine.text.paragraph({ text: frame.props.name ?? "Frame", size: 11, color: "#9a9a9a" }, {});
      para.layout(Math.max(20, b.w * view.zoom));
      canvas.drawParagraph(para, (b.x - view.x) * view.zoom, (b.y - view.y) * view.zoom - 18);
    }
    if (cursor.shown) drawCursor(canvas);
    canvas.restore();
  }
  surface.flush();
  if (cursor.shown && performance.now() - cursor.since < 250) schedule(); // fade in
}

function drawCursor(canvas: ReturnType<Surface["getCanvas"]>) {
  const alpha = Math.min(1, (performance.now() - cursor.since) / 200);
  const x = (cursor.x - view.x) * view.zoom;
  const y = (cursor.y - view.y) * view.zoom;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.Color4f(0.66, 0.33, 0.97, alpha));
  const path = new ck.PathBuilder()
    .addPolygon([x, y, x + 4, y + 16, x + 7.5, y + 9.5, x + 14, y + 7], true)
    .detachAndDelete();
  canvas.drawPath(path, paint);
  path.delete();
  const label = engine.text.paragraph({ text: cursor.name, size: 11, weight: 600, color: "#ffffff" }, {});
  label.layout(200);
  const w = Math.ceil(label.getMaxIntrinsicWidth()) + 12;
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(x + 12, y + 14, w, 18), 4, 4), paint);
  canvas.drawParagraph(label, x + 18, y + 15);
  paint.delete();
}

// ---- Agent panel ----------------------------------------------------------------------------------
const chat = document.querySelector<HTMLDivElement>("#chat")!;
const form = document.querySelector<HTMLFormElement>("#prompt")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const add = (cls: string, text = "") => {
  const div = document.createElement("div");
  div.className = cls;
  div.textContent = text;
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
};
let status: HTMLDivElement | undefined;
const steps = new Map<number, HTMLDivElement>();

if (!bridge.canRunAgent) {
  send.disabled = true;
  add("status", "Viewing only: the agent runs in the desktop app.");
}

bridge.onAgentEvent((e: AgentEvent) => {
  switch (e.type) {
    case "started":
      add("agent-head").innerHTML = `<b>${cursor.name}</b> · ${modelLabel(DEFAULT_MODEL)}`;
      status = add("status", "Planning next moves…");
      break;
    case "step-start": {
      const card = add("step running");
      card.innerHTML = `<span class="state"></span><span class="title"></span><span class="meta"></span>`;
      card.querySelector(".title")!.textContent = e.title;
      steps.set(e.index, card);
      status?.remove();
      break;
    }
    case "step-end": {
      const card = steps.get(e.step.index);
      if (card) {
        card.className = `step ${e.step.ok ? "ok" : "failed"}`;
        card.querySelector(".meta")!.textContent = e.step.ok
          ? `${e.step.issues ? `${e.step.issues} to check · ` : ""}${Math.round(e.step.timings.totalMs)} ms`
          : "retrying";
      }
      if (e.focus) {
        if (!cursor.shown) cursor.since = performance.now();
        Object.assign(cursor, { x: e.focus.x, y: e.focus.y, shown: true });
      }
      if (e.step.index === 1 || e.step.index % 3 === 0) zoomToFit();
      status = add("status", "Planning next moves…");
      schedule();
      break;
    }
    case "text":
      break; // the final reply arrives with "done"
    case "done": {
      status?.remove();
      cursor.shown = false;
      add("msg-agent").innerHTML = markdown(e.stats.reply);
      const secs = Math.round(e.stats.durationMs / 1000);
      add("status", `Designed in ${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}`);
      send.disabled = false;
      zoomToFit();
      break;
    }
    case "error":
      add("status", `Error: ${e.message}`);
      break;
  }
});

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = (form.elements.namedItem("text") as HTMLTextAreaElement).value.trim();
  if (!text || !bridge.canRunAgent) return;
  add("msg-user", text);
  (form.elements.namedItem("text") as HTMLTextAreaElement).value = "";
  send.disabled = true;
  void bridge.runAgent(text);
});

schedule();
// Signals to headless checks that the first picture is on screen.
requestAnimationFrame(() => document.body.setAttribute("data-ready", "1"));
