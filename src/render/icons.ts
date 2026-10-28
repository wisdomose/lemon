// Icons drawn from their libraries' own shape data: Lucide and Feather, each icon one stroked path
// on a 24 × 24 grid, the way both draw them (2px lines, round ends and joins). Pen's other icon
// libraries are fonts (text/icon-fonts.ts).
import type { CanvasKit, Path } from "canvaskit-wasm";
import { icons, type IconNode } from "lucide";
import featherIcons from "feather-icons/dist/icons.json" with { type: "json" };

/** Lucide's grid and line width. */
export const ICON_GRID = 24;
export const ICON_LINE = 2;

const pascal = (name: string) =>
  name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");

/** The libraries drawn from shape data. */
export type ShapeLibrary = "lucide" | "feather";

/** Whether a library has an icon by this name ("arrow-right"). */
export const hasIcon = (name: string, library: ShapeLibrary = "lucide") =>
  library === "feather" ? Object.hasOwn(featherIcons, name) : !!(icons as Record<string, IconNode>)[pascal(name)];

/** A Feather icon's SVG elements, as Lucide's shape list: [tag, attributes]. */
function featherShapes(svg: string): IconNode {
  const out: [string, Record<string, string>][] = [];
  for (const m of svg.matchAll(/<(\w+)([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
    out.push([m[1]!, attrs]);
  }
  return out as unknown as IconNode;
}

const n = (v: unknown) => Number(v ?? 0);

/** One Lucide shape as SVG path data. */
function shapePath([tag, a]: IconNode[number]): string {
  switch (tag) {
    case "path":
      // Each shape starts afresh: a leading relative move ("m6 6") is from the origin, not from where
      // the shape before it ended.
      return `M0 0${String(a.d ?? "")}`;
    case "circle":
    case "ellipse": {
      const [cx, cy] = [n(a.cx), n(a.cy)];
      const [rx, ry] = tag === "circle" ? [n(a.r), n(a.r)] : [n(a.rx), n(a.ry)];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    }
    case "rect": {
      const [x, y, w, h] = [n(a.x), n(a.y), n(a.width), n(a.height)];
      const rx = Math.min(n(a.rx ?? a.ry), w / 2);
      const ry = Math.min(n(a.ry ?? a.rx), h / 2);
      if (!rx || !ry) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    case "line":
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`;
    case "polyline":
    case "polygon": {
      const pts = String(a.points ?? "").trim().split(/[\s,]+/).map(Number);
      let d = "";
      for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? "L" : "M"}${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? d + "Z" : d;
    }
    default:
      return "";
  }
}

const cache = new WeakMap<CanvasKit, Map<string, Path | null>>();

/** The icon's path on the 24 × 24 grid (null when the library has no icon by that name). Owned by the cache. */
export function iconPath(ck: CanvasKit, name: string, library: ShapeLibrary = "lucide"): Path | null {
  let byName = cache.get(ck);
  if (!byName) cache.set(ck, (byName = new Map()));
  const key = `${library}:${name}`;
  if (byName.has(key)) return byName.get(key)!;
  const node =
    library === "feather"
      ? Object.hasOwn(featherIcons, name)
        ? featherShapes((featherIcons as Record<string, string>)[name]!)
        : undefined
      : (icons as Record<string, IconNode>)[pascal(name)];
  const path = node ? ck.Path.MakeFromSVGString(node.map(shapePath).join("")) : null;
  byName.set(key, path);
  return path;
}
