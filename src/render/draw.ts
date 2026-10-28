// Drawing the document with CanvasKit, by Pen's schema. Used for the editor's canvas and for the
// agent's screenshots, in Node and in the browser alike.
//
// A node is drawn as: its outer shadows, its background blur, its fills (in list order, each with its
// own opacity and blend mode), its inner shadows, its content (text, an icon, its children — clipped
// when `clip` is set), then its strokes. `opacity`, `rotation` (counter-clockwise around the top-left
// corner), `flipX`/`flipY` and a layer blur apply to all of it.
//
// Not drawn yet (kept in the file as they are): shader fills and effects, mesh gradients, script
// output and live browser pages. Underline, strikethrough and a shadow's spread aren't drawn, as in
// Pen.
import type { Canvas, CanvasKit, Image, Paint as CKPaint, Path, Shader } from "canvaskit-wasm";
import type { BlendMode, Effect, Fill, Fills, ImageFill, NodeProps, TreeNode, Vars } from "../doc/schema.js";
import { isLocalUrl, type Assets } from "../doc/assets.js";
import { ICON_GRID, ICON_LINE, iconPath } from "./icons.js";
import { colorOf, resolveOr, withTheme } from "../doc/values.js";
import { isOff, num, type Box, type Boxes } from "../layout/layout.js";
import { isEnabled, textColor, type TextEngine } from "../text/paragraph.js";
import { iconFace, iconLigature } from "../text/icon-fonts.js";
import type { ScriptOutput } from "../main/scripts.js";

const PLACEHOLDER = "#d8d4cc";
const PLACEHOLDER_INK = "#8a857b";

export interface DrawContext {
  ck: CanvasKit;
  text: TextEngine;
  vars: Vars;
  boxes: Boxes;
  /** The document's pictures, by url. */
  assets: Assets;
  /** A browser node's live page as it looks now (in the editor; elsewhere a browser shows its address bar). */
  pages?: (id: string) => Image | undefined;
  /** What a script node's script gave (in the editor; elsewhere a script shows its stand-in). */
  scripts?: (id: string) => ScriptOutput | undefined;
}

const list = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

/** Corner radii [top-left, top-right, bottom-right, bottom-left], capped to the box. */
function radii(p: NodeProps, vars: Vars, box: Box): [number, number, number, number] {
  const r = p.cornerRadius;
  if (r === undefined) return [0, 0, 0, 0];
  const cap = Math.min(box.w, box.h) / 2;
  const one = (v: unknown) => Math.min(cap, Math.max(0, num(v, vars)));
  if (Array.isArray(r)) return [one(r[0]), one(r[1]), one(r[2]), one(r[3])];
  const n = one(r);
  return [n, n, n, n];
}

