// Typing into a text on the canvas (capture 40). The text is drawn by the canvas as always, so what
// the person sees while typing is exactly the design; a hidden textarea takes the keyboard (typing,
// IME composition, clipboard, word-by-word moves and its own undo while typing) and the canvas draws
// the caret and the selected range from it. Moving up, down, to a line's start or end follows the
// canvas's own line breaks, which the textarea doesn't know.
import type { Canvas, Paragraph } from "canvaskit-wasm";
import * as docStore from "../../doc/store.js";
import type { Box } from "../../layout/layout.js";
import { currentScene, doc, edit, engine, type Scene } from "../scene.js";
import { store } from "../store.js";
import { schedule, toScreen, view } from "./canvas.js";
import { overlay } from "./overlay.js";
import { colorOf, type RGBA } from "../../doc/values.js";
import { textColor } from "../../text/paragraph.js";
import { CARD, cardBody, isCard } from "../../render/draw.js";
import type { TreeNode } from "../../doc/schema.js";

type Point = { x: number; y: number };

const SELECT_RGB = [61 / 255, 153 / 255, 255 / 255] as const;
/** The caret blinks: shown for half a second, hidden for half a second. */
const BLINK_MS = 530;

let ta: HTMLTextAreaElement | null = null;

const editedText = () => (overlay.editing && docStore.exists(doc, overlay.editing.id) ? (docStore.propsOf(doc, overlay.editing.id).content ?? "") : "");

/** The text's paragraph laid out as the canvas draws it, and its box (page coordinates); a card's is its body. */
function laidOut(s: Scene, id: string): { para: Paragraph; box: Box } | undefined {
  const box = s.boxes.get(id);
  if (!box || !docStore.exists(doc, id)) return undefined;
  try {
    const type = docStore.typeOf(doc, id) ?? "text";
    if (isCard(type)) {
      const body = cardBody({ id, type, props: docStore.propsOf(doc, id), children: [] } as TreeNode, box);
      const para = engine.text.paragraph(body.props, s.vars);
      para.layout(body.box.w);
      return { para, box: body.box };
    }
    const props = docStore.propsOf(doc, id);
    const para = engine.text.paragraph(props, s.vars);
    para.layout((props.textGrowth ?? "auto") === "auto" ? 1e7 : Math.max(1, box.w));
    return { para, box };
  } catch {
    return undefined; // its font is still loading
  }
}

/** The character offset nearest to a page point inside the text. */
function offsetAt(s: Scene, id: string, at: Point): number {
  const l = laidOut(s, id);
  if (!l) return 0;
  return l.para.getGlyphPositionAtCoordinate(at.x - l.box.x, at.y - l.box.y).pos;
}

/** Where the caret for `offset` is drawn: its top, height and left (page coordinates). */
function caretAt(l: { para: Paragraph; box: Box }, text: string, offset: number): { x: number; y: number; h: number } {
  const { ck } = engine;
  const rect = (a: number, b: number) => l.para.getRectsForRange(a, b, ck.RectHeightStyle.Max, ck.RectWidthStyle.Tight)[0]?.rect;
  if (offset < text.length && text[offset] !== "\n") {
    const r = rect(offset, offset + 1);
    if (r) return { x: l.box.x + r[0]!, y: l.box.y + r[1]!, h: r[3]! - r[1]! };
  }
  if (offset > 0 && text[offset - 1] !== "\n") {
    const r = rect(offset - 1, offset);
    if (r) return { x: l.box.x + r[2]!, y: l.box.y + r[1]!, h: r[3]! - r[1]! };
  }
  // At the start of an empty line (or of an empty text): the line's own metrics.
  const lines = l.para.getLineMetrics();
  const line = lines.find((m) => m.startIndex === offset) ?? lines.at(-1);
  if (!line) return { x: l.box.x, y: l.box.y, h: l.box.h };
  return { x: l.box.x + line.left, y: l.box.y + line.baseline - line.ascent, h: line.ascent + line.descent };
}

