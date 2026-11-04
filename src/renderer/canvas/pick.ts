// What a click, a double-click or a box drag on the canvas selects. Pen follows Figma here:
//   - A click picks the top-level frame's child under the pointer; a frame's own name label picks the
//     frame. The empty area of a top-level frame that has contents picks nothing (a drag there draws
//     a selection box); an empty frame is picked anywhere.
//   - Once something is selected, a click stays at its depth: it picks the selected node itself, or
//     the sibling of a selected node under the pointer.
//   - Ctrl/⌘ + click picks the deepest node under the pointer; a double-click goes one level in.
//   - A selection box picks the children it touches of the top-level frame it started in (the frames
//     themselves when it starts on the empty canvas); with Ctrl/⌘ the deepest nodes it touches.
// Pure functions of the laid-out tree, so they can be tested without a window.
import { ROOT_ID, type TreeNode } from "../../doc/schema.js";
import type { Box, Boxes } from "../../layout/layout.js";

export interface Laid {
  tree: TreeNode;
  boxes: Boxes;
}
export type Rect = Box;

const contains = (b: Box | undefined, x: number, y: number) => !!b && x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
const touches = (a: Box | undefined, b: Rect) => !!a && a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const shown = (n: TreeNode) => n.props.enabled !== false;
/** What can be picked inside a node: a script's output is part of it, so nothing. */
const inside = (n: TreeNode) => (n.type === "script" ? [] : n.children);

/** The parent of every node, by id. */
export function parents(tree: TreeNode): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  const walk = (n: TreeNode) => n.children.forEach((c) => (out.set(c.id, n), walk(c)));
  walk(tree);
  return out;
}

/** The nodes under a point, from the topmost top-level frame down to the deepest node. */
export function pathAt(s: Laid, x: number, y: number): TreeNode[] {
  const path: TreeNode[] = [];
  let level = s.tree.children;
  for (;;) {
    const hit = [...level].reverse().find((n) => shown(n) && contains(s.boxes.get(n.id), x, y));
    if (!hit) return path;
    path.push(hit);
    // What a script draws is part of it: a click picks the script node.
    level = inside(hit);
  }
}

/** What a click at (x, y) selects, given what is selected now; `deep` for Ctrl/⌘ + click. */
export function clickPick(s: Laid, x: number, y: number, selection: string[], deep = false): string | null {
  const path = pathAt(s, x, y);
  if (!path.length) return null;
  if (deep) return path.at(-1)!.id;
  // Stay at the depth of the selection: the selected node itself, or a sibling of one.
  const selected = new Set(selection);
  const up = parents(s.tree);
  const scopes = new Set(selection.map((id) => up.get(id)?.id));
  for (let i = path.length - 1; i >= 0; i--) {
    if (selected.has(path[i]!.id)) return path[i]!.id;
    if (i > 0 && scopes.has(path[i - 1]!.id)) return path[i]!.id;
  }
  if (path.length > 1) return path[1]!.id;
  return inside(path[0]!).length ? null : path[0]!.id;
}

/**
 * What a double-click selects: one level into the selected node under the pointer. `edit` says the
 * double-click was on a selected text or card, which then opens for typing.
 */
export function doubleClickPick(s: Laid, x: number, y: number, selection: string[]): { id: string | null; edit?: boolean } {
  const path = pathAt(s, x, y);
  const selected = new Set(selection);
  for (let i = path.length - 1; i >= 0; i--) {
    if (!selected.has(path[i]!.id)) continue;
    // A text, or a note, prompt or context card, opens for typing.
    if (["text", "note", "prompt", "context"].includes(path[i]!.type)) return { id: path[i]!.id, edit: true };
    const next = path[i + 1];
    if (next) return { id: next.id };
  }
  return { id: clickPick(s, x, y, selection) };
}

/** The deepest nodes (without children) inside `n` that `rect` touches. */
function leavesTouching(s: Laid, n: TreeNode, rect: Rect, out: string[]): void {
  for (const c of inside(n)) {
    if (!shown(c) || !touches(s.boxes.get(c.id), rect)) continue;
    if (inside(c).length) leavesTouching(s, c, rect, out);
    else out.push(c.id);
  }
}

/** What a selection box selects; `from` is where the drag started, `deep` for Ctrl/⌘ + drag. */
export function boxPick(s: Laid, rect: Rect, from: { x: number; y: number }, deep = false): string[] {
  const frame = [...s.tree.children].reverse().find((f) => shown(f) && contains(s.boxes.get(f.id), from.x, from.y));
  const scope = frame ?? s.tree;
  if (deep) {
    const out: string[] = [];
    leavesTouching(s, scope, rect, out);
    return out;
  }
  return inside(scope).filter((c) => shown(c) && touches(s.boxes.get(c.id), rect)).map((c) => c.id);
}

/** Enter: the children of the selected frames (the selection stays if none has children). */
export function selectChildren(s: Laid, selection: string[]): string[] {
  const byId = index(s.tree);
  const out = selection.flatMap((id) => { const n = byId.get(id); return n ? inside(n).map((c) => c.id) : []; });
  return out.length ? out : selection;
}

/** Shift + Enter: the parents of the selected nodes (top-level frames stay selected). */
export function selectParents(s: Laid, selection: string[]): string[] {
  const up = parents(s.tree);
  return [...new Set(selection.map((id) => (up.get(id)?.id === ROOT_ID ? id : (up.get(id)?.id ?? id))))];
}

/** Ctrl/⌘ + A: everything beside the selection (in its parent), or every top-level frame. */
export function selectAll(s: Laid, selection: string[]): string[] {
  const parent = selection.length ? parents(s.tree).get(selection[0]!) : s.tree;
  return (parent ?? s.tree).children.map((c) => c.id);
}

/** The smallest box around the given nodes. */
export function unionBox(boxes: Boxes, ids: string[]): Box | undefined {
  let [l, t, r, b] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const bx = boxes.get(id);
    if (!bx) continue;
    [l, t, r, b] = [Math.min(l, bx.x), Math.min(t, bx.y), Math.max(r, bx.x + bx.w), Math.max(b, bx.y + bx.h)];
  }
  return l === Infinity ? undefined : { x: l, y: t, w: r - l, h: b - t };
}

export function index(tree: TreeNode): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  const walk = (n: TreeNode) => (out.set(n.id, n), n.children.forEach(walk));
  walk(tree);
  return out;
}