function rrect(ck: CanvasKit, box: Box, r: [number, number, number, number]) {
  // CanvasKit's rounded rect: rect followed by x/y radii for each corner (TL, TR, BR, BL).
  return Float32Array.of(box.x, box.y, box.x + box.w, box.y + box.h, r[0], r[0], r[1], r[1], r[2], r[2], r[3], r[3]);
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Paths parsed from SVG, by geometry (paths never change once made). */
const svgPaths = new WeakMap<CanvasKit, Map<string, Path | null>>();
function svgPath(ck: CanvasKit, d: string): Path | null {
  let byD = svgPaths.get(ck);
  if (!byD) svgPaths.set(ck, (byD = new Map()));
  if (byD.has(d)) return byD.get(d)!;
  const path = ck.Path.MakeFromSVGString(d);
  byD.set(d, path);
  if (byD.size > 2000) {
    const [k, old] = byD.entries().next().value!;
    byD.delete(k);
    old?.delete();
  }
  return path;
}

/** A path's commands moved by an affine matrix [a, c, tx, b, d, ty] (x' = a·x + c·y + tx). */
function transformCmds(ck: CanvasKit, cmds: Float32Array, m: [number, number, number, number, number, number]): Float32Array {
  const out = Float32Array.from(cmds);
  const pts: Record<number, number> = { [ck.MOVE_VERB]: 1, [ck.LINE_VERB]: 1, [ck.QUAD_VERB]: 2, [ck.CONIC_VERB]: 2, [ck.CUBIC_VERB]: 3, [ck.CLOSE_VERB]: 0 };
  for (let i = 0; i < out.length; ) {
    const verb = out[i++]!;
    const n = pts[verb] ?? 0;
    for (let k = 0; k < n; k++, i += 2) {
      const [x, y] = [out[i]!, out[i + 1]!];
      out[i] = m[0] * x + m[1] * y + m[2];
      out[i + 1] = m[3] * x + m[4] * y + m[5];
    }
    if (verb === ck.CONIC_VERB) i++; // its weight
  }
  return out;
}

/**
 * A node's outline in page coordinates (a new Path the caller deletes). Null for a path without
 * geometry.
 */
function outline(ck: CanvasKit, node: TreeNode, vars: Vars, box: Box): { path: Path } | null {
  const p = node.props;
  const b = new ck.PathBuilder();
  try {
    let fillType = ck.FillType.Winding;
    switch (node.type) {
      case "ellipse": {
        const inner = Math.max(0, Math.min(1, num(p.innerRadius, vars, 0)));
        const start = num(p.startAngle, vars, 0);
        const sweep = Math.max(-360, Math.min(360, num(p.sweepAngle, vars, 360)));
        const oval = ck.XYWHRect(box.x, box.y, box.w, box.h);
        const iw = box.w * inner;
        const ih = box.h * inner;
        const innerOval = ck.XYWHRect(box.x + (box.w - iw) / 2, box.y + (box.h - ih) / 2, iw, ih);
        if (Math.abs(sweep) >= 360) {
          b.addOval(oval);
          if (inner > 0) {
            b.addOval(innerOval, true);
            fillType = ck.FillType.EvenOdd;
          }
        } else {
          // Angles run counter-clockwise from the right; CanvasKit's run clockwise.
          b.arcToOval(oval, -start, -sweep, true);
          if (inner > 0) b.arcToOval(innerOval, -start - sweep, sweep, false);
          else b.lineTo(box.x + box.w / 2, box.y + box.h / 2);
          b.close();
        }
        break;
      }
      case "polygon": {
        // Without a count Pen draws nothing.
        const count = Math.round(num(p.polygonCount, vars, 0));
        if (count < 3) return null;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const pts: [number, number][] = [];
        for (let i = 0; i < count; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
          pts.push([cx + (Math.cos(a) * box.w) / 2, cy + (Math.sin(a) * box.h) / 2]);
        }
        const r = Math.max(0, num(p.cornerRadius, vars, 0));
        if (!r) b.addPolygon(pts.flat(), true);
        else {
          // Rounded corners: start halfway along the last side, then round each corner towards the next.
          const [lx, ly] = pts[count - 1]!;
          b.moveTo((lx + pts[0]![0]) / 2, (ly + pts[0]![1]) / 2);
          for (let i = 0; i < count; i++) {
            const [x1, y1] = pts[i]!;
            const [x2, y2] = pts[(i + 1) % count]!;
            const side = Math.hypot(x2 - x1, y2 - y1);
            b.arcToTangent(x1, y1, x2, y2, Math.min(r, side / 2));
          }
          b.close();
        }
        break;
      }
      case "line":
        // A line runs from its box's top-left corner to its bottom-right.
        b.moveTo(box.x, box.y);
        b.lineTo(box.x + box.w, box.y + box.h);
        break;
      case "path": {
        const src = typeof p.geometry === "string" ? svgPath(ck, p.geometry) : null;
        if (!src) return null;
        const bounds = src.getBounds();
        const vb = Array.isArray(p.viewBox) && p.viewBox.length === 4 ? p.viewBox : [bounds[0]!, bounds[1]!, bounds[2]! - bounds[0]!, bounds[3]! - bounds[1]!];
        const sx = vb[2] ? box.w / vb[2] : 1;
        const sy = vb[3] ? box.h / vb[3] : 1;
        const moved = ck.Path.MakeFromCmds(transformCmds(ck, src.toCmds(), [sx, 0, box.x - vb[0]! * sx, 0, sy, box.y - vb[1]! * sy]));
        if (!moved) return null;
        if (p.fillRule === "evenodd") moved.setFillType(ck.FillType.EvenOdd);
        return { path: moved };
      }
      default:
        b.addRRect(rrect(ck, box, radii(p, vars, box)));
    }
    const path = b.detach();
    path.setFillType(fillType);
    return { path };
  } finally {
    b.delete();
  }
}

/** Whether a node is an open line (a line, or a path without its end joined back): stroked along, not around. */
const isOpenPath = (node: TreeNode) =>
  node.type === "line" || (node.type === "path" && typeof node.props.geometry === "string" && !/z\s*$/i.test(node.props.geometry.trim()));

/** Decoded pictures by url (a url's bytes never change in a document, so each is decoded once). Null: not a picture. */
const pictures = new WeakMap<CanvasKit, Map<string, Image | null>>();
function picture(ck: CanvasKit, assets: Assets, url: string): Image | null {
  let byUrl = pictures.get(ck);
  if (!byUrl) pictures.set(ck, (byUrl = new Map()));
  if (byUrl.has(url)) return byUrl.get(url)!;
  const bytes = assets(url);
  // Not in this document (yet): try again next time.
  if (!bytes) return null;
  const image = ck.MakeImageFromEncoded(bytes);
  byUrl.set(url, image);
  return image;
}

/** A picture's shader, placed in `box` by the fill's mode (and crop). Null when there is no picture to show. */
function pictureShader(ck: CanvasKit, fill: ImageFill, assets: Assets, box: Box): Shader | null {
  if (!isLocalUrl(fill.url)) return null;
  const image = picture(ck, assets, fill.url);
  if (!image) return null;
  // The crop: the part of the picture shown, in its 0..1 space (the inverse of the fill's transform).
  let [cx, cy, cw, ch] = [0, 0, 1, 1];
  const t = fill.transform;
  if (Array.isArray(t) && t.length === 6 && t[0] && t[3]) {
    cw = 1 / t[0];
    ch = 1 / t[3];
    cx = -t[4] * cw;
    cy = -t[5] * ch;
  }
  const [iw, ih] = [image.width() * cw, image.height() * ch];
  let [sx, sy] = [box.w / iw, box.h / ih];
  const mode = fill.mode ?? "cover";
  if (mode !== "stretch") sx = sy = mode === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const tx = box.x + (box.w - iw * sx) / 2 - cx * image.width() * sx;
  const ty = box.y + (box.h - ih * sy) / 2 - cy * image.height() * sy;
  return image.makeShaderOptions(ck.TileMode.Decal, ck.TileMode.Decal, ck.FilterMode.Linear, ck.MipmapMode.Linear, [sx, 0, tx, 0, sy, ty, 0, 0, 1]);
}

/** A gradient's shader. Positions are in the box's 0..1 space; rotation runs counter-clockwise from "up". */
function gradientShader(ck: CanvasKit, f: Extract<Fill, { type: "gradient" }>, vars: Vars, box: Box): Shader | null {
  const stops = [...list(f.colors)]
    .map((s) => ({ color: (() => { try { return colorOf(s.color, vars); } catch { return null; } })(), at: Math.max(0, Math.min(1, num(s.position, vars))) }))
    .filter((s): s is { color: [number, number, number, number]; at: number } => !!s.color)
    .sort((a, b) => a.at - b.at);
  if (!stops.length) return null;
  if (stops.length === 1) stops.push({ ...stops[0]! });
  const colors = stops.map((s) => ck.Color4f(...s.color));
  const positions = stops.map((s) => s.at);
  const cx = f.center?.x ?? 0.5;
  const cy = f.center?.y ?? 0.5;
  const sw = num(f.size?.width, vars, 1);
  const sh = num(f.size?.height, vars, 1);
  const r = num(f.rotation, vars, 0);
  // From the box's 0..1 space to the page.
  const toBox = [box.w, 0, box.x, 0, box.h, box.y, 0, 0, 1];
  const type = f.gradientType ?? "linear";
  if (type === "linear") {
    // The gradient runs along the direction `rotation` points (0: up), over `size.height`.
    const dx = -Math.sin(deg(r)) * (sh / 2);
    const dy = -Math.cos(deg(r)) * (sh / 2);
    return ck.Shader.MakeLinearGradient([cx - dx, cy - dy], [cx + dx, cy + dy], colors, positions, ck.TileMode.Clamp, toBox);
  }
  // Radial and angular: around the centre, an ellipse `size` across, turned by `rotation`.
  const c = Math.cos(deg(-r));
  const s = Math.sin(deg(-r));
  const local: number[] = multiply(toBox, [c * sw, -s * sh, cx, s * sw, c * sh, cy, 0, 0, 1]);
  if (type === "radial") return ck.Shader.MakeRadialGradient([0, 0], 0.5, colors, positions, ck.TileMode.Clamp, local);
  // Angular: starts at "up" and runs clockwise.
  return ck.Shader.MakeSweepGradient(0, 0, colors, positions, ck.TileMode.Clamp, multiply(local, [0, 1, 0, -1, 0, 0, 0, 0, 1]));
}

/** 3×3 matrices, row-major. */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!;
  return out;
}

