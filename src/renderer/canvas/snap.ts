// Snapping while moving: the moved box's left, centre and right (and top, middle, bottom) line up with
// those of the nodes beside it and of its parent when within a few pixels, and red guides show what
// lined up (Pen draws them from edge to edge, with no distance labels: capture 35 and recording R2).
import type { Box } from "../../layout/layout.js";
import type { Line } from "./overlay.js";

export interface Snap {
  dx: number;
  dy: number;
  guides: Line[];
}

const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

/** The smallest shift (within `threshold`) that lines one of `moving` up with one of `targets`. */
function nearest(moving: number[], targets: number[], threshold: number): number {
  let best = 0;
  let bestAbs = threshold + 1e-9;
  for (const m of moving) {
    for (const t of targets) {
      const d = t - m;
      if (Math.abs(d) < bestAbs) [best, bestAbs] = [d, Math.abs(d)];
    }
  }
  return bestAbs <= threshold ? best : 0;
}

/** Where `box` snaps to among `others` (page coordinates), and the guides to draw. */
export function snapBox(box: Box, others: Box[], threshold: number): Snap {
  const dx = nearest(xs(box), others.flatMap(xs), threshold);
  const dy = nearest(ys(box), others.flatMap(ys), threshold);
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Line[] = [];
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const x of xs(moved)) {
    const lined = others.filter((o) => xs(o).some((ox) => same(ox, x)));
    if (!lined.length) continue;
    const top = Math.min(moved.y, ...lined.map((o) => o.y));
    const bottom = Math.max(moved.y + moved.h, ...lined.map((o) => o.y + o.h));
    guides.push({ x1: x, y1: top, x2: x, y2: bottom });
  }
  for (const y of ys(moved)) {
    const lined = others.filter((o) => ys(o).some((oy) => same(oy, y)));
    if (!lined.length) continue;
    const left = Math.min(moved.x, ...lined.map((o) => o.x));
    const right = Math.max(moved.x + moved.w, ...lined.map((o) => o.x + o.w));
    guides.push({ x1: left, y1: y, x2: right, y2: y });
  }
  return { dx, dy, guides };
}
