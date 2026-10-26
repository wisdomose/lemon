// Drawing the document with CanvasKit. Used for the editor's canvas and for the agent's screenshots,
// in Node and in the browser alike.
import type { Canvas, CanvasKit, Image, Paint as CKPaint } from "canvaskit-wasm";
import type { ImageFill, NodeProps, Paint, TreeNode, Vars } from "../doc/schema.js";
import type { Assets } from "../doc/assets.js";
import { ICON_GRID, ICON_LINE, iconPath } from "./icons.js";
import { colorOf, resolve } from "../doc/values.js";
import type { Box, Boxes } from "../layout/layout.js";
import type { TextEngine } from "../text/paragraph.js";

const PLACEHOLDER = "#d8d4cc";
const PLACEHOLDER_INK = "#8a857b";

function radii(p: NodeProps, vars: Vars, box: Box): [number, number, number, number] {
  const r = p.radius;
  if (r === undefined) return [0, 0, 0, 0];
  const cap = Math.min(box.w, box.h) / 2;
  const one = (v: unknown) => Math.min(cap, Math.max(0, Number(resolve(v, vars)) || 0));
  if (Array.isArray(r)) return [one(r[0]), one(r[1]), one(r[2]), one(r[3])];
  const n = one(r);
  return [n, n, n, n];
}

function rrect(ck: CanvasKit, box: Box, r: [number, number, number, number]) {
  const rect = ck.LTRBRect(box.x, box.y, box.x + box.w, box.y + box.h);
  // CanvasKit's rounded rect: rect followed by x/y radii for each corner (TL, TR, BR, BL).
  return Float32Array.of(rect[0]!, rect[1]!, rect[2]!, rect[3]!, r[0], r[0], r[1], r[1], r[2], r[2], r[3], r[3]);
}

/** Decoded pictures by asset id (assets never change, so each is decoded once). Null: not a picture. */
const pictures = new WeakMap<CanvasKit, Map<string, Image | null>>();
function picture(ck: CanvasKit, assets: Assets, id: string): Image | null {
  let byId = pictures.get(ck);
  if (!byId) pictures.set(ck, (byId = new Map()));
  if (byId.has(id)) return byId.get(id)!;
  const bytes = assets(id);
  // Not in this document (yet): try again next time.
  if (!bytes) return null;
  const image = ck.MakeImageFromEncoded(bytes);
  byId.set(id, image);
  return image;
}

/** A picture's shader, placed in `box` by the fill's fit. False when there is no picture to show. */
function setPicture(ck: CanvasKit, paint: CKPaint, fill: ImageFill, assets: Assets, box: Box): boolean {
  const image = picture(ck, assets, fill.asset);
  if (!image) return false;
  const [iw, ih] = [image.width(), image.height()];
  let [sx, sy] = [box.w / iw, box.h / ih];
  if (fill.fit !== "stretch") sx = sy = fill.fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const tx = box.x + (box.w - iw * sx) / 2;
  const ty = box.y + (box.h - ih * sy) / 2;
  const shader = image.makeShaderOptions(ck.TileMode.Decal, ck.TileMode.Decal, ck.FilterMode.Linear, ck.MipmapMode.Linear, [sx, 0, tx, 0, sy, ty, 0, 0, 1]);
  paint.setColor(ck.WHITE);
  paint.setShader(shader);
  shader.delete();
  return true;
}