const BLEND: Partial<Record<BlendMode, keyof CanvasKit["BlendMode"]>> = {
  darken: "Darken",
  multiply: "Multiply",
  colorBurn: "ColorBurn",
  light: "Lighten",
  screen: "Screen",
  linearDodge: "Plus",
  colorDodge: "ColorDodge",
  overlay: "Overlay",
  softLight: "SoftLight",
  hardLight: "HardLight",
  difference: "Difference",
  exclusion: "Exclusion",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

/**
 * Sets `paint` to one fill. "missing" for a picture that can't be shown (the caller draws a
 * placeholder); false for a fill that draws nothing (switched off, not drawable yet, or unresolvable).
 */
function setFill(c: DrawContext, paint: CKPaint, f: Fill, vars: Vars, box: Box): boolean | "missing" {
  const { ck } = c;
  if (!isEnabled(f, vars)) return false;
  paint.setShader(null);
  paint.setAlphaf(1);
  const blend = typeof f === "object" && f.blendMode ? BLEND[f.blendMode] : undefined;
  paint.setBlendMode(blend ? (ck.BlendMode[blend] as typeof ck.BlendMode.SrcOver) : ck.BlendMode.SrcOver);
  try {
    if (typeof f === "string" || f.type === "color") {
      paint.setColor(ck.Color4f(...colorOf(typeof f === "string" ? f : f.color, vars)));
      return true;
    }
    const opacity = Math.max(0, Math.min(1, num((f as { opacity?: unknown }).opacity, vars, 1)));
    let shader: Shader | null = null;
    if (f.type === "gradient") shader = gradientShader(ck, f, vars, box);
    else if (f.type === "image") {
      shader = pictureShader(ck, f, c.assets, box);
      if (!shader) return "missing";
    }
    if (!shader) return false;
    paint.setColor(ck.Color4f(1, 1, 1, opacity));
    paint.setShader(shader);
    shader.delete();
    return true;
  } catch {
    return false;
  }
}

/** A picture still to come (or one this document doesn't have): a hatched placeholder in the shape. */
function drawPlaceholder(c: DrawContext, canvas: Canvas, shape: Path, box: Box): void {
  const { ck } = c;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.Color4f(...colorOf(PLACEHOLDER, {})));
  canvas.drawPath(shape, paint);
  canvas.save();
  canvas.clipPath(shape, ck.ClipOp.Intersect, true);
  paint.setColor(ck.Color4f(...colorOf(PLACEHOLDER_INK, {})));
  paint.setAlphaf(0.18);
  paint.setStrokeWidth(1);
  paint.setStyle(ck.PaintStyle.Stroke);
  for (let d = -box.h; d < box.w; d += 16) canvas.drawLine(box.x + d, box.y + box.h, box.x + d + box.h, box.y, paint);
  canvas.restore();
  paint.delete();
}

/** A stroke's width on each side: [top, right, bottom, left]. */
export function strokeSides(width: unknown, vars: Vars): [number, number, number, number] {
  const one = (v: unknown) => Math.max(0, num(v, vars));
  if (width && typeof width === "object" && !Array.isArray(width)) {
    const w = width as Record<string, unknown>;
    return [one(w.top), one(w.right), one(w.bottom), one(w.left)];
  }
  if (Array.isArray(width)) return [one(width[0]), one(width[1]), one(width[2]), one(width[3])];
  // No width, no stroke (as in Pen).
  const w = one(width);
  return [w, w, w, w];
}

const shadows = (p: NodeProps, vars: Vars, kind: "inner" | "outer") =>
  list(p.effect).filter((e): e is Extract<Effect, { type: "shadow" }> => !!e && e.type === "shadow" && isEnabled(e, vars) && (e.shadowType ?? "outer") === kind);

