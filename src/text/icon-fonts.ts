// Icon fonts, for Pen's icon libraries drawn as glyphs: Material Symbols (Outlined, Rounded, Sharp;
// from Google Fonts, which leaves them out of its catalogue) and Phosphor (its MIT-licensed web font,
// shipped with the app). Both name their icons by ligature: the text "home" in the font is the icon.
// Lucide and Feather are drawn from their own shape data instead (render/icons.ts).
import type { FontFace } from "./fonts.js";

const MATERIAL: Record<string, string> = {
  "material symbols outlined": "Material Symbols Outlined",
  "material symbols rounded": "Material Symbols Rounded",
  "material symbols sharp": "Material Symbols Sharp",
};
const MATERIAL_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700"];

/**
 * Phosphor's weights are separate font files that all call themselves "Phosphor" at normal weight,
 * so each is its own family here (one style each), by the file it comes from in @phosphor-icons/web.
 */
const PHOSPHOR: { upTo: number; family: string; file: string; suffix: string }[] = [
  { upTo: 150, family: "Phosphor Thin", file: "thin/Phosphor-Thin.ttf", suffix: "-thin" },
  { upTo: 350, family: "Phosphor Light", file: "light/Phosphor-Light.ttf", suffix: "-light" },
  { upTo: 550, family: "Phosphor", file: "regular/Phosphor.ttf", suffix: "" },
  { upTo: Infinity, family: "Phosphor Bold", file: "bold/Phosphor-Bold.ttf", suffix: "-bold" },
];

/** The ligature that draws icon `name` in a face: Phosphor's weights name theirs "house-bold", "house-thin", … */
export const iconLigature = (face: FontFace, name: string): string => name + (PHOSPHOR.find((p) => p.family === face.family)?.suffix ?? "");

/** The styles each icon font has, as a font source lists them. */
export const ICON_FONT_STYLES: Record<string, string[]> = {
  ...Object.fromEntries(Object.values(MATERIAL).map((f) => [f, MATERIAL_WEIGHTS])),
  ...Object.fromEntries(PHOSPHOR.map((p) => [p.family, ["400"]])),
};

/** The font face an icon node is drawn with, or undefined for a library drawn from shape data. */
export function iconFace(library: unknown, weight: unknown): FontFace | undefined {
  const name = String(library ?? "").toLowerCase();
  const w = typeof weight === "number" && Number.isFinite(weight) ? weight : 400;
  if (name === "phosphor") return { family: PHOSPHOR.find((p) => w <= p.upTo)!.family, weight: 400, italic: false };
  const family = MATERIAL[name];
  if (!family) return undefined;
  return { family, weight: Math.max(100, Math.min(700, Math.round(w / 100) * 100)), italic: false };
}

/** Where a Phosphor family's font file is inside @phosphor-icons/web's `src` folder (undefined for other families). */
export const phosphorFile = (family: string): string | undefined => PHOSPHOR.find((p) => p.family === family)?.file;
