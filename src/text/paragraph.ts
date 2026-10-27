// Text as CanvasKit paragraphs, shared by layout (measuring) and drawing. Text styles are Pen's:
// fontFamily, fontSize, fontWeight ("normal", "bold", "600"), fontStyle, letterSpacing, lineHeight (a
// multiple of the size; the font's own when left out), textAlign, underline, strikethrough. Text is
// painted with its fill; text without one is invisible, as in Pen.
import type { CanvasKit, Paragraph } from "canvaskit-wasm";
import type { Fills, NodeProps, Vars } from "../doc/schema.js";
import { colorOf, resolveOr, type RGBA } from "../doc/values.js";
import { DEFAULT_FONT, FontsNeeded, type FontFace, type FontLibrary } from "./fonts.js";

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** A font weight as a number: "bold" → 700, "600" → 600. */
export function weightOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value ?? "normal").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (WEIGHTS[s] !== undefined) return WEIGHTS[s]!;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(1000, n)) : 400;
}

export function faceOf(props: NodeProps, vars: Vars): FontFace {
  const family = String(resolveOr(props.fontFamily ?? DEFAULT_FONT, vars, DEFAULT_FONT));
  const weight = weightOf(resolveOr(props.fontWeight, vars, "normal"));
  const style = String(resolveOr(props.fontStyle ?? "normal", vars, "normal")).toLowerCase();
  return { family, weight, italic: style === "italic" || style === "oblique" };
}

/** Whether a fill (one of a list) is switched on. */
export const isEnabled = (f: unknown, vars: Vars) =>
  !(f && typeof f === "object" && "enabled" in f && resolveOr((f as { enabled?: unknown }).enabled, vars, true) === false);

/** The colour text is painted in: its top switched-on colour fill (transparent when it has none). */
export function textColor(fill: Fills | undefined, vars: Vars): RGBA {
  const list = Array.isArray(fill) ? fill : fill === undefined ? [] : [fill];
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (!isEnabled(f, vars)) continue;
    try {
      if (typeof f === "string") return colorOf(f, vars);
      if (f && typeof f === "object" && f.type === "color") return colorOf(f.color, vars);
      if (f && typeof f === "object" && f.type === "gradient" && f.colors?.length) return colorOf(f.colors[0]!.color, vars);
    } catch {
      /* an unresolvable colour: try the next fill */
    }
  }
  return [0, 0, 0, 0];
}

const num = (v: unknown, vars: Vars, fallback: number) => {
  const r = Number(resolveOr(v, vars, fallback));
  return Number.isFinite(r) ? r : fallback;
};

const MAX_CACHED = 4000;

export class TextEngine {
  private cache = new Map<string, Paragraph>();

  constructor(
    readonly ck: CanvasKit,
    readonly fonts: FontLibrary,
  ) {}

  /**
   * The paragraph for a text node (or a note's, prompt's or context's text), not yet laid out to a
   * width. Throws FontsNeeded when its font isn't loaded, so the caller can load it and try again.
   */
  paragraph(props: NodeProps, vars: Vars, color?: RGBA): Paragraph {
    const face = faceOf(props, vars);
    if (!this.fonts.isLoaded(face)) throw new FontsNeeded([face]);
    const used = this.fonts.resolve(face);
    const size = num(props.fontSize, vars, 14);
    const lh = props.lineHeight === undefined ? undefined : num(props.lineHeight, vars, 0) || undefined;
    const letterSpacing = num(props.letterSpacing, vars, 0);
    const paint = color ?? textColor(props.fill, vars);
    const text = String(resolveOr(props.content ?? "", vars, props.content ?? ""));
    const align = props.textAlign ?? "left";
    const underline = resolveOr(props.underline, vars, false) === true;
    const strike = resolveOr(props.strikethrough, vars, false) === true;
    const k = JSON.stringify([text, used, size, lh, letterSpacing, paint, align, underline, strike]);
    const hit = this.cache.get(k);
    if (hit) {
      // Refresh its place so the most recently used paragraphs stay cached.
      this.cache.delete(k);
      this.cache.set(k, hit);
      return hit;
    }
    const ck = this.ck;
    const style = new ck.ParagraphStyle({
      textAlign:
        align === "center" ? ck.TextAlign.Center : align === "right" ? ck.TextAlign.Right : align === "justify" ? ck.TextAlign.Justify : ck.TextAlign.Left,
      textStyle: {
        color: ck.Color4f(...paint),
        fontFamilies: [used.family, DEFAULT_FONT],
        fontSize: size,
        fontStyle: {
          weight: { value: used.weight } as never,
          slant: used.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
        },
        letterSpacing,
        ...(lh !== undefined ? { heightMultiplier: lh, halfLeading: true } : {}),
        decoration: (underline ? ck.UnderlineDecoration : 0) | (strike ? ck.LineThroughDecoration : 0),
        decorationColor: ck.Color4f(...paint),
      },
    });
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(style, this.fonts.collection);
    builder.addText(text);
    const p = builder.build();
    builder.delete();
    this.cache.set(k, p);
    if (this.cache.size > MAX_CACHED) {
      const [oldKey, old] = this.cache.entries().next().value!;
      this.cache.delete(oldKey);
      old.delete();
    }
    return p;
  }
}