/** The variables in force at node `id` (the themes its ancestors set), from the page's. */
export function varsAt(page: TreeNode, id: string, vars: Vars): Vars {
  const walk = (n: TreeNode, v: Vars): Vars | undefined => {
    const here = withTheme(v, n.props.theme);
    if (n.id === id) return here;
    for (const c of n.children) {
      const hit = walk(c, here);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(page, vars) ?? vars;
}

/** Draws `node` and its children at their page coordinates on `canvas`. */
export function drawNode(c: DrawContext, canvas: Canvas, node: TreeNode): void {
  const { ck, boxes } = c;
  const vars = withTheme(c.vars, node.props.theme);
  const here = vars === c.vars ? c : { ...c, vars };
  const p = node.props;
  const box = boxes.get(node.id);
  if (isOff(p, vars)) return;
  if (!box) {
    for (const child of node.children) drawNode(here, canvas, child);
    return;
  }
  const saved = canvas.getSaveCount();
  // Everything this node changes (rotation, flips, clips) is undone when it is drawn.
  canvas.save();
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  const geo = outline(ck, node, vars, box);
  try {
    // The whole node: opacity, layer blur, rotation and flips.
    const opacity = Math.max(0, Math.min(1, num(p.opacity, vars, 1)));
    const layerBlur = list(p.effect).find((e) => e?.type === "blur" && isEnabled(e, vars)) as { radius?: unknown } | undefined;
    const blurRadius = layerBlur ? num(layerBlur.radius, vars, 0) : 0;
    if (opacity < 1 || blurRadius > 0) {
      const layer = new ck.Paint();
      layer.setAlphaf(opacity);
      const filter = blurRadius > 0 ? ck.ImageFilter.MakeBlur(blurRadius / 2, blurRadius / 2, ck.TileMode.Decal, null) : null;
      if (filter) layer.setImageFilter(filter);
      canvas.saveLayer(layer);
      filter?.delete();
      layer.delete();
    }
    const turn = num(p.rotation, vars, 0);
    if (turn) canvas.rotate(-turn, box.x, box.y);
    const flipX = resolveOr(p.flipX, vars, false) === true;
    const flipY = resolveOr(p.flipY, vars, false) === true;
    // Flips mirror the node about its top-left corner, the point it also turns around (as in Pen).
    if (flipX || flipY) {
      canvas.translate(box.x, box.y);
      canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      canvas.translate(-box.x, -box.y);
    }

    const graphic = node.type !== "text" && node.type !== "icon" && node.type !== "group";
    const shape = geo?.path;
    const open = isOpenPath(node);

    // Outer shadows: the shape, moved and blurred (Pen ignores a shadow's `spread`).
    if (shape && graphic && !open) {
      for (const s of shadows(p, vars, "outer")) {
        try {
          paint.setColor(ck.Color4f(...colorOf(s.color ?? "#00000040", vars)));
        } catch {
          continue;
        }
        const blur = num(s.blur, vars, 0);
        const mask = blur > 0 ? ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, blur / 2, true) : null;
        paint.setMaskFilter(mask);
        canvas.save();
        canvas.translate(num(s.offset?.x, vars), num(s.offset?.y, vars));
        canvas.drawPath(shape, paint);
        canvas.restore();
        paint.setMaskFilter(null);
        mask?.delete();
      }
    }

    // Background blur: what's behind, blurred inside the shape.
    const backdrop = list(p.effect).find((e) => e?.type === "background_blur" && isEnabled(e, vars)) as { radius?: unknown } | undefined;
    if (shape && backdrop && !open) {
      const r = num(backdrop.radius, vars, 0);
      if (r > 0) {
        const filter = ck.ImageFilter.MakeBlur(r / 2, r / 2, ck.TileMode.Clamp, null);
        canvas.save();
        canvas.clipPath(shape, ck.ClipOp.Intersect, true);
        canvas.saveLayer(undefined, null, filter);
        canvas.restore();
        canvas.restore();
        filter.delete();
      }
    }

    // Fills, bottom to top.
    if (shape && graphic && !open) {
      for (const f of list(p.fill)) {
        const set = setFill(here, paint, f, vars, box);
        if (set === "missing") drawPlaceholder(here, canvas, shape, box);
        else if (set) canvas.drawPath(shape, paint);
      }
      paint.setShader(null);
      paint.setBlendMode(ck.BlendMode.SrcOver);
    }

    // Inner shadows: the outside of the shape, moved and blurred, seen through the shape.
    if (shape && graphic && !open) {
      const inner = shadows(p, vars, "inner");
      if (inner.length) {
        canvas.save();
        canvas.clipPath(shape, ck.ClipOp.Intersect, true);
        for (const s of inner) {
          try {
            paint.setColor(ck.Color4f(...colorOf(s.color ?? "#00000040", vars)));
          } catch {
            continue;
          }
          const blur = num(s.blur, vars, 0);
          const mask = blur > 0 ? ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, blur / 2, true) : null;
          paint.setMaskFilter(mask);
          const rb = new ck.PathBuilder();
          const m = blur * 2 + 100;
          rb.addRect(ck.XYWHRect(box.x - m, box.y - m, box.w + 2 * m, box.h + 2 * m));
          rb.addPath(shape);
          const ring = rb.detach();
          rb.delete();
          ring.setFillType(ck.FillType.EvenOdd);
          canvas.save();
          canvas.translate(num(s.offset?.x, vars), num(s.offset?.y, vars));
          canvas.drawPath(ring, paint);
          canvas.restore();
          ring.delete();
          paint.setMaskFilter(null);
          mask?.delete();
        }
        canvas.restore();
      }
    }

    if (node.type === "icon") drawIcon(here, canvas, p, box);
    if (node.type === "text") drawText(here, canvas, p, box);
    if (node.type === "note" || node.type === "prompt" || node.type === "context") drawCard(here, canvas, node, box);
    if (node.type === "script" || node.type === "browser") drawStandIn(here, canvas, node, box);

    if (node.children.length) {
      canvas.save();
      if (shape && resolveOr(p.clip, vars, false) === true) canvas.clipPath(shape, ck.ClipOp.Intersect, true);
      for (const child of node.children) drawNode(here, canvas, child);
      canvas.restore();
    }

    if (shape && graphic) drawStrokes(here, canvas, node, shape, box, open);
  } finally {
    geo?.path.delete();
    paint.delete();
    canvas.restoreToCount(saved);
  }
}

