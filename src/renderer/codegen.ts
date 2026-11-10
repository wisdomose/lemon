// The selection as HTML with CSS or Tailwind classes (the page's boxes give sizes and places).
import { resolveOr, colorOf, withTheme, type RGBA } from "../doc/values.js";
import type { NodeProps, TreeNode, Vars } from "../doc/schema.js";
import { kindOf, type Box } from "../layout/layout.js";
import { iconPathData, ICON_GRID, ICON_LINE } from "../render/icons.js";
import { iconFace, iconLigature } from "../text/icon-fonts.js";
import { faceOf } from "../text/paragraph.js";
import { facesUsed } from "../layout/layout.js";

/** What the generator can't work out on its own. */
export interface CodegenOptions {
  /** A path's geometry bounds [x, y, w, h], for a path without a viewBox (the app draws it against them). */
  pathBounds?: (d: string) => [number, number, number, number] | null;
  /** Whether Google Fonts serves a family (the copy links only those); undefined links every family. */
  webFont?: (family: string) => boolean;
  /** A picture's url as the copy should name it (a data: URL, so the copy carries the picture); undefined keeps the url. */
  picture?: (url: string) => string | undefined;
}

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
function fillCss(fill: unknown, vars: Vars, opts: CodegenOptions = {}): string | undefined {
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
      layers.push(`url("${opts.picture?.(o.url) ?? o.url}") center / ${mode} no-repeat`);
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

/** The first enabled solid colour among fills, as CSS (gradients and pictures: their first stop, or none). */
function firstColor(fill: unknown, vars: Vars): string | undefined {
  const list = (Array.isArray(fill) ? fill : fill === undefined ? [] : [fill]) as unknown[];
  for (const f of list) {
    if (typeof f === "string") return colorCss(f, vars);
    const o = f as Record<string, unknown>;
    if (!o || resolveOr(o.enabled, vars, true) === false) continue;
    if (o.type === "color") return colorCss(o.color, vars);
    if (o.type === "gradient") return colorCss((o.colors as { color: string }[] | undefined)?.[0]?.color, vars);
  }
  return undefined;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A shape CSS can't draw, as the app draws it: an SVG string (paths, lines, polygons, arcs, Lucide and
 * Feather icons), or an icon font's glyph as styled text. Undefined for anything CSS draws itself.
 */
function svgShape(node: TreeNode, vars: Vars, box: Box, opts: CodegenOptions): string | { css: Css; text: string } | undefined {
  const p = node.props;
  const fill = firstColor(p.fill, vars);
  const stroke = firstColor(p.stroke, vars);
  const sw = typeof p.strokeWidth === "object" && p.strokeWidth !== null ? 1 : numOf(p.strokeWidth, vars, 1);
  const paint = (closed: boolean) =>
    `fill="${closed && fill ? fill : "none"}"${stroke && sw > 0 ? ` stroke="${stroke}" stroke-width="${r2(sw)}"${p.strokeLinecap ? ` stroke-linecap="${p.strokeLinecap}"` : ""}${p.strokeLinejoin ? ` stroke-linejoin="${p.strokeLinejoin}"` : ""}` : ""}`;
  const svg = (viewBox: string, body: string, extra = "") =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(box.w)}" height="${r2(box.h)}" viewBox="${viewBox}"${extra} overflow="visible" style="display:block">${body}</svg>`;
  const [w, h] = [r2(box.w), r2(box.h)];

  switch (node.type) {
    case "path": {
      if (typeof p.geometry !== "string") return undefined;
      const vb = Array.isArray(p.viewBox) && p.viewBox.length === 4 ? p.viewBox : (opts.pathBounds?.(p.geometry) ?? [0, 0, box.w, box.h]);
      const closed = /z\s*$/i.test(p.geometry.trim());
      // Stretched to the box as the app draws it; the stroke keeps its width however it is stretched.
      return svg(vb.map(r2).join(" "), `<path d="${p.geometry}" ${paint(closed)}${p.fillRule === "evenodd" ? ' fill-rule="evenodd"' : ""} vector-effect="non-scaling-stroke"/>`, ' preserveAspectRatio="none"');
    }
    case "line":
      // From the box's top-left corner to its bottom-right.
      return svg(`0 0 ${w} ${h}`, `<line x1="0" y1="0" x2="${w}" y2="${h}" ${paint(false)}/>`);
    case "polygon": {
      const count = Math.round(numOf(p.polygonCount, vars, 0));
      if (count < 3) return svg(`0 0 ${w} ${h}`, "");
      const pts: string[] = [];
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
        pts.push(`${r2(w / 2 + (Math.cos(a) * w) / 2)},${r2(h / 2 + (Math.sin(a) * h) / 2)}`);
      }
      const round = numOf(p.cornerRadius, vars, 0);
      return svg(`0 0 ${w} ${h}`, `<polygon points="${pts.join(" ")}" ${paint(true)}${round ? ` stroke-linejoin="round"` : ""}/>`);
    }
    case "ellipse": {
      const inner = Math.max(0, Math.min(1, numOf(p.innerRadius, vars, 0)));
      const sweep = Math.max(-360, Math.min(360, numOf(p.sweepAngle, vars, 360)));
      // A whole ellipse is a div with border-radius: 50%.
      if (Math.abs(sweep) >= 360 && !inner) return undefined;
      const [cx, cy, rx, ry] = [w / 2, h / 2, w / 2, h / 2];
      const [irx, iry] = [rx * inner, ry * inner];
      let d: string;
      if (Math.abs(sweep) >= 360) {
        const ring = (a: number, b: number) => `M${r2(cx - a)} ${r2(cy)}a${r2(a)} ${r2(b)} 0 1 0 ${r2(2 * a)} 0a${r2(a)} ${r2(b)} 0 1 0 ${r2(-2 * a)} 0Z`;
        d = ring(rx, ry) + ring(irx, iry);
      } else {
        // Angles run counter-clockwise from the right; SVG's y runs down.
        const start = (numOf(p.startAngle, vars, 0) * Math.PI) / 180;
        const end = start + (sweep * Math.PI) / 180;
        const at = (a: number, x: number, y: number) => `${r2(cx + x * Math.cos(a))} ${r2(cy - y * Math.sin(a))}`;
        const large = Math.abs(sweep) > 180 ? 1 : 0;
        const ccw = sweep > 0 ? 0 : 1;
        d = `M${at(start, rx, ry)}A${r2(rx)} ${r2(ry)} 0 ${large} ${ccw} ${at(end, rx, ry)}`;
        d += inner ? `L${at(end, irx, iry)}A${r2(irx)} ${r2(iry)} 0 ${large} ${1 - ccw} ${at(start, irx, iry)}Z` : `L${r2(cx)} ${r2(cy)}Z`;
      }
      return svg(`0 0 ${w} ${h}`, `<path d="${d}" ${paint(true)} fill-rule="evenodd"/>`);
    }
    case "icon": {
      const library = String(resolveOr(p.library ?? "lucide", vars, "lucide")).toLowerCase();
      const name = String(resolveOr(p.icon ?? "", vars, ""));
      const color = firstColor(p.fill, vars) ?? "currentColor";
      const size = Math.min(box.w, box.h);
      const face = iconFace(library, resolveOr(p.weight, vars, undefined));
      if (face && name) {
        // The web fonts' own family names (Phosphor's weights are separate families there too).
        const family = face.family.startsWith("Phosphor") ? face.family.replace(" ", "-") : face.family;
        const css: Css = {
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          color,
          "font-family": `"${family}"`,
          "font-size": px(size),
          "line-height": "1",
          "font-feature-settings": '"liga"',
        };
        if (!family.startsWith("Phosphor")) css["font-variation-settings"] = `"wght" ${face.weight}`;
        // The same ligature the app draws with: Phosphor's web fonts are the files the app loads.
        return { css, text: iconLigature(face, name) };
      }
      const d = library === "lucide" || library === "feather" ? iconPathData(name, library) : null;
      if (!d) return svg(`0 0 ${ICON_GRID} ${ICON_GRID}`, "");
      return svg(`0 0 ${ICON_GRID} ${ICON_GRID}`, `<path d="${d}" fill="none" stroke="${color}" stroke-width="${ICON_LINE}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    default:
      return undefined;
  }
}

const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", space_between: "space-between", space_around: "space-around" };
const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end" };

function build(node: TreeNode, vars: Vars, boxes: Map<string, Box>, parent: { box: Box; flow: boolean } | null, opts: CodegenOptions): El | null {
  const p: NodeProps = node.props;
  // A node's theme (light, dark, …) sets the variables for it and everything inside it, as on the canvas.
  vars = withTheme(vars, p.theme);
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
    // The face the canvas draws with (Inter when the node names none).
    const face = faceOf(p, vars);
    css["font-family"] = `"${face.family}", sans-serif`;
    css["font-size"] = px(numOf(p.fontSize, vars, 14));
    if (face.weight !== 400) css["font-weight"] = String(face.weight);
    if (face.italic) css["font-style"] = "italic";
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

  // Shapes CSS can't draw are SVG; they take no background, radius or outline of their own.
  const shape = svgShape(node, vars, box, opts);
  const bg = fillCss(p.fill, vars, opts);
  if (bg && shape === undefined) css.background = bg;
  const radius = shape !== undefined ? undefined : node.type === "ellipse" ? "50%" : p.cornerRadius !== undefined ? (Array.isArray(p.cornerRadius) ? sidesOf(p.cornerRadius, vars).map(px).join(" ") : px(numOf(p.cornerRadius, vars, 0))) : undefined;
  if (radius && radius !== "0px") css["border-radius"] = radius;

  const stroke = fillCss(p.stroke, vars);
  const strokeColor = Array.isArray(p.stroke) ? p.stroke[0] : p.stroke;
  const sc = colorCss(typeof strokeColor === "string" ? strokeColor : (strokeColor as { color?: string } | undefined)?.color, vars);
  if (stroke && sc && shape === undefined) {
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

  if (shape !== undefined) {
    if (typeof shape === "string") el.svg = shape;
    else {
      // An icon font's glyph: its ligature in the font, one em the size of the box's shorter side.
      Object.assign(css, shape.css);
      el.text = shape.text;
    }
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
      const child = build(c, vars, boxes, { box, flow }, opts);
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


/** Where Phosphor's web fonts' stylesheets are (the same version the app ships). */
const PHOSPHOR_CSS = "https://unpkg.com/@phosphor-icons/web@2.1.2/src";
const PHOSPHOR_SHEETS: Record<string, string> = { Phosphor: "regular", "Phosphor Bold": "bold", "Phosphor Thin": "thin", "Phosphor Light": "light" };

/** <link>s for the fonts the nodes use: Google Fonts for text and Material Symbols, Phosphor's own stylesheets. */
export function fontLinks(nodes: TreeNode[], vars: Vars, opts: CodegenOptions = {}): string {
  const google = new Map<string, Set<string>>();
  const material = new Set<string>();
  const phosphor = new Set<string>();
  for (const n of nodes)
    for (const f of facesUsed(n, vars)) {
      if (f.family in PHOSPHOR_SHEETS) phosphor.add(PHOSPHOR_SHEETS[f.family]!);
      else if (f.family.startsWith("Material Symbols")) material.add(f.family);
      else if (!opts.webFont || opts.webFont(f.family)) {
        const set = google.get(f.family) ?? new Set<string>();
        set.add(`${f.italic ? 1 : 0},${f.weight}`);
        google.set(f.family, set);
      }
    }
  const families = [...google].map(([family, styles]) => {
    // Google wants each family's styles in order: upright before italic, then by weight.
    const list = [...styles].sort((a, b) => a.split(",").map(Number).reduce((d, v, i) => d || v - Number(b.split(",")[i]), 0));
    return `family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@${list.join(";")}`;
  });
  for (const m of material) families.push(`family=${m.replace(/ /g, "+")}:wght@100..700`);
  const links: string[] = [];
  if (families.length)
    links.push(
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.join("&")}&display=swap">`,
    );
  for (const w of phosphor) links.push(`<link rel="stylesheet" href="${PHOSPHOR_CSS}/${w}/style.css">`);
  return links.join("\n");
}

/** Each node as markup; `style` picks a <style> block of classes or Tailwind arbitrary-property classes. */
export function htmlFor(nodes: TreeNode[], vars: Vars, boxes: Map<string, Box>, style: "css" | "tailwind", opts: CodegenOptions = {}): string {
  const els = nodes.map((n) => build(n, vars, boxes, null, opts)).filter((e): e is El => !!e);
  if (!els.length) return "";
  const links = fontLinks(nodes, vars, opts);
  const body = style === "css" ? renderCss(els) : renderTailwind(els);
  return links ? `${links}\n\n${body}` : body;
}
