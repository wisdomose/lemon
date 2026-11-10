// The selection as HTML with CSS or Tailwind classes (the page's boxes give sizes and places).
import { resolveOr, colorOf, type RGBA } from "../doc/values.js";
import type { NodeProps, TreeNode, Vars } from "../doc/schema.js";
import { kindOf, type Box } from "../layout/layout.js";

type Css = Record<string, string>;
interface El {
  tag: string;
  css: Css;
  text?: string;
  svg?: string;
  children: El[];
  label?: string;
}

/** A number property, or `fallback` when it is missing or not a number. */
function numOf(v: unknown, vars: Vars, fallback: number): number {
  const r = Number(resolveOr(v, vars, fallback));
  return Number.isFinite(r) ? r : fallback;
}
const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const rgba = ([r, g, b, a]: RGBA) => (a >= 1 ? `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}` : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Math.round(a * 1000) / 1000})`);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colorCss(v: unknown, vars: Vars): string | undefined {
  try {
    return rgba(colorOf(v, vars));
  } catch {
    return undefined;
  }
}

/** The first enabled fill as a CSS background value. */
function fillCss(fill: unknown, vars: Vars): string | undefined {
  const list = (Array.isArray(fill) ? fill : fill === undefined ? [] : [fill]) as unknown[];
  const layers: string[] = [];
  for (const f of list) {
    if (typeof f === "string") {
      const c = colorCss(f, vars);
      if (c) layers.push(`linear-gradient(${c}, ${c})`);
      continue;
    }
    const o = f as Record<string, unknown>;
    if (!o || resolveOr(o.enabled, vars, true) === false) continue;
    if (o.type === "color") {
      const c = colorCss(o.color, vars);
      if (c) layers.push(`linear-gradient(${c}, ${c})`);
    } else if (o.type === "gradient") {
      const stops = ((o.colors as { color: string; position: number }[]) ?? []).map((s) => `${colorCss(s.color, vars) ?? "transparent"} ${Math.round(numOf(s.position, vars, 0) * 100)}%`).join(", ");
      if (!stops) continue;
      const kind = o.gradientType ?? "linear";
      if (kind === "radial") layers.push(`radial-gradient(ellipse at ${Math.round(((o.center as { x?: number })?.x ?? 0.5) * 100)}% ${Math.round(((o.center as { y?: number })?.y ?? 0.5) * 100)}%, ${stops})`);
      else if (kind === "angular") layers.push(`conic-gradient(from 0deg, ${stops})`);
      else layers.push(`linear-gradient(${(360 - (numOf(o.rotation, vars, 0) % 360)) % 360}deg, ${stops})`);
    } else if (o.type === "image" && typeof o.url === "string") {
      const mode = o.mode === "contain" ? "contain" : o.mode === "stretch" ? "100% 100%" : "cover";
      layers.push(`url("${o.url}") center / ${mode} no-repeat`);
    }
  }
  // Pen draws the first fill on the bottom; CSS lists the top layer first.
  return layers.length ? layers.reverse().join(", ") : undefined;
}

const sidesOf = (v: unknown, vars: Vars): number[] => {
  const n = (x: unknown) => numOf(x, vars, 0);
  if (Array.isArray(v)) return v.length === 2 ? [n(v[0]), n(v[1]), n(v[0]), n(v[1])] : [n(v[0]), n(v[1]), n(v[2]), n(v[3])];
  return [n(v), n(v), n(v), n(v)];
};

const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", space_between: "space-between", space_around: "space-around" };
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end" };

function build(node: TreeNode, vars: Vars, boxes: Map<string, Box>, parent: { box: Box; flow: boolean } | null): El | null {
  const p: NodeProps = node.props;
  if (resolveOr(p.enabled, vars, true) === false) return null;
  const box = boxes.get(node.id);
  if (!box) return null;
  const css: Css = {};
  const absolute = !parent || !parent.flow || p.layoutPosition === "absolute";
  if (!parent) css.position = "relative";
  else if (absolute) {
    css.position = "absolute";
    css.left = px(box.x - parent.box.x);
    css.top = px(box.y - parent.box.y);
  }
  css.width = px(box.w);
  css.height = px(box.h);
  css["box-sizing"] = "border-box";
  const opacity = numOf(p.opacity, vars, 1);
  if (opacity !== 1) css.opacity = String(opacity);
  const rotation = numOf(p.rotation, vars, 0);
  const flips = `${resolveOr(p.flipX, vars, false) ? " scaleX(-1)" : ""}${resolveOr(p.flipY, vars, false) ? " scaleY(-1)" : ""}`;
  if (rotation || flips) {
    css["transform-origin"] = "top left";
    css.transform = `${rotation ? `rotate(${-rotation}deg)` : ""}${flips}`.trim();
  }
  const el: El = { tag: "div", css, children: [], label: String(p.name ?? node.type) };

  if (node.type === "text" || node.type === "note" || node.type === "prompt" || node.type === "context") {
    const color = colorCss((Array.isArray(p.fill) ? p.fill[0] : p.fill) && (typeof (Array.isArray(p.fill) ? p.fill[0] : p.fill) === "string" ? (p.fill as string) : ((Array.isArray(p.fill) ? p.fill[0] : p.fill) as { color?: string }).color), vars);
    if (color) css.color = color;
    const family = resolveOr(p.fontFamily, vars, undefined);
    if (typeof family === "string" && family) css["font-family"] = `"${family}", sans-serif`;
    css["font-size"] = px(numOf(p.fontSize, vars, 14));
    const weight = String(resolveOr(p.fontWeight, vars, "normal") ?? "normal");
    if (weight !== "normal") css["font-weight"] = weight;
    if (p.fontStyle === "italic") css["font-style"] = "italic";
    const ls = numOf(p.letterSpacing, vars, 0);
    if (ls) css["letter-spacing"] = px(ls);
    if (p.lineHeight !== undefined) css["line-height"] = String(resolveOr(p.lineHeight, vars, 1));
    if (p.textAlign) css["text-align"] = p.textAlign;
    const deco = [resolveOr(p.underline, vars, false) && "underline", resolveOr(p.strikethrough, vars, false) && "line-through"].filter(Boolean).join(" ");
    if (deco) css["text-decoration"] = deco;
    if (p.textAlignVertical && p.textAlignVertical !== "top") {
      css.display = "flex";
      css["flex-direction"] = "column";
      css["justify-content"] = p.textAlignVertical === "middle" ? "center" : "flex-end";
    }
    css["white-space"] = p.textGrowth === "auto" ? "pre" : "pre-wrap";
    el.text = String(p.content ?? "");
    if (p.href) el.tag = "a";
    return el;
  }

  const bg = fillCss(p.fill, vars);
  if (bg && node.type !== "path" && node.type !== "line") css.background = bg;
  const radius = node.type === "ellipse" ? "50%" : p.cornerRadius !== undefined ? (Array.isArray(p.cornerRadius) ? sidesOf(p.cornerRadius, vars).map(px).join(" ") : px(numOf(p.cornerRadius, vars, 0))) : undefined;
  if (radius && radius !== "0px") css["border-radius"] = radius;

  const stroke = fillCss(p.stroke, vars);
  const strokeColor = Array.isArray(p.stroke) ? p.stroke[0] : p.stroke;
  const sc = colorCss(typeof strokeColor === "string" ? strokeColor : (strokeColor as { color?: string } | undefined)?.color, vars);
  if (stroke && sc && node.type !== "path") {
    const w = p.strokeWidth;
    const [t, r, b, l] = typeof w === "object" && w !== null ? [w.top, w.right, w.bottom, w.left].map((x) => numOf(x, vars, 0) || 0) : Array(4).fill(numOf(w, vars, 1) || 0);
    const uniform = t === r && r === b && b === l;
    if (uniform && !p.layoutIncludeStroke) {
      // A stroke doesn't move what is inside the frame: an outline, drawn inside, across or outside the edge.
      const offset = p.strokeAlignment === "outer" ? 0 : p.strokeAlignment === "inner" ? -t! : -t! / 2; // Pen: centre by default
      css.outline = `${px(t!)} solid ${sc}`;
      if (offset) css["outline-offset"] = px(offset);
    } else {
      // Different widths per side (or a stroke the layout counts): a border.
      css["border-style"] = "solid";
      css["border-color"] = sc;
      css["border-width"] = [t, r, b, l].map((x) => px(x!)).join(" ");
    }
  }

  const shadows: string[] = [];
  const filters: string[] = [];
  const effects = (Array.isArray(p.effect) ? p.effect : p.effect ? [p.effect] : []) as Record<string, unknown>[];
  for (const e of effects) {
    if (resolveOr(e.enabled, vars, true) === false) continue;
    const r = numOf(e.radius ?? e.blur, vars, 0);
    if (e.type === "shadow") {
      const o = (e.offset as { x?: number; y?: number }) ?? {};
      shadows.push(`${e.shadowType === "inner" ? "inset " : ""}${px(numOf(o.x, vars, 0))} ${px(numOf(o.y, vars, 0))} ${px(numOf(e.blur, vars, 0))} ${px(numOf(e.spread, vars, 0))} ${colorCss(e.color ?? "#00000040", vars) ?? "#00000040"}`);
    } else if (e.type === "blur") filters.push(`blur(${px(r)})`);
    else if (e.type === "background_blur") css["backdrop-filter"] = `blur(${px(r)})`;
  }
  if (shadows.length) css["box-shadow"] = shadows.join(", ");
  if (filters.length) css.filter = filters.join(" ");

  if (node.type === "path" && typeof p.geometry === "string") {
    const vb = p.viewBox ?? [0, 0, box.w, box.h];
    const fill = fillCss(p.fill, vars) ? colorCss((Array.isArray(p.fill) ? p.fill[0] : p.fill) && (typeof (Array.isArray(p.fill) ? p.fill[0] : p.fill) === "string" ? p.fill : (p.fill as { color?: string }).color), vars) : undefined;
    const sw = typeof p.strokeWidth === "number" ? p.strokeWidth : 1;
    el.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(box.w)}" height="${Math.round(box.h)}" viewBox="${vb.join(" ")}"><path d="${p.geometry}" fill="${fill ?? "none"}"${sc ? ` stroke="${sc}" stroke-width="${sw}"` : ""}${p.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""}/></svg>`;
    return el;
  }

  if (node.type === "frame" || node.type === "group" || node.type === "ref") {
    // As the layout places them: a frame without `layout` is a row.
    const kind = kindOf(node);
    const flow = kind !== "free";
    if (p.clip === true) css.overflow = "hidden";
    // Children placed absolutely are placed against this box.
    if (!css.position && node.children.length) css.position = "relative";
    if (flow) {
      css.display = "flex";
      css["flex-direction"] = kind === "row" ? "row" : "column";
      const gap = numOf(p.gap, vars, 0);
      if (gap) css.gap = px(gap);
      const pad = sidesOf(p.padding ?? 0, vars);
      if (pad.some(Boolean)) css.padding = pad.map(px).join(" ");
      if (p.justifyContent) css["justify-content"] = JUSTIFY[p.justifyContent] ?? "flex-start";
      if (p.alignItems) css["align-items"] = ALIGN[p.alignItems] ?? "flex-start";
    }
    for (const c of node.children) {
      const child = build(c, vars, boxes, { box, flow });
      if (child) el.children.push(child);
    }
  }
  return el;
}