/** A node's strokes: each stroke paint along its outline, inside, centred on or outside it. */
function drawStrokes(c: DrawContext, canvas: Canvas, node: TreeNode, shape: Path, box: Box, open: boolean): void {
  const { ck, vars } = c;
  const p = node.props;
  const fills = list(p.stroke);
  if (!fills.length) return;
  const sides = strokeSides(p.strokeWidth, vars);
  if (sides.every((v) => v <= 0)) return;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  // Centred on the outline unless the node says otherwise (Pen's default).
  const align = open ? "center" : (p.strokeAlignment ?? "center");
  try {
    for (const f of fills) {
      if (setFill(c, paint, f, vars, box) !== true) continue;
      const w = sides[0];
      if (sides.every((v) => v === w)) {
        paint.setStyle(ck.PaintStyle.Stroke);
        paint.setStrokeWidth(align === "center" ? w : w * 2);
        paint.setStrokeCap(p.strokeLinecap === "round" ? ck.StrokeCap.Round : p.strokeLinecap === "square" ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
        paint.setStrokeJoin(p.strokeLinejoin === "round" ? ck.StrokeJoin.Round : p.strokeLinejoin === "bevel" ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
        canvas.save();
        if (align === "inner") canvas.clipPath(shape, ck.ClipOp.Intersect, true);
        if (align === "outer") canvas.clipPath(shape, ck.ClipOp.Difference, true);
        canvas.drawPath(shape, paint);
        canvas.restore();
      } else {
        // Lines on some sides only (a divider, an underline): bands along those edges, inside the shape.
        const [t, r, b, l] = sides;
        paint.setStyle(ck.PaintStyle.Fill);
        canvas.save();
        canvas.clipPath(shape, ck.ClipOp.Intersect, true);
        if (t) canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, t), paint);
        if (r) canvas.drawRect(ck.XYWHRect(box.x + box.w - r, box.y, r, box.h), paint);
        if (b) canvas.drawRect(ck.XYWHRect(box.x, box.y + box.h - b, box.w, b), paint);
        if (l) canvas.drawRect(ck.XYWHRect(box.x, box.y, l, box.h), paint);
        canvas.restore();
      }
    }
  } finally {
    paint.delete();
  }
}

/** Text: its paragraph laid out to the box, placed by `textAlignVertical` when the box is fixed. */
function drawText(c: DrawContext, canvas: Canvas, p: NodeProps, box: Box): void {
  const { ck, vars } = c;
  let para;
  try {
    para = c.text.paragraph(p, vars);
  } catch {
    return;
  }
  const auto = (p.textGrowth ?? "auto") === "auto";
  para.layout(auto ? 1e7 : Math.max(1, box.w));
  const h = para.getHeight();
  const v = p.textAlignVertical ?? "top";
  const dy = p.textGrowth === "fixed-width-height" ? (v === "middle" ? (box.h - h) / 2 : v === "bottom" ? box.h - h : 0) : 0;
  // Auto text is drawn at its own width, so alignment inside a wider paragraph doesn't move it.
  if (auto) para.layout(Math.max(1, Math.ceil(para.getMaxIntrinsicWidth())));
  canvas.drawParagraph(para, box.x, box.y + dy);
}

/**
 * An icon in its fill colour, scaled to fit its box and centred: Lucide's and Feather's lines, or a
 * glyph of an icon font (Material Symbols, Phosphor); a dashed square when the library has no such icon.
 */
function drawIcon(c: DrawContext, canvas: Canvas, p: NodeProps, box: Box): void {
  const { ck, vars } = c;
  const scale = Math.min(box.w, box.h) / ICON_GRID;
  if (scale <= 0) return;
  const library = String(resolveOr(p.library ?? "lucide", vars, "lucide")).toLowerCase();
  const name = String(resolveOr(p.icon ?? "", vars, ""));
  const face = iconFace(library, resolveOr(p.weight, vars, undefined));
  if (face && name && drawGlyph(c, canvas, p, box, face.family, face.weight, iconLigature(face, name))) return;
  const path = library === "lucide" || library === "feather" ? iconPath(ck, name, library) : null;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeCap(ck.StrokeCap.Round);
  paint.setStrokeJoin(ck.StrokeJoin.Round);
  paint.setColor(ck.Color4f(...textColor(p.fill, vars)));
  canvas.save();
  canvas.translate(box.x + (box.w - ICON_GRID * scale) / 2, box.y + (box.h - ICON_GRID * scale) / 2);
  canvas.scale(scale, scale);
  paint.setStrokeWidth(ICON_LINE);
  if (path) canvas.drawPath(path, paint);
  else {
    const dash = ck.PathEffect.MakeDash([3, 3], 0);
    paint.setPathEffect(dash);
    paint.setStrokeWidth(1.5);
    if (textColor(p.fill, vars)[3] === 0) paint.setColor(ck.Color4f(...colorOf(PLACEHOLDER_INK, {})));
    canvas.drawRRect(ck.RRectXY(ck.XYWHRect(3, 3, 18, 18), 3, 3), paint);
    dash.delete();
  }
  canvas.restore();
  paint.delete();
}

/** An icon font's glyph for `name` (by ligature), one em the size of the box's shorter side. False when it can't be drawn. */
function drawGlyph(c: DrawContext, canvas: Canvas, p: NodeProps, box: Box, family: string, weight: number, name: string): boolean {
  const size = Math.min(box.w, box.h);
  let para;
  try {
    para = c.text.paragraph({ content: name, fontFamily: family, fontWeight: String(weight), fontSize: size, lineHeight: 1, fill: p.fill }, c.vars);
  } catch {
    return false; // its font is still loading
  }
  para.layout(1e7);
  const w = para.getMaxIntrinsicWidth();
  // A name the font has no icon for comes out as letters, wider than the icon's square.
  if (w > size * 1.5) return false;
  canvas.drawParagraph(para, box.x + (box.w - w) / 2, box.y + (box.h - para.getHeight()) / 2);
  return true;
}

