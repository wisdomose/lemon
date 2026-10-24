// Drawing the document with CanvasKit. Used for the editor's canvas and for the agent's screenshots,
// in Node and in the browser alike.
import type { Canvas, CanvasKit, Paint as CKPaint } from "canvaskit-wasm";
import type { NodeProps, Paint, TreeNode, Vars } from "../doc/schema.js";
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

function setPaint(ck: CanvasKit, paint: CKPaint, fill: Paint, vars: Vars, box: Box): void {
  if (typeof fill === "string") {
    paint.setColor(ck.Color4f(...colorOf(fill, vars)));
    paint.setShader(null);
    return;
  }
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
}

export interface DrawContext {
  ck: CanvasKit;
  text: TextEngine;
  vars: Vars;
  boxes: Boxes;
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
  const r = radii(p, vars, box);
  const shape = rrect(ck, box, r);
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  try {
    if (p.shadow && node.type !== "text") {
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

    if (node.type === "image") {
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
      if (p.description && box.w > 60 && box.h > 30) {
        const para = c.text.paragraph(
          { text: `Photo: ${p.description}`, size: Math.max(11, Math.min(16, box.w / 28)), color: PLACEHOLDER_INK, textAlign: "center", lineHeight: 1.3 },
          {},
        );
        const w = Math.max(10, box.w - 32);
        para.layout(w);
        const h = para.getHeight();
        if (h < box.h - 16) canvas.drawParagraph(para, box.x + 16, box.y + (box.h - h) / 2);
      }
    } else if (p.fill !== undefined) {
      setPaint(ck, paint, p.fill, vars, box);
      if (node.type === "ellipse") canvas.drawOval(ck.XYWHRect(box.x, box.y, box.w, box.h), paint);
      else if (node.type !== "text") canvas.drawRRect(shape, paint);
      paint.setShader(null);
    }

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

    if (p.stroke && p.stroke.width > 0) {
      const w = Number(resolve(p.stroke.width, vars));
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(w);
      paint.setColor(ck.Color4f(...colorOf(p.stroke.color, vars)));
      // Strokes sit inside the box, as in design tools, so they never change the layout.
      const inner = { x: box.x + w / 2, y: box.y + w / 2, w: Math.max(0, box.w - w), h: Math.max(0, box.h - w) };
      if (node.type === "ellipse") canvas.drawOval(ck.XYWHRect(inner.x, inner.y, inner.w, inner.h), paint);
      else canvas.drawRRect(rrect(ck, inner, r.map((v) => Math.max(0, v - w / 2)) as [number, number, number, number]), paint);
    }
  } finally {
    paint.delete();
    canvas.restoreToCount(saved);
  }
}
