// Text as CanvasKit paragraphs, shared by layout (measuring) and drawing.
import type { CanvasKit, Paragraph } from "canvaskit-wasm";
import type { NodeProps, Vars } from "../doc/schema.js";
import { colorOf, resolve } from "../doc/values.js";
import { DEFAULT_FONT, FontsNeeded, type FontFace, type FontLibrary } from "./fonts.js";

export function faceOf(props: NodeProps, vars: Vars): FontFace {
  const family = String(resolve(props.font ?? DEFAULT_FONT, vars));
  const weight = Number(resolve(props.weight ?? 400, vars));
  return { family, weight, italic: !!props.italic };
}

const MAX_CACHED = 4000;

export class TextEngine {
  private cache = new Map<string, Paragraph>();

  constructor(
    readonly ck: CanvasKit,
    readonly fonts: FontLibrary,
  ) {}

  /**
   * The paragraph for a text node, not yet laid out to a width. Throws FontsNeeded when its font
   * isn't loaded, so the caller can load it and try again.
   */
  paragraph(props: NodeProps, vars: Vars): Paragraph {
    const face = faceOf(props, vars);
    if (!this.fonts.isLoaded(face)) throw new FontsNeeded([face]);
    const used = this.fonts.resolve(face);
    const size = Number(resolve(props.size ?? 16, vars));
    const lineHeight = Number(resolve(props.lineHeight ?? 1.4, vars));
    const letterSpacing = Number(resolve(props.letterSpacing ?? 0, vars));
    const color = colorOf(props.color ?? "#000000", vars);
    let text = String(props.text ?? "");
    if (props.uppercase) text = text.toUpperCase();
    const align = props.textAlign ?? "left";
    const k = JSON.stringify([text, used, size, lineHeight, letterSpacing, color, align]);
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
        align === "center" ? ck.TextAlign.Center : align === "right" ? ck.TextAlign.Right : ck.TextAlign.Left,
      textStyle: {
        color: ck.Color4f(...color),
        fontFamilies: [used.family, DEFAULT_FONT],
        fontSize: size,
        fontStyle: {
          weight: { value: used.weight } as never,
          slant: used.italic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
        },
        letterSpacing,
        heightMultiplier: lineHeight,
        halfLeading: true,
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