/** Note, prompt and context cards, as Pen draws them (measured from Pen at 358%). */
export const CARD = {
  note: { label: "Note", header: "#fdefd5", body: "#fef6e4", border: "#8a6a1e", ink: "#6e4c0b" },
  prompt: { label: "Prompt", header: "#c2e6fc", body: "#e1f3fd", border: "#1a99e8", ink: "#0e76c2" },
  context: { label: "Context", header: "#ffffff", body: "#efefef", border: "#7a7a7a", ink: "#2b2b2b" },
} as const;
/** The cards' font, header height, padding and corner radius. */
export const CARD_FONT = "JetBrains Mono";
const CARD_HEADER = 44;
const CARD_PAD = 12;
const CARD_RADIUS = 8;
/** A prompt card's footer: the model's name and the Run button (as in Pen). */
const RUN = { w: 76, h: 34, pad: 12, radius: 6, fill: "#7ab8de", ink: "#ffffff" };
/** The model a prompt card shows when it names none. */
export const CARD_MODEL = "claude-opus-5-5";

export const isCard = (type: string) => type === "note" || type === "prompt" || type === "context";

/** A card's text as drawn: its style and where it sits (page coordinates), for drawing and typing into. */
export function cardBody(node: TreeNode, box: Box): { props: NodeProps; box: Box } {
  const look = CARD[node.type as keyof typeof CARD];
  return {
    props: { content: node.props.content ?? "", fontFamily: CARD_FONT, fontSize: 14, fontWeight: "400", lineHeight: 1.5, fill: look.ink },
    box: { x: box.x + CARD_PAD, y: box.y + CARD_HEADER + CARD_PAD, w: Math.max(1, box.w - 2 * CARD_PAD), h: Math.max(1, box.h - CARD_HEADER - CARD_PAD) },
  };
}

/** Where a prompt card's Run button is (page coordinates). */
export function runButton(box: Box): Box {
  return { x: box.x + box.w - RUN.pad - RUN.w, y: box.y + box.h - RUN.pad - RUN.h, w: RUN.w, h: RUN.h };
}

/** A card's header (its kind and the arrow that changes it), page coordinates. */
export function cardHeader(box: Box): Box {
  return { x: box.x, y: box.y, w: box.w, h: CARD_HEADER };
}

/** "Opus 5.5" for claude-opus-5-5, as Pen names models on a prompt card. */
function shortModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id;
}

/** A note, prompt or context: a card with a header ("Note ⌄") over a dashed line, then its text. */
function drawCard(c: DrawContext, canvas: Canvas, node: TreeNode, box: Box): void {
  const { ck, vars } = c;
  const look = CARD[node.type as keyof typeof CARD];
  const card = ck.RRectXY(ck.XYWHRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1)), CARD_RADIUS, CARD_RADIUS);
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  canvas.save();
  canvas.clipRRect(card, ck.ClipOp.Intersect, true);
  paint.setColor(ck.Color4f(...colorOf(look.body, {})));
  canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, box.h), paint);
  paint.setColor(ck.Color4f(...colorOf(look.header, {})));
  canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, CARD_HEADER), paint);
  canvas.restore();
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  paint.setColor(ck.Color4f(...colorOf(look.border, {})));
  canvas.drawRRect(card, paint);
  const dash = ck.PathEffect.MakeDash([6, 4], 0);
  paint.setPathEffect(dash);
  canvas.drawLine(box.x + 1, box.y + CARD_HEADER, box.x + box.w - 1, box.y + CARD_HEADER, paint);
  paint.setPathEffect(null);
  dash.delete();
  try {
    const text = (content: string, weight: string) =>
      c.text.paragraph({ content, fontFamily: CARD_FONT, fontSize: 14, fontWeight: weight, lineHeight: 1.5, fill: look.ink }, {});
    const head = text(look.label, "500");
    head.layout(1e7);
    const hy = box.y + (CARD_HEADER - head.getHeight()) / 2;
    canvas.drawParagraph(head, box.x + CARD_PAD, hy);
    // The chevron after the label.
    const cx = box.x + CARD_PAD + head.getMaxIntrinsicWidth() + 8;
    const cy = box.y + CARD_HEADER / 2;
    const chevron = iconPath(ck, "chevron-down");
    if (chevron) {
      paint.setStrokeWidth(ICON_LINE);
      paint.setStrokeCap(ck.StrokeCap.Round);
      paint.setStrokeJoin(ck.StrokeJoin.Round);
      paint.setColor(ck.Color4f(...colorOf(look.ink, {})));
      canvas.save();
      canvas.translate(cx, cy - 6);
      canvas.scale(12 / ICON_GRID, 12 / ICON_GRID);
      canvas.drawPath(chevron, paint);
      canvas.restore();
    }
    const inner = cardBody(node, box);
    const body = text(String(resolveOr(node.props.content ?? "", vars, node.props.content ?? "")), "400");
    body.layout(inner.box.w);
    canvas.save();
    canvas.clipRect(ck.XYWHRect(box.x, box.y + CARD_HEADER, box.w, Math.max(0, box.h - CARD_HEADER)), ck.ClipOp.Intersect, true);
    canvas.drawParagraph(body, inner.box.x, inner.box.y);
    canvas.restore();
    if (node.type === "prompt") drawRunFooter(c, canvas, node, box, look.ink, paint);
  } catch {
    /* its font isn't loaded yet */
  }
  paint.delete();
}