/** Sets `paint` to a fill. False for a picture that can't be shown (the caller draws a placeholder). */
function setPaint(ck: CanvasKit, paint: CKPaint, fill: Paint, vars: Vars, box: Box, assets: Assets): boolean {
  if (typeof fill === "string") {
    paint.setColor(ck.Color4f(...colorOf(fill, vars)));
    paint.setShader(null);
    return true;
  }
  if (fill.type === "image") return setPicture(ck, paint, fill, assets, box);
  const a = ((fill.angle ?? 0) * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = Math.cos(a);
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const stops = [...fill.stops].sort((s, t) => s.at - t.at);
  const shader = ck.Shader.MakeLinearGradient(
    [cx - dx * half, cy - dy * half],
    [cx + dx * half, cy + dy * half],
    stops.map((s) => ck.Color4f(...colorOf(s.color, vars))),
    stops.map((s) => Math.min(1, Math.max(0, s.at))),
    ck.TileMode.Clamp,
  );
  paint.setColor(ck.WHITE);
  paint.setShader(shader);
  shader.delete();
  return true;
}

export interface DrawContext {
  ck: CanvasKit;
  text: TextEngine;
  vars: Vars;
  boxes: Boxes;
  /** The document's pictures. */
  assets: Assets;
}

/** Draws `node` and its children at their page coordinates on `canvas`. */
export function drawNode(c: DrawContext, canvas: Canvas, node: TreeNode): void {
  const { ck, vars, boxes } = c;
  const p = node.props;
  const box = boxes.get(node.id);
  if (p.visible === false) return;
  if (!box) {
    for (const child of node.children) drawNode(c, canvas, child);
    return;
  }
  const saved = canvas.getSaveCount();
  const opacity = p.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(resolve(p.opacity, vars))));
  if (opacity < 1) {
    const layer = new ck.Paint();
    layer.setAlphaf(opacity);
    canvas.saveLayer(layer);
    layer.delete();
  }
  const turn = Number(resolve(p.rotation ?? 0, vars)) || 0;
  if (turn) {
    canvas.save();
    canvas.rotate(-turn, box.x, box.y);
  }
  const r = radii(p, vars, box);
  const shape = rrect(ck, box, r);
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  try {
    if (p.shadow && node.type !== "text" && node.type !== "icon") {
      const s = p.shadow;
      paint.setColor(ck.Color4f(...colorOf(s.color, vars)));
      const blur = ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, Math.max(0.1, s.blur / 2), true);
      paint.setMaskFilter(blur);
      const moved = { ...box, x: box.x + s.x, y: box.y + s.y };
      if (node.type === "ellipse") canvas.drawOval(ck.XYWHRect(moved.x, moved.y, moved.w, moved.h), paint);
      else canvas.drawRRect(rrect(ck, moved, r), paint);
      paint.setMaskFilter(null);
      blur.delete();
    }

    const isPicture = typeof p.fill === "object" && p.fill.type === "image";
    const shown = p.fill !== undefined && node.type !== "text" && setPaint(ck, paint, p.fill, vars, box, c.assets);
    if (shown) {
      if (node.type === "ellipse") canvas.drawOval(ck.XYWHRect(box.x, box.y, box.w, box.h), paint);
      else if (node.type !== "icon") canvas.drawRRect(shape, paint);
      paint.setShader(null);
    } else if (node.type === "image" || isPicture) {
      // A photo still to come (or a picture this document doesn't have): a hatched placeholder.
      paint.setShader(null);
      paint.setColor(ck.Color4f(...colorOf(PLACEHOLDER, vars)));
      canvas.drawRRect(shape, paint);
      canvas.save();
      canvas.clipRRect(shape, ck.ClipOp.Intersect, true);
      paint.setColor(ck.Color4f(...colorOf(PLACEHOLDER_INK, vars)));
      paint.setAlphaf(0.18);
      paint.setStrokeWidth(1);
      paint.setStyle(ck.PaintStyle.Stroke);
      for (let d = -box.h; d < box.w; d += 16) canvas.drawLine(box.x + d, box.y + box.h, box.x + d + box.h, box.y, paint);
      paint.setStyle(ck.PaintStyle.Fill);
      paint.setAlphaf(1);
      canvas.restore();
      if (node.type === "image" && p.description && box.w > 60 && box.h > 30) {
        const para = c.text.paragraph(
          { text: `Photo: ${p.description}`, size: Math.max(11, Math.min(16, box.w / 28)), color: PLACEHOLDER_INK, textAlign: "center", lineHeight: 1.3 },
          {},
        );
        const w = Math.max(10, box.w - 32);
        para.layout(w);
        const h = para.getHeight();
        if (h < box.h - 16) canvas.drawParagraph(para, box.x + 16, box.y + (box.h - h) / 2);
      }
    }

    if (node.type === "icon") drawIcon(c, canvas, p, box);

    if (node.type === "text") {
      const para = c.text.paragraph(p, vars);
      para.layout(Math.max(1, box.w));
      canvas.save();
      if (p.clip !== false) canvas.clipRect(ck.XYWHRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4), ck.ClipOp.Intersect, true);
      canvas.drawParagraph(para, box.x, box.y);
      canvas.restore();
    }

    if (node.children.length) {
      canvas.save();
      if (p.clip) canvas.clipRRect(shape, ck.ClipOp.Intersect, true);
      for (const child of node.children) drawNode(c, canvas, child);
      canvas.restore();
    }

    // Strokes sit inside the box, as in design tools, so they never change the layout.
    const sides = p.stroke ? strokeSides(p.stroke.width, vars) : undefined;
    if (p.stroke && sides && sides.some((v) => v > 0)) {
      paint.setColor(ck.Color4f(...colorOf(p.stroke.color, vars)));
      const w = sides[0];
      if (sides.every((v) => v === w)) {
        paint.setStyle(ck.PaintStyle.Stroke);
        paint.setStrokeWidth(w);
        const inner = { x: box.x + w / 2, y: box.y + w / 2, w: Math.max(0, box.w - w), h: Math.max(0, box.h - w) };
        if (node.type === "ellipse") canvas.drawOval(ck.XYWHRect(inner.x, inner.y, inner.w, inner.h), paint);
        else canvas.drawRRect(rrect(ck, inner, r.map((v) => Math.max(0, v - w / 2)) as [number, number, number, number]), paint);
      } else {
        // Lines on some sides only (a divider, an underline): bands along those edges, inside the shape.
        const [t, rt, b, l] = sides;
        paint.setStyle(ck.PaintStyle.Fill);
        canvas.save();
        canvas.clipRRect(shape, ck.ClipOp.Intersect, true);
        if (t) canvas.drawRect(ck.XYWHRect(box.x, box.y, box.w, t), paint);
        if (rt) canvas.drawRect(ck.XYWHRect(box.x + box.w - rt, box.y, rt, box.h), paint);
        if (b) canvas.drawRect(ck.XYWHRect(box.x, box.y + box.h - b, box.w, b), paint);
        if (l) canvas.drawRect(ck.XYWHRect(box.x, box.y, l, box.h), paint);
        canvas.restore();
      }
    }
  } finally {
    paint.delete();
    canvas.restoreToCount(saved);
  }
}

