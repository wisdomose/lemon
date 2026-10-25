// Where a new top-level frame goes: to the right of everything on the page, top-aligned with the
// rightmost frame. Used by the agent's scripts and by the window (the agent cursor waits there).
import type { TreeNode } from "../doc/schema.js";
import type { Boxes } from "./layout.js";

const GAP_BETWEEN_FRAMES = 120;

export function emptySpot(page: TreeNode, boxes: Boxes): { x: number; y: number } {
  let right = -Infinity;
  let top = 0;
  for (const t of page.children) {
    const b = boxes.get(t.id);
    if (b && b.x + b.w > right) {
      right = b.x + b.w;
      top = b.y;
    }
  }
  return right === -Infinity ? { x: 0, y: 0 } : { x: Math.round(right + GAP_BETWEEN_FRAMES), y: Math.round(top) };
}