/** A prompt card's footer: the model ("Opus 5.5 ⌄") and a Run button, at the bottom right. */
function drawRunFooter(c: DrawContext, canvas: Canvas, node: TreeNode, box: Box, ink: string, paint: CKPaint): void {
  const { ck } = c;
  const run = runButton(box);
  paint.setStyle(ck.PaintStyle.Fill);
  paint.setPathEffect(null);
  paint.setColor(ck.Color4f(...colorOf(RUN.fill, {})));
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(run.x, run.y, run.w, run.h), RUN.radius, RUN.radius), paint);
  // The play triangle, then "Run".
  const tx = run.x + 14;
  const ty = run.y + run.h / 2;
  paint.setColor(ck.Color4f(...colorOf(RUN.ink, {})));
  const tb = new ck.PathBuilder();
  tb.moveTo(tx, ty - 5).lineTo(tx + 8, ty).lineTo(tx, ty + 5).close();
  const tri = tb.detachAndDelete();
  canvas.drawPath(tri, paint);
  tri.delete();
  const label = c.text.paragraph({ content: "Run", fontFamily: CARD_FONT, fontSize: 14, fontWeight: "500", lineHeight: 1.5, fill: RUN.ink }, {});
  label.layout(1e7);
  canvas.drawParagraph(label, tx + 14, ty - label.getHeight() / 2);
  const model = c.text.paragraph(
    { content: shortModel(String(resolveOr(node.props.model ?? CARD_MODEL, c.vars, CARD_MODEL))), fontFamily: CARD_FONT, fontSize: 14, fontWeight: "500", lineHeight: 1.5, fill: ink },
    {},
  );
  model.layout(1e7);
  const mw = model.getMaxIntrinsicWidth();
  const mx = run.x - 12 - 18 - mw;
  canvas.drawParagraph(model, mx, ty - model.getHeight() / 2);
  const chevron = iconPath(ck, "chevron-down");
  if (chevron) {
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setStrokeWidth(ICON_LINE);
    paint.setStrokeCap(ck.StrokeCap.Round);
    paint.setStrokeJoin(ck.StrokeJoin.Round);
    paint.setColor(ck.Color4f(...colorOf(ink, {})));
    canvas.save();
    canvas.translate(mx + mw + 4, ty - 6);
    canvas.scale(12 / ICON_GRID, 12 / ICON_GRID);
    canvas.drawPath(chevron, paint);
    canvas.restore();
  }
}

/** Script nodes in Pen's green; a script with no file says so under a "</>". */
const SCRIPT = { fill: "#51CA721A", ink: "#00C787" };
/** An empty browser node: no fill, a rounded outline and Pen's "Enter a URL" bar in the middle. */
const BROWSER = { outline: "#3a3b3e", bar: "#232426", barEdge: "#333436", hint: "#656668", icon: "#9a9a9a", ink: "#d4d4d8" };

/** A script or browser node, before (or instead of) what it shows: a script's output is its children. */
function drawStandIn(c: DrawContext, canvas: Canvas, node: TreeNode, box: Box): void {
  if (node.type === "browser") return drawBrowser(c, canvas, node, box);
  const out = node.props.scriptUri ? c.scripts?.(node.id) : undefined;
  if (out?.ok) return;
  if (out) return drawScriptError(c, canvas, out, box);
  const { ck } = c;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.Color4f(...colorOf(SCRIPT.fill, {})));
  canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, box.h), paint);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  paint.setColor(ck.Color4f(...colorOf(SCRIPT.ink, {})));
  canvas.drawRect(ck.XYWHRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1)), paint);
  try {
    const uri = node.props.scriptUri;
    const para = c.text.paragraph({ content: uri ? String(uri) : "No script file selected", fontSize: 14, fill: SCRIPT.ink, textAlign: "center" }, {});
    para.layout(Math.max(1, box.w - 16));
    const cy = box.y + box.h / 2;
    canvas.drawParagraph(para, box.x + 8, cy - para.getHeight() / 2 + 6);
    const code = iconPath(ck, "code");
    if (code) {
      paint.setStrokeWidth(ICON_LINE);
      paint.setStrokeCap(ck.StrokeCap.Round);
      paint.setStrokeJoin(ck.StrokeJoin.Round);
      canvas.save();
      canvas.translate(box.x + box.w / 2 - 8, cy - para.getHeight() / 2 - 18);
      canvas.scale(16 / ICON_GRID, 16 / ICON_GRID);
      canvas.drawPath(code, paint);
      canvas.restore();
    }
  } catch {
    /* its font isn't loaded yet */
  }
  paint.delete();
}

/** A script that didn't run, in Pen's red: what went wrong, where, and the lines around it. */
const SCRIPT_ERROR = { ink: "#DC1F3B", fill: "#DC1F3B1F", code: "#141414", codeInk: "#979797" };

