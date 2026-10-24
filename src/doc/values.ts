// Resolving property values: variable references ("$primary") and colours.
import type { Vars } from "./schema.js";

export class ValueError extends Error {}

/** Replaces a "$name" reference with the variable's value; other values pass through. */
export function resolve<T>(value: T, vars: Vars): T | string | number {
  if (typeof value === "string" && value.startsWith("$")) {
    const v = vars[value.slice(1)];
    if (v === undefined) throw new ValueError(`Unknown variable "${value}". Define it with doc.setVars().`);
    return v;
  }
  return value;
}

export function isVarRef(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("$");
}

/** RGBA, each 0–1. */
export type RGBA = [number, number, number, number];

export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return [0, 0, 0, 0];
  const m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length === 6 || h.length === 8) {
      const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
      return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
    }
  }
  const r = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (r) {
    const a = r[4] === undefined ? 1 : r[4].endsWith("%") ? parseFloat(r[4]) / 100 : parseFloat(r[4]);
    return [+r[1]! / 255, +r[2]! / 255, +r[3]! / 255, a];
  }
  throw new ValueError(`"${input}" is not a colour. Use "#rrggbb", "#rrggbbaa", "rgba(r, g, b, a)" or a "$variable".`);
}

export function colorOf(value: unknown, vars: Vars): RGBA {
  const v = resolve(value, vars);
  if (typeof v !== "string") throw new ValueError(`${JSON.stringify(value)} is not a colour.`);
  return parseColor(v);
}

/** WCAG relative luminance and contrast ratio. */
function luminance([r, g, b]: RGBA): number {
  const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
export function contrast(a: RGBA, b: RGBA): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** `top` composited over an opaque `bottom`. */
export function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}