/** A stroke's width on each side: [top, right, bottom, left]. */
export function strokeSides(width: unknown, vars: Vars): [number, number, number, number] {
  const one = (v: unknown) => Math.max(0, Number(resolve(v, vars)) || 0);
  if (Array.isArray(width)) return [one(width[0]), one(width[1]), one(width[2]), one(width[3])];
  const w = one(width);
  return [w, w, w, w];
}

/** An icon: Lucide's lines in the icon's colour, scaled to fit its box and centred; a dashed square when unknown. */
function drawIcon(c: DrawContext, canvas: Canvas, p: NodeProps, box: Box): void {
  const { ck } = c;
  const scale = Math.min(box.w, box.h) / ICON_GRID;
  if (scale <= 0) return;
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeCap(ck.StrokeCap.Round);
  paint.setStrokeJoin(ck.StrokeJoin.Round);
  paint.setColor(ck.Color4f(...colorOf(p.color ?? "#000000", c.vars)));
  canvas.save();
  canvas.translate(box.x + (box.w - ICON_GRID * scale) / 2, box.y + (box.h - ICON_GRID * scale) / 2);
  canvas.scale(scale, scale);
  paint.setStrokeWidth(ICON_LINE);
  const path = p.icon ? iconPath(ck, p.icon) : null;
  if (path) canvas.drawPath(path, paint);
  else {
    const dash = ck.PathEffect.MakeDash([3, 3], 0);
    paint.setPathEffect(dash);
    paint.setStrokeWidth(1.5);
    canvas.drawRRect(ck.RRectXY(ck.XYWHRect(3, 3, 18, 18), 3, 3), paint);
    dash.delete();
  }
  canvas.restore();
  paint.delete();
}