/** Opens a text for typing, with the caret at `at` (a page point), or everything selected. */
export function startTextEdit(id: string, at?: Point): void {
  stopTextEdit();
  const s = currentScene();
  const text = docStore.propsOf(doc, id).content ?? "";
  const area = document.createElement("textarea");
  area.setAttribute("aria-label", "Text");
  area.spellcheck = false;
  // Invisible, but placed over the text so an input method's candidate window opens beside it.
  Object.assign(area.style, { position: "fixed", opacity: "0", width: "1px", height: "1em", padding: "0", border: "0", resize: "none", pointerEvents: "none", zIndex: "-1" });
  const box = s?.boxes.get(id);
  if (box) {
    const [sx, sy] = toScreen(box.x, box.y);
    Object.assign(area.style, { left: `${sx}px`, top: `${sy}px` });
  }
  area.value = text;
  document.body.append(area);
  ta = area;
  const caret = at && s ? offsetAt(s, id, at) : null;
  area.setSelectionRange(caret ?? 0, caret ?? text.length);
  overlay.editing = { id, start: area.selectionStart, end: area.selectionEnd, since: performance.now() };
  area.addEventListener("input", () => {
    const value = area.value;
    if (overlay.editing && docStore.exists(doc, overlay.editing.id)) edit(() => docStore.update(doc, overlay.editing!.id, { content: value }));
    sync();
  });
  area.addEventListener("keydown", onKey);
  area.addEventListener("keyup", sync);
  area.addEventListener("blur", () => setTimeout(() => ta === area && document.activeElement !== area && stopTextEdit(), 0));
  document.addEventListener("selectionchange", sync);
  area.focus();
  store.set({ selection: [id], hover: null });
  schedule();
}

/** Closes the text being typed into; an empty one is removed (as in Figma and Pen). */
export function stopTextEdit(): void {
  const editing = overlay.editing;
  if (!editing) return;
  overlay.editing = null;
  document.removeEventListener("selectionchange", sync);
  const area = ta;
  ta = null;
  area?.remove();
  // A card stays when empty (as in Pen); an empty text goes.
  if (docStore.exists(doc, editing.id) && !isCard(docStore.typeOf(doc, editing.id) ?? "") && !(docStore.propsOf(doc, editing.id).content ?? "").trim()) {
    edit(() => docStore.remove(doc, editing.id));
    store.set({ selection: [] });
  }
  schedule();
}

function sync() {
  if (!ta || !overlay.editing) return;
  overlay.editing = { ...overlay.editing, start: ta.selectionStart, end: ta.selectionEnd, since: performance.now() };
  schedule();
}

/** Keys the canvas's line breaks decide (the textarea's own lines differ), and Escape. */
function onKey(e: KeyboardEvent) {
  if (!ta || !overlay.editing) return;
  if (e.key === "Escape") {
    e.preventDefault();
    const id = overlay.editing.id;
    stopTextEdit();
    if (docStore.exists(doc, id)) store.set({ selection: [id] });
    return;
  }
  const s = currentScene();
  const l = s && laidOut(s, overlay.editing.id);
  if (!l) return;
  const text = ta.value;
  // The moving end of the selection.
  const focus = ta.selectionDirection === "backward" ? ta.selectionStart : ta.selectionEnd;
  let to: number | undefined;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const c = caretAt(l, text, focus);
    const y = e.key === "ArrowUp" ? c.y - c.h / 2 : c.y + c.h * 1.5;
    if (y < l.box.y) to = 0;
    else if (y > l.box.y + l.box.h) to = text.length;
    else to = l.para.getGlyphPositionAtCoordinate(c.x - l.box.x, y - l.box.y).pos;
  } else if ((e.key === "Home" || e.key === "End") && !e.ctrlKey && !e.metaKey) {
    const line = l.para.getLineMetrics().find((m) => focus >= m.startIndex && focus <= m.endIncludingNewline) ?? l.para.getLineMetrics().at(-1);
    if (line) to = e.key === "Home" ? line.startIndex : line.endExcludingWhitespaces;
  }
  if (to === undefined) return;
  e.preventDefault();
  const anchor = ta.selectionDirection === "backward" ? ta.selectionEnd : ta.selectionStart;
  if (e.shiftKey) ta.setSelectionRange(Math.min(anchor, to), Math.max(anchor, to), to < anchor ? "backward" : "forward");
  else ta.setSelectionRange(to, to);
  sync();
}

