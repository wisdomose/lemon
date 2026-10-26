// Icons: Lucide's icons (Pen uses Lucide too), drawn from Lucide's own shape data as one stroked
// path on a 24 × 24 grid, the way Lucide draws them (2px lines, round ends and joins).
import type { CanvasKit, Path } from "canvaskit-wasm";
import { icons, type IconNode } from "lucide";

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

/** Whether Lucide has an icon by this name ("arrow-right"). */
export const hasIcon = (name: string) => !!(icons as Record<string, IconNode>)[pascal(name)];

const n = (v: unknown) => Number(v ?? 0);

/** One Lucide shape as SVG path data. */
function shapePath([tag, a]: IconNode[number]): string {
  switch (tag) {
    case "path":
      return String(a.d ?? "");
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

/** The icon's path on Lucide's 24 × 24 grid (null when Lucide has no icon by that name). Owned by the cache. */
export function iconPath(ck: CanvasKit, name: string): Path | null {
  let byName = cache.get(ck);
  if (!byName) cache.set(ck, (byName = new Map()));
  if (byName.has(name)) return byName.get(name)!;
  const node = (icons as Record<string, IconNode>)[pascal(name)];
  const path = node ? ck.Path.MakeFromSVGString(node.map(shapePath).join("")) : null;
  byName.set(name, path);
  return path;
}
