// Resolving property values: variable references ("$primary") under a theme, and colours.
import type { Theme, Themes, VariableDef, VariableValue, Variables, Vars } from "./schema.js";

export class ValueError extends Error {}

/** Where a resolved set of variables came from, so a node that sets a theme can switch (withTheme). */
const CONTEXT = Symbol("variables and theme");
interface Context {
  variables: Variables;
  themes: Themes;
  theme: Theme;
  cache: Map<string, Vars>;
}

/** A themed value's value for the active theme: the entry matching it most closely, else the one without a theme. */
function pick(value: VariableDef["value"], active: Theme): VariableValue | undefined {
  if (!Array.isArray(value)) return value;
  let best: VariableValue | undefined;
  let bestScore = -1;
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const axes = Object.entries(entry.theme ?? {});
    if (!axes.every(([axis, v]) => active[axis] === v)) continue;
    if (axes.length > bestScore) {
      best = entry.value;
      bestScore = axes.length;
    }
  }
  return best ?? value[0]?.value;
}

/** Each theme axis's default: its first value. */
const defaultTheme = (themes: Themes): Theme =>
  Object.fromEntries(Object.entries(themes).flatMap(([axis, values]) => (Array.isArray(values) && values.length ? [[axis, String(values[0])]] : [])));

/** The variables resolved for a theme (each axis not given takes its default); variables naming other variables are followed. */
export function varsFor(variables: Variables, themes: Themes, theme: Theme = {}, cache = new Map<string, Vars>()): Vars {
  const active = { ...defaultTheme(themes), ...theme };
  const key = JSON.stringify(Object.entries(active).sort());
  const hit = cache.get(key);
  if (hit) return hit;
  const raw: Record<string, VariableValue> = {};
  for (const [name, def] of Object.entries(variables)) {
    const v = def && typeof def === "object" ? pick(def.value, active) : undefined;
    if (v !== undefined) raw[name] = v;
  }
  const out: Vars = {};
  for (const name of Object.keys(raw)) {
    let v = raw[name]!;
    for (let i = 0; i < 16 && typeof v === "string" && v.startsWith("$") && raw[v.slice(1)] !== undefined; i++) v = raw[v.slice(1)]!;
    out[name] = v;
  }
  Object.defineProperty(out, CONTEXT, { value: { variables, themes, theme: active, cache } satisfies Context, enumerable: false });
  cache.set(key, out);
  return out;
}

/** The variables inside a node that sets `theme` (its own and everything inside it). */
export function withTheme(vars: Vars, theme: Theme | undefined): Vars {
  if (!theme || typeof theme !== "object" || !Object.keys(theme).length) return vars;
  const ctx = (vars as { [CONTEXT]?: Context })[CONTEXT];
  if (!ctx) return vars;
  return varsFor(ctx.variables, ctx.themes, { ...ctx.theme, ...theme }, ctx.cache);
}

/** Replaces a "$name" reference with the variable's value; other values pass through. */
export function resolve<T>(value: T, vars: Vars): T | VariableValue {
  if (typeof value === "string" && value.startsWith("$")) {
    const v = vars[value.slice(1)];
    if (v === undefined) throw new ValueError(`Unknown variable "${value}". Define it with SetVariables.`);
    return v;
  }
  return value;
}

/** A resolved value, or `fallback` when it can't be resolved (a missing variable in a file). */
export function resolveOr<T, F>(value: T, vars: Vars, fallback: F): T | VariableValue | F {
  try {
    return resolve(value, vars);
  } catch {
    return fallback;
  }
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