/**
 * A press while typing: inside the text it places the caret (Shift extends the selection, a drag
 * selects, a double-click selects a word) and returns true; elsewhere it returns false.
 */
export function editingPointer(e: PointerEvent, at: Point): boolean {
  const s = currentScene();
  const editing = overlay.editing;
  if (!s || !editing || !ta) return false;
  const box = s.boxes.get(editing.id);
  if (!box || at.x < box.x - 4 || at.x > box.x + box.w + 4 || at.y < box.y - 4 || at.y > box.y + box.h + 4) return false;
  e.preventDefault();
  const area = ta;
  const offset = offsetAt(s, editing.id, at);
  if (e.detail === 2) {
    const l = laidOut(s, editing.id);
    const word = l?.para.getWordBoundary(offset);
    if (word) area.setSelectionRange(word.start, word.end);
  } else {
    const anchor = e.shiftKey ? area.selectionStart : offset;
    area.setSelectionRange(Math.min(anchor, offset), Math.max(anchor, offset));
    const el = e.target as HTMLElement;
    const onMove = (m: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = view.x + (m.clientX - r.left) / view.zoom;
      const y = view.y + (m.clientY - r.top) / view.zoom;
      const now = offsetAt(s, editing.id, { x, y });
      area.setSelectionRange(Math.min(anchor, now), Math.max(anchor, now), now < anchor ? "backward" : "forward");
      sync();
    };
    const onUp = () => (removeEventListener("pointermove", onMove), removeEventListener("pointerup", onUp));
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
  }
  setTimeout(() => area.focus(), 0);
  sync();
  return true;
}

/** The selected range (tinted) or the blinking caret of the text being typed into. */
export function drawTextEditing(canvas: Canvas, s: Scene): void {
  const editing = overlay.editing;
  if (!editing) return;
  const l = laidOut(s, editing.id);
  if (!l) return;
  const { ck } = engine;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  if (editing.start !== editing.end) {
    paint.setColor(ck.Color4f(...SELECT_RGB, 0.3));
    for (const { rect } of l.para.getRectsForRange(editing.start, editing.end, ck.RectHeightStyle.Max, ck.RectWidthStyle.Tight)) {
      const [x1, y1] = toScreen(l.box.x + rect[0]!, l.box.y + rect[1]!);
      const [x2, y2] = toScreen(l.box.x + rect[2]!, l.box.y + rect[3]!);
      canvas.drawRect(ck.LTRBRect(x1, y1, x2, y2), paint);
    }
  } else if (Math.floor((performance.now() - editing.since) / BLINK_MS) % 2 === 0) {
    const c = caretAt(l, editedText(), editing.start);
    const [x, y] = toScreen(c.x, c.y);
    const type = docStore.typeOf(doc, editing.id) ?? "text";
    const ink = isCard(type) ? colorOf(CARD[type as keyof typeof CARD].ink, s.vars) : textColor(docStore.propsOf(doc, editing.id).fill, s.vars);
    const caret: RGBA = ink[3] > 0 ? ink : colorOf("#000000", s.vars);
    paint.setColor(ck.Color4f(...caret));
    canvas.drawRect(ck.XYWHRect(Math.round(x), y, 1, c.h * view.zoom), paint);
  }
  paint.delete();
}
