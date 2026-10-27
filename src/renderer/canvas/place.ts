// Where moved or newly drawn nodes go: into the deepest frame under the pointer (or onto the page),
// and in a frame with a row or column layout, at the place in the row or column the pointer points to.
import { ROOT_ID, type TreeNode } from "../../doc/schema.js";
import { kindOf, type Box } from "../../layout/layout.js";
import type { Laid } from "./pick.js";
import type { Line } from "./overlay.js";

/** A frame lays its children out in a row or column (Pen's flex layout). */
export const flows = (n: TreeNode) => n.type === "frame" && n.id !== ROOT_ID && kindOf(n) !== "free";

/** A node placed by its own x and y: on the page, in a frame without layout or a group, or set apart (`layoutPosition: "absolute"`). */
export const placedFreely = (n: TreeNode, parent: TreeNode) => parent.id === ROOT_ID || !flows(parent) || n.props.layoutPosition === "absolute";

const contains = (b: Box | undefined, x: number, y: number) => !!b && x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;

/**
 * The deepest frame under (x, y) that isn't one of `moving` or inside one; the page when none. A copy
 * of a component takes nothing new, so its frames don't count.
 */
export function frameAt(s: Laid, x: number, y: number, moving: Set<string> = new Set()): TreeNode {
  let found = s.tree;
  let level = s.tree.children;
  for (;;) {
    const hit = [...level].reverse().find((n) => (n.type === "frame" || n.type === "group") && !n.instance && !moving.has(n.id) && n.props.enabled !== false && contains(s.boxes.get(n.id), x, y));
    if (!hit) return found;
    found = hit;
    level = hit.children;
  }
}

/**
 * Where in a row or column frame a node dropped at (x, y) goes: the index among the children that
 * stay, and the line that shows it (between two children, across the frame's other axis).
 */
export function flowSlot(s: Laid, frame: TreeNode, x: number, y: number, moving: Set<string> = new Set()): { index: number; line: Line } {
  const row = kindOf(frame) === "row";
  const fb = s.boxes.get(frame.id)!;
  const kids = frame.children.filter((c) => !moving.has(c.id) && c.props.layoutPosition !== "absolute" && s.boxes.has(c.id));
  const at = row ? x : y;
  let index = kids.findIndex((c) => {
    const b = s.boxes.get(c.id)!;
    return at < (row ? b.x + b.w / 2 : b.y + b.h / 2);
  });
  if (index < 0) index = kids.length;
  const before = kids[index - 1] && s.boxes.get(kids[index - 1]!.id)!;
  const after = kids[index] && s.boxes.get(kids[index]!.id)!;
  // The line sits halfway between the neighbours (or at the frame's padding edge).
  const pos = row
    ? before && after ? (before.x + before.w + after.x) / 2 : before ? before.x + before.w : after ? after.x : fb.x + fb.w / 2
    : before && after ? (before.y + before.h + after.y) / 2 : before ? before.y + before.h : after ? after.y : fb.y + fb.h / 2;
  const line = row ? { x1: pos, y1: fb.y, x2: pos, y2: fb.y + fb.h } : { x1: fb.x, y1: pos, x2: fb.x + fb.w, y2: pos };
  // The index among all children (the document's order counts every child, absolute ones too).
  const docIndex = index < kids.length ? frame.children.filter((c) => !moving.has(c.id)).indexOf(kids[index]!) : frame.children.filter((c) => !moving.has(c.id)).length;
  return { index: docIndex, line };
}
