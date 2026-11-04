// Import a web page (or one element of it) onto the canvas as editable layers, as Pen's Import does:
// the page's own boxes become frames — a flex box keeps its direction, gap, padding and alignment, a
// block stacks its children — with their fills, borders, corner radii and clipping; text becomes text
// nodes with its font; images become image fills; SVG icons become frames of paths and shapes. Each
// node keeps the element it came from in `context` ("button", "ChevronDown - svg").
//
// `snapshotInPage` runs in the page (it is sent as source) and measures it; `toPen` turns that into .pen
// nodes and runs anywhere, so it can be tested on its own.
import type { PenNode } from "../doc/schema.js";

/** One element (or run of text) as measured in the page. Boxes are relative to the imported root. */
export interface Snap {
  tag: string;
  /** What the node's `context` says: the tag, or "Name - svg" for a known icon. */
  context: string;
  x: number;
  y: number;
  w: number;
  h: number;
  display: string;
  position: string;
  direction: "row" | "column";
  gap: number;
  justify: string;
  align: string;
  padding: [number, number, number, number];
  background: string | null;
  border: { widths: [number, number, number, number]; color: string } | null;
  radius: [number, number, number, number];
  opacity: number;
  clip: boolean;
  text?: SnapText;
  /** An <img>'s address (absolute). */
  image?: string;
  svg?: SnapSvg;
  children: Snap[];
}

export interface SnapText {
  content: string;
  color: string;
  font: string;
  size: number;
  weight: string;
  /** Line height in pixels, or 0 for "normal". */
  lineHeight: number;
  align: string;
  italic: boolean;
  letterSpacing: number;
  /** Wraps onto more than one line. */
  wraps: boolean;
}

export interface SnapSvg {
  items: {
    kind: "path" | "rect" | "ellipse";
    /** Box in the svg element's pixels. */
    x: number;
    y: number;
    w: number;
    h: number;
    d?: string;
    rx?: number;
    fill: string | null;
    stroke: string | null;
    strokeWidth: number;
    cap?: string;
    join?: string;
  }[];
}

/**
 * Runs in the page: the element `selector` matches (or the body) and everything visible inside it,
 * measured. Null when nothing matches.
 */