function drawScriptError(c: DrawContext, canvas: Canvas, out: Extract<ScriptOutput, { ok: false }>, box: Box): void {
  const { ck } = c;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setColor(ck.Color4f(...colorOf(SCRIPT_ERROR.fill, {})));
  canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, box.h), paint);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  paint.setColor(ck.Color4f(...colorOf(SCRIPT_ERROR.ink, {})));
  canvas.drawRect(ck.XYWHRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1)), paint);
  canvas.save();
  canvas.clipRect(ck.XYWHRect(box.x, box.y, box.w, box.h), ck.ClipOp.Intersect, true);
  try {
    const pad = 10;
    const width = Math.max(1, box.w - 2 * pad);
    const para = (content: string, size: number, weight = "400", fill = SCRIPT_ERROR.ink, family?: string, align: "center" | "left" = "center", w = width) => {
      const t = c.text.paragraph({ content, fontSize: size, fontWeight: weight, fill, textAlign: align, lineHeight: 1.35, ...(family ? { fontFamily: family } : {}) }, {});
      t.layout(w);
      return t;
    };
    const title = para(out.kind === "missing" ? "Script not found" : out.title, 12);
    const body =
      out.kind === "missing"
        ? para(`We could not find "${out.file}" at this path. Check for typos or missing folders.`, 10)
        : para([out.message, ...out.stack].join("\n"), 10);
    const excerpt =
      out.kind === "error" && out.excerpt.length
        ? para(out.excerpt.map((l) => `${l.at ? ">" : " "} ${l.line}: ${l.text}`).join("\n"), 10, "400", SCRIPT_ERROR.codeInk, CARD_FONT, "left", Math.max(1, box.w - 6 * pad - 16))
        : null;
    const ICON = 14;
    const gap = 6;
    const block = excerpt ? excerpt.getHeight() + 16 : 0;
    const total = ICON + gap + title.getHeight() + 4 + body.getHeight() + (excerpt ? 20 + block : 0);
    // A missing file's message sits in the middle; an error's starts near the top to leave room for the code.
    let y = out.kind === "missing" ? box.y + Math.max(pad, (box.h - total) / 2) : box.y + pad;
    const x = box.x + pad;
    const icon = iconPath(ck, "circle-x");
    if (icon) {
      paint.setStrokeWidth(ICON_LINE);
      paint.setStrokeCap(ck.StrokeCap.Round);
      paint.setStrokeJoin(ck.StrokeJoin.Round);
      canvas.save();
      canvas.translate(box.x + box.w / 2 - ICON / 2, y);
      canvas.scale(ICON / ICON_GRID, ICON / ICON_GRID);
      canvas.drawPath(icon, paint);
      canvas.restore();
    }
    y += ICON + gap;
    canvas.drawParagraph(title, x, y);
    y += title.getHeight() + 4;
    canvas.drawParagraph(body, x, y);
    y += body.getHeight() + 20;
    if (excerpt) {
      paint.setStyle(ck.PaintStyle.Fill);
      paint.setColor(ck.Color4f(...colorOf(SCRIPT_ERROR.code, {})));
      // The code sits 30 in from the sides, as in Pen.
      canvas.drawRect(ck.XYWHRect(box.x + 3 * pad, y, Math.max(0, box.w - 6 * pad), block), paint);
      canvas.drawParagraph(excerpt, box.x + 3 * pad + 8, y + 8);
    }
  } catch {
    /* its font isn't loaded yet */
  }
  canvas.restore();
  paint.delete();
}

/** Where a browser node's address bar is (page coordinates): most of its width, in the middle. */
export function browserBar(box: Box): Box {
  const w = Math.min(box.w * 0.81, 972);
  const h = Math.min(86, box.h * 0.5);
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function drawBrowser(c: DrawContext, canvas: Canvas, node: TreeNode, box: Box): void {
  const { ck, vars } = c;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(1);
  paint.setColor(ck.Color4f(...colorOf(BROWSER.outline, {})));
  const r = num(Array.isArray(node.props.cornerRadius) ? node.props.cornerRadius[0] : (node.props.cornerRadius ?? 16), vars, 16);
  // A page that has loaded fills the node, inside its rounded corners.
  const live = node.props.url ? c.pages?.(node.id) : undefined;
  if (live) {
    canvas.save();
    canvas.clipRRect(ck.RRectXY(ck.XYWHRect(box.x, box.y, box.w, box.h), r, r), ck.ClipOp.Intersect, true);
    const look = new ck.Paint();
    look.setAntiAlias(true);
    canvas.drawImageRectOptions(live, ck.XYWHRect(0, 0, live.width(), live.height()), ck.XYWHRect(box.x, box.y, box.w, box.h), ck.FilterMode.Linear, ck.MipmapMode.Linear, look);
    look.delete();
    canvas.restore();
    paint.delete();
    return;
  }
  canvas.drawRRect(ck.RRectXY(ck.XYWHRect(box.x + 0.5, box.y + 0.5, Math.max(0, box.w - 1), Math.max(0, box.h - 1)), r, r), paint);
  const bar = browserBar(box);
  const pill = ck.RRectXY(ck.XYWHRect(bar.x, bar.y, bar.w, bar.h), bar.h / 2, bar.h / 2);
  paint.setStyle(ck.PaintStyle.Fill);
  paint.setColor(ck.Color4f(...colorOf(BROWSER.bar, {})));
  canvas.drawRRect(pill, paint);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(2);
  paint.setColor(ck.Color4f(...colorOf(BROWSER.barEdge, {})));
  canvas.drawRRect(pill, paint);
  const unit = bar.h / 86;
  const icon = (name: string, x: number, size: number) => {
    const path = iconPath(ck, name);
    if (!path) return;
    paint.setStrokeWidth(ICON_LINE);
    paint.setStrokeCap(ck.StrokeCap.Round);
    paint.setStrokeJoin(ck.StrokeJoin.Round);
    paint.setColor(ck.Color4f(...colorOf(BROWSER.icon, {})));
    canvas.save();
    canvas.translate(x, bar.y + (bar.h - size) / 2);
    canvas.scale(size / ICON_GRID, size / ICON_GRID);
    canvas.drawPath(path, paint);
    canvas.restore();
  };
  icon("globe", bar.x + 28 * unit, 36 * unit);
  icon("corner-down-left", bar.x + bar.w - 64 * unit, 32 * unit);
  try {
    // Shown without "https://" and a closing "/", as in Pen.
    const url = node.props.url ? String(node.props.url).replace(/^https?:\/\//i, "").replace(/\/$/, "") : "";
    const para = c.text.paragraph({ content: url || "Enter a URL", fontSize: 32 * unit, fill: url ? BROWSER.ink : BROWSER.hint }, {});
    para.layout(Math.max(1, bar.w - 180 * unit));
    canvas.drawParagraph(para, bar.x + 88 * unit, bar.y + (bar.h - para.getHeight()) / 2);
  } catch {
    /* its font isn't loaded yet */
  }
  paint.delete();
}

/** The fills a node paints (a list either way). */
export const fillsOf = (fills: Fills | undefined): Fill[] => list(fills);
