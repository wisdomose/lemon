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
 * The deepest frame under (x, y) that isn't one of `moving` or inside one; the page when none. As in
 * Pen, groups take nothing dropped or drawn on them (the frame they are in does), but frames inside
 * them count. A copy of a component takes nothing new, so its frames don't count.
 */
export function frameAt(s: Laid, x: number, y: number, moving: Set<string> = new Set()): TreeNode {
  // Children with groups opened up in their place (front to back stays the same).
  const open = (list: TreeNode[]): TreeNode[] =>
    list.flatMap((n) => (n.type === "group" && !moving.has(n.id) && n.props.enabled !== false ? open(n.children) : [n]));
  let found = s.tree;
  let level = open(s.tree.children);
  for (;;) {
    const hit = [...level].reverse().find((n) => n.type === "frame" && !n.instance && !moving.has(n.id) && n.props.enabled !== false && contains(s.boxes.get(n.id), x, y));
    if (!hit) return found;
    found = hit;
    level = open(hit.children);
  }
}

/**
 * Where on the page a node's children measure their x and y from: the page's origin, a frame's
 * corner, or a group's own x/y (its box starts where its children do, which may be elsewhere).
 */
export function originIn(s: Laid, parent: TreeNode): { x: number; y: number } {
  if (parent.id === ROOT_ID) return { x: 0, y: 0 };
  const box = s.boxes.get(parent.id) ?? { x: 0, y: 0 };
  if (parent.type !== "group") return { x: box.x, y: box.y };
  for (const c of parent.children) {
    const b = s.boxes.get(c.id);
    const [x, y] = [c.props.x ?? 0, c.props.y ?? 0];
    if (b && typeof x === "number" && typeof y === "number") return { x: b.x - x, y: b.y - y };
  }
  return { x: box.x, y: box.y };
}

/** The frame (or page) a node's group is in: up through its groups. */
export function frameAround(up: Map<string, TreeNode>, node: TreeNode): TreeNode {
  let n = node;
  while (n.type === "group" && up.get(n.id)) n = up.get(n.id)!;
  return n;
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