export function snapshotInPage(selector: string | null): Snap | null {
  const root = selector === null ? document.body : document.querySelector(selector);
  if (!root) return null;
  const LIMIT = 4000;
  const CAPTURE = "capture:";
  let count = 0;
  const base = root.getBoundingClientRect();
  const px = (v: string) => parseFloat(v) || 0;
  const color = (c: string): string | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = "1"] = m[1]!.split(/[\s,/]+/).filter(Boolean);
    const alpha = parseFloat(a);
    if (alpha === 0) return null;
    const hex = [r, g, b].map((v) => Math.round(parseFloat(v!)).toString(16).padStart(2, "0")).join("");
    return `#${hex}${alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, "0") : ""}`;
  };
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "IFRAME"]);
  const pascal = (s: string) => s.replace(/(^|-)(\w)/g, (_m, _d, c: string) => c.toUpperCase());
  const textOf = (s: CSSStyleDeclaration, content: string, r: DOMRect): SnapText => {
    const lh = s.lineHeight === "normal" ? 0 : px(s.lineHeight);
    const size = px(s.fontSize);
    return {
      content,
      color: color(s.color) ?? "#000000",
      font: s.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, ""),
      size,
      weight: s.fontWeight,
      lineHeight: lh,
      align: s.textAlign,
      italic: s.fontStyle === "italic",
      letterSpacing: s.letterSpacing === "normal" ? 0 : px(s.letterSpacing),
      wraps: r.height > (lh || size * 1.3) * 1.5,
    };
  };
  const box = (r: DOMRect | { left: number; top: number; width: number; height: number }) => ({
    x: Math.round((r.left - base.left) * 100) / 100,
    y: Math.round((r.top - base.top) * 100) / 100,
    w: Math.round(r.width * 100) / 100,
    h: Math.round(r.height * 100) / 100,
  });
  const plain = (s: CSSStyleDeclaration) => ({
    display: s.display,
    position: s.position,
    direction: (s.flexDirection.startsWith("column") ? "column" : "row") as "row" | "column",
    gap: 0,
    justify: s.justifyContent,
    align: s.alignItems,
    padding: [px(s.paddingTop), px(s.paddingRight), px(s.paddingBottom), px(s.paddingLeft)] as [number, number, number, number],
    background: color(s.backgroundColor),
    border: null as Snap["border"],
    radius: [px(s.borderTopLeftRadius), px(s.borderTopRightRadius), px(s.borderBottomRightRadius), px(s.borderBottomLeftRadius)] as [number, number, number, number],
    opacity: parseFloat(s.opacity),
    clip: s.overflowX !== "visible" || s.overflowY !== "visible",
  });
  const svgOf = (svg: SVGSVGElement): SnapSvg => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    const sx = vb && vb.width ? r.width / vb.width : 1;
    const sy = vb && vb.height ? r.height / vb.height : 1;
    const ox = vb ? vb.x : 0;
    const oy = vb ? vb.y : 0;
    const items: SnapSvg["items"] = [];
    for (const g of svg.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon")) {
      const s = getComputedStyle(g);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const b = (g as SVGGraphicsElement).getBBox();
      const tag = g.tagName.toLowerCase();
      const at = { x: (b.x - ox) * sx, y: (b.y - oy) * sy, w: b.width * sx, h: b.height * sy };
      const paint = { fill: s.fill === "none" ? null : color(s.fill), stroke: s.stroke === "none" ? null : color(s.stroke), strokeWidth: px(s.strokeWidth) * sx, cap: s.strokeLinecap, join: s.strokeLinejoin };
      const attr = (n: string) => parseFloat(g.getAttribute(n) ?? "0") || 0;
      if (tag === "rect") items.push({ kind: "rect", ...at, rx: attr("rx") * sx, ...paint });
      else if (tag === "circle" || tag === "ellipse") items.push({ kind: "ellipse", ...at, ...paint });
      else {
        let d = g.getAttribute("d") ?? "";
        if (tag === "line") d = `M${attr("x1")} ${attr("y1")}L${attr("x2")} ${attr("y2")}`;
        else if (tag === "polyline" || tag === "polygon") d = `M${(g.getAttribute("points") ?? "").trim()}${tag === "polygon" ? "Z" : ""}`;
        if (d) items.push({ kind: "path", ...at, d, ...paint });
      }
    }
    return { items };
  };
  const walk = (el: Element): Snap | null => {
    if (SKIP.has(el.tagName) || ++count > LIMIT) return null;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return null;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const node: Snap = { tag, context: tag, ...box(r), ...plain(s), children: [] };
    const widths: [number, number, number, number] = [px(s.borderTopWidth), px(s.borderRightWidth), px(s.borderBottomWidth), px(s.borderLeftWidth)];
    const sides = [s.borderTopStyle, s.borderRightStyle, s.borderBottomStyle, s.borderLeftStyle];
    widths.forEach((w, i) => sides[i] === "none" && (widths[i] = 0));
    const borderColor = color(s.borderTopColor) ?? color(s.borderBottomColor) ?? color(s.borderLeftColor);
    if (widths.some((w) => w > 0) && borderColor) node.border = { widths, color: borderColor };
    if (s.display.includes("flex")) node.gap = px(node.direction === "row" ? s.columnGap : s.rowGap);
    if (tag === "svg") {
      const icon = [...el.classList].find((c) => c.startsWith("lucide-"));
      if (icon) node.context = `${pascal(icon.slice(7))} - svg`;
      node.svg = svgOf(el as SVGSVGElement);
      return node;
    }
    if (tag === "img") {
      node.image = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
      return node;
    }
    // A drawing (a chart, a game) comes over as its picture, cut from a screenshot of the page (a WebGL
    // canvas can't be read back): "capture:" and where it is in the viewport, in CSS pixels.
    if (tag === "canvas") {
      node.image = `${CAPTURE}${[r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(",")}`;
      return node;
    }
    if (el instanceof SVGElement) return null;
    const kids = [...el.childNodes];
    const onlyText = kids.length > 0 && kids.every((n) => n.nodeType === Node.TEXT_NODE);
    if (onlyText) {
      const content = (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
      if (content) node.text = textOf(s, content, r);
      return node.text || node.background || node.border ? node : r.width > 0 && r.height > 0 ? node : null;
    }
    for (const k of kids) {
      if (k.nodeType === Node.TEXT_NODE) {
        const content = k.textContent?.replace(/\s+/g, " ").trim();
        if (!content) continue;
        const range = document.createRange();
        range.selectNodeContents(k);
        const tr = range.getBoundingClientRect();
        if (tr.width === 0) continue;
        node.children.push({
          tag: "#text", context: tag, ...box(tr), display: "inline", position: "static", direction: "row", gap: 0, justify: "normal", align: "normal",
          padding: [0, 0, 0, 0], background: null, border: null, radius: [0, 0, 0, 0], opacity: 1, clip: false,
          text: textOf(s, content, tr), children: [],
        });
      } else if (k.nodeType === Node.ELEMENT_NODE) {
        const child = walk(k as Element);
        if (child) node.children.push(child);
      }
    }
    if (!node.children.length && !node.background && !node.border && (r.width === 0 || r.height === 0)) return null;
    return node;
  };
  return walk(root);
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Pen's compact padding: one number, [vertical, horizontal], or all four. */
function padding([t, r, b, l]: Snap["padding"]): PenNode["padding"] | undefined {
  if (!t && !r && !b && !l) return undefined;
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return [t, r];
  return [t, r, b, l];
}

const JUSTIFY: Record<string, PenNode["justifyContent"]> = {
  center: "center", "flex-end": "end", end: "end", right: "end", "space-between": "space_between", "space-around": "space_around",
};
const ALIGN: Record<string, PenNode["alignItems"]> = { center: "center", "flex-end": "end", end: "end", "flex-start": "start", start: "start" };

/** A text run as a text node, with its font. */
function textNode(s: Snap, t: SnapText): PenNode {
  const node: Record<string, unknown> = {
    type: "text",
    name: t.content.length > 40 ? `${t.content.slice(0, 40)}…` : t.content,
    context: s.context,
    fill: t.color,
    content: t.content,
    fontFamily: t.font,
    fontSize: round(t.size),
    fontWeight: t.weight,
  };
  if (t.lineHeight) node.lineHeight = round(t.lineHeight / t.size);
  if (t.align === "center" || t.align === "right" || t.align === "justify") node.textAlign = t.align;
  if (t.italic) node.fontStyle = "italic";
  if (t.letterSpacing) node.letterSpacing = round(t.letterSpacing);
  // Text that wraps keeps its width.
  if (t.wraps) Object.assign(node, { textGrowth: "fixed-width", width: round(s.w) });
  return node as unknown as PenNode;
}

/** A box's own look: fill, border, corners, opacity, clipping. */
function look(s: Snap, node: Record<string, unknown>): void {
  if (s.background) node.fill = s.background;
  if (s.border) {
    const [t, r, b, l] = s.border.widths;
    node.stroke = s.border.color;
    node.strokeWidth = t === r && r === b && b === l ? t : Object.fromEntries(Object.entries({ top: t, right: r, bottom: b, left: l }).filter(([, v]) => v > 0));
    node.strokeAlignment = "inner";
  }
  const [tl, tr, br, bl] = s.radius;
  if (tl || tr || br || bl) node.cornerRadius = tl === tr && tr === br && br === bl ? round(tl) : [tl, tr, br, bl].map(round);
  if (s.opacity < 1) node.opacity = round(s.opacity);
}

/** The page's measured tree as .pen nodes; `name` names the root. */
export function toPen(snap: Snap, name?: string): PenNode {
  const node = convert(snap, null);
  if (name) (node as { name?: string }).name = name;
  return node;
}

function convert(s: Snap, parent: Snap | null): PenNode {
  let node: Record<string, unknown>;
  // A child the parent's flow doesn't place keeps its own place.
  const free = parent && (s.position === "absolute" || s.position === "fixed" || layoutOf(parent) === "none");
  const place = () => (free ? { ...(layoutOf(parent!) === "none" ? {} : { layoutPosition: "absolute" }), x: round(s.x - parent!.x), y: round(s.y - parent!.y) } : {});
  if (s.text && !s.background && !s.border && !s.padding.some(Boolean)) {
    node = { ...(textNode(s, s.text) as Record<string, unknown>), ...place() };
    return node as unknown as PenNode;
  }
  if (s.svg) {
    node = {
      type: "frame", name: "svg", context: s.context, clip: true, width: round(s.w), height: round(s.h), layout: "none", ...place(),
      children: s.svg.items.map((i) => {
        const paint: Record<string, unknown> = {};
        if (i.fill) paint.fill = i.fill;
        if (i.stroke) Object.assign(paint, { stroke: i.stroke, strokeWidth: i.strokeWidth, ...(i.join ? { strokeLinejoin: i.join } : {}), ...(i.cap ? { strokeLinecap: i.cap } : {}) });
        const at = { x: round(i.x), y: round(i.y), width: round(i.w), height: round(i.h) };
        if (i.kind === "rect") return { type: "rectangle", ...at, ...(i.rx ? { cornerRadius: round(i.rx) } : {}), ...paint };
        if (i.kind === "ellipse") return { type: "ellipse", ...at, ...paint };
        return { type: "path", ...at, geometry: i.d, ...paint };
      }),
    };
    return node as unknown as PenNode;
  }
  if (s.image !== undefined) {
    node = { type: "rectangle", name: s.tag, context: s.context, width: round(s.w), height: round(s.h), ...place() };
    look(s, node);
    node.fill = { type: "image", enabled: true, url: s.image, mode: "cover" };
    return node as unknown as PenNode;
  }
  const layout = layoutOf(s);
  // A box with nothing inside it is a rectangle.
  if (!s.children.length && !s.text) {
    node = { type: "rectangle", name: s.tag, context: s.context, width: round(s.w), height: round(s.h), ...place() };
    look(s, node);
    return node as unknown as PenNode;
  }
  node = { type: "frame", name: labelOf(s), context: s.context, width: round(s.w), height: round(s.h), ...place() };
  if (s.clip) node.clip = true;
  look(s, node);
  if (layout !== "horizontal") node.layout = layout;
  if (layout !== "none") {
    if (s.gap) node.gap = round(s.gap);
    const p = padding(s.padding);
    if (p !== undefined) node.padding = p;
    const j = JUSTIFY[s.justify];
    if (j) node.justifyContent = j;
    const a = ALIGN[s.align];
    if (a && s.display.includes("flex")) node.alignItems = a;
  }
  const kids = s.text ? [{ ...s, tag: "#text", background: null, border: null, padding: [0, 0, 0, 0] as Snap["padding"], children: [] }] : s.children;
  node.children = kids.map((c) => convert(c, s));
  return node as unknown as PenNode;
}

/** How a box lays out its children: a flex box by its direction, a block stacks them, anything else keeps their places. */
function layoutOf(s: Snap): "horizontal" | "vertical" | "none" {
  if (s.display.includes("flex")) return s.direction === "column" ? "vertical" : "horizontal";
  if (s.display === "block" || s.display === "list-item" || s.display === "inline-block") {
    // Children side by side (inline ones) lay out in a row; otherwise they stack.
    const flow = s.children.filter((c) => c.position !== "absolute" && c.position !== "fixed");
    if (flow.length > 1 && flow.every((c) => Math.abs(c.y - flow[0]!.y) < 2)) return "horizontal";
    return "vertical";
  }
  return "none";
}

/** A box's name, as Pen gives it: its text when that is all it holds (a button's label), else its tag. */
function labelOf(s: Snap): string {
  const texts: string[] = [];
  const visit = (n: Snap) => {
    if (n.text) texts.push(n.text.content);
    n.children.forEach(visit);
  };
  visit(s);
  return texts.length === 1 && texts[0]!.length <= 30 ? texts[0]! : s.tag;
}

/** Every image address in a tree of .pen nodes (to fetch and keep beside the file). */
export function imageUrls(node: PenNode, out = new Set<string>()): Set<string> {
  const fill = (node as { fill?: unknown }).fill;
  for (const f of Array.isArray(fill) ? fill : [fill]) {
    if (f && typeof f === "object" && (f as { type?: string }).type === "image") {
      const url = (f as { url?: string }).url;
      if (url && /^https?:|^data:|^capture:/.test(url)) out.add(url);
    }
  }
  for (const c of (node as { children?: PenNode[] }).children ?? []) imageUrls(c, out);
  return out;
}

/** Points image fills at new addresses (fetched pictures kept beside the file). */
export function relinkImages(node: PenNode, map: Map<string, string>): void {
  const n = node as { fill?: unknown; children?: PenNode[] };
  const fix = (f: unknown) => {
    if (f && typeof f === "object" && (f as { type?: string }).type === "image") {
      const to = map.get((f as { url: string }).url);
      if (to) (f as { url: string }).url = to;
    }
  };
  if (Array.isArray(n.fill)) n.fill.forEach(fix);
  else fix(n.fill);
  n.children?.forEach((c) => relinkImages(c, map));
}