const ident = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "node";

function renderCss(els: El[]): string {
  const rules: string[] = [];
  const used = new Map<string, number>();
  const walk = (el: El, depth: number): string => {
    const base = ident(el.label ?? "node");
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const cls = n === 1 ? base : `${base}-${n}`;
    rules.push(`.${cls} {\n${Object.entries(el.css).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`);
    const pad = "  ".repeat(depth);
    const inner = el.svg ?? (el.text !== undefined ? esc(el.text) : "");
    if (!el.children.length) return `${pad}<${el.tag} class="${cls}">${inner}</${el.tag}>`;
    return `${pad}<${el.tag} class="${cls}">\n${el.children.map((c) => walk(c, depth + 1)).join("\n")}\n${pad}</${el.tag}>`;
  };
  const html = els.map((e) => walk(e, 0)).join("\n");
  return `${html}\n\n<style>\n${rules.join("\n\n")}\n</style>`;
}

function renderTailwind(els: El[]): string {
  // Inside class="…": spaces become underscores and double quotes single ones, as Tailwind reads them.
  const arb = (k: string, v: string) => `[${k}:${v.replace(/\s+/g, "_").replace(/"/g, "'")}]`;
  const walk = (el: El, depth: number): string => {
    const cls = Object.entries(el.css).map(([k, v]) => arb(k, v)).join(" ");
    const pad = "  ".repeat(depth);
    const inner = el.svg ?? (el.text !== undefined ? esc(el.text) : "");
    if (!el.children.length) return `${pad}<${el.tag} class="${cls}">${inner}</${el.tag}>`;
    return `${pad}<${el.tag} class="${cls}">\n${el.children.map((c) => walk(c, depth + 1)).join("\n")}\n${pad}</${el.tag}>`;
  };
  return els.map((e) => walk(e, 0)).join("\n");
}


/** Each node as markup; `style` picks a <style> block of classes or Tailwind arbitrary-property classes. */
export function htmlFor(nodes: TreeNode[], vars: Vars, boxes: Map<string, Box>, style: "css" | "tailwind"): string {
  const els = nodes.map((n) => build(n, vars, boxes, null)).filter((e): e is El => !!e);
  if (!els.length) return "";
  return style === "css" ? renderCss(els) : renderTailwind(els);
}
