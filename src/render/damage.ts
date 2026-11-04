// What a change repaints. Each node's painted bounds (its box grown by what it paints outside it:
// strokes, shadows, a layer blur, text running over; turned and flipped as its ancestors are), each
// node's reach (its bounds and all its children's), and, between two scenes, the damage: the old and
// new bounds of every node that changed, in page coordinates. Unchanged top-level frames are the same
// objects (doc/incremental.ts), so they cost nothing to compare.
import type { Effect, TreeNode, Vars } from "../doc/schema.js";
import { withTheme, resolveOr } from "../doc/values.js";
import { isOff, num, type Box, type Boxes } from "../layout/layout.js";
import { isEnabled, type TextEngine } from "../text/paragraph.js";
import { strokeSides } from "./draw.js";

export interface Bounds {
  /** What each node paints itself, page coordinates. */
  own: Map<string, Box>;
  /** What each node and its children paint. */
  reach: Map<string, Box>;
  /** Nodes whose drawing reads what is behind them (a background blur, a shader). */
  readsBehind: string[];
}

/** A scene as damage needs it. */
export interface Drawn {
  tree: TreeNode;
  boxes: Boxes;
  vars: Vars;
}

export const union = (a: Box | undefined, b: Box | undefined): Box | undefined => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const sameBox = (a: Box | undefined, b: Box | undefined) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

type Matrix = [number, number, number, number, number, number]; // a b c d e f: x' = a x + c y + e
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function transformed(m: Matrix, b: Box): Box {
  if (m === IDENTITY) return b;
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
/** A little more than antialiasing reaches, in page units. */
const EDGE = 2;

/** What a node paints outside its box, on each side (page units, before turns). */
function margin(node: TreeNode, box: Box, vars: Vars, text?: TextEngine): { l: number; t: number; r: number; b: number } {
  const p = node.props;
  let m = EDGE;
  const sides = strokeSides(p.stroke !== undefined ? p.strokeWidth : 0, vars);
  const stroke = Math.max(...sides);
  // Outside or centred, and a miter's point at a sharp corner: twice the width covers them.
  if (stroke > 0) m += stroke * 2;
  let extra = { l: 0, t: 0, r: 0, b: 0 };
  for (const e of list(p.effect) as (Effect | undefined)[]) {
    if (!e || !isEnabled(e, vars)) continue;
    if (e.type === "shadow" && (e.shadowType ?? "outer") === "outer") {
      const blur = num(e.blur, vars, 0) * 1.5 + Math.abs(num((e as { spread?: unknown }).spread, vars, 0));
      const ox = num(e.offset?.x, vars, 0);
      const oy = num(e.offset?.y, vars, 0);
      extra = { l: Math.max(extra.l, blur - ox), r: Math.max(extra.r, blur + ox), t: Math.max(extra.t, blur - oy), b: Math.max(extra.b, blur + oy) };
    } else if (e.type === "blur") m += num((e as { radius?: unknown }).radius, vars, 0) * 1.5;
  }
  let below = 0;
  if (node.type === "text") {
    const size = num(p.fontSize, vars, 14);
    m += size * 0.5;
    // Text in a box of a fixed size runs over its bottom when it doesn't fit.
    if (p.textGrowth === "fixed-width-height" && text) {
      try {
        const para = text.paragraph(p, vars);
        para.layout(Math.max(1, box.w));
        below = Math.max(0, para.getHeight() - box.h);
      } catch {
        below = box.h * 4;
      }
    }
  }
  if (node.type === "icon") m += 2;
  return { l: m + Math.max(0, extra.l), t: m + Math.max(0, extra.t), r: m + Math.max(0, extra.r), b: m + Math.max(0, extra.b) + below };
}

/** Painted bounds of every node under `root` (a scene's tree or one top-level frame). */
export function paintedBounds(root: TreeNode, boxes: Boxes, vars: Vars, text?: TextEngine, into?: Bounds): Bounds {
  const out: Bounds = into ?? { own: new Map(), reach: new Map(), readsBehind: [] };
  const walk = (n: TreeNode, v: Vars, m: Matrix): Box | undefined => {
    v = withTheme(v, n.props.theme);
    if (isOff(n.props, v)) return undefined;
    const box = boxes.get(n.id);
    let here = m;
    let reach: Box | undefined;
    if (box) {
      const turn = num(n.props.rotation, v, 0);
      const flipX = resolveOr(n.props.flipX, v, false) === true;
      const flipY = resolveOr(n.props.flipY, v, false) === true;
      if (turn || flipX || flipY) {
        // As drawNode: turned counter-clockwise around the top-left corner, then mirrored about it.
        const a = (-turn * Math.PI) / 180;
        const [cos, sin] = [Math.cos(a), Math.sin(a)];
        const rot: Matrix = [cos, sin, -sin, cos, box.x - cos * box.x + sin * box.y, box.y - sin * box.x - cos * box.y];
        const flip: Matrix = [flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? 2 * box.x : 0, flipY ? 2 * box.y : 0];
        here = multiply(multiply(m === IDENTITY ? IDENTITY : m, rot), flip);
      }
      const g = margin(n, box, v, text);
      const own = transformed(here, { x: box.x - g.l, y: box.y - g.t, w: box.w + g.l + g.r, h: box.h + g.t + g.b });
      out.own.set(n.id, own);
      reach = own;
      const effects = list(n.props.effect) as (Effect | undefined)[];
      const fills = list(n.props.fill as unknown) as { type?: string }[];
      if (effects.some((e) => e?.type === "background_blur" || e?.type === "shader") || fills.some((f) => !!f && typeof f === "object" && f.type === "shader")) out.readsBehind.push(n.id);
    }
    for (const c of n.children) reach = union(reach, walk(c, v, here));
    if (reach) out.reach.set(n.id, reach);
    return reach;
  };
  walk(root, vars, IDENTITY);
  return out;
}

/** Each top-level frame's bounds, by the frame object (unchanged frames are the same object, laid out the same). */
export type BoundsCache = WeakMap<TreeNode, Bounds & { box: Box | undefined }>;

/** The bounds of every node in a scene, worked out again only for top-level frames that changed. */
export function sceneBounds(s: Drawn, cache: BoundsCache, text?: TextEngine): Bounds {
  const all: Bounds = { own: new Map(), reach: new Map(), readsBehind: [] };
  for (const top of s.tree.children) {
    let b = cache.get(top);
    const box = s.boxes.get(top.id);
    if (!b || b.box !== box) cache.set(top, (b = { ...paintedBounds(top, s.boxes, s.vars, text), box }));
    for (const [k, v] of b.own) all.own.set(k, v);
    for (const [k, v] of b.reach) all.reach.set(k, v);
    all.readsBehind.push(...b.readsBehind);
  }
  return all;
}

const propsSame = (a: TreeNode, b: TreeNode) => a.props === b.props || (a.type === b.type && JSON.stringify(a.props) === JSON.stringify(b.props));

/**
 * The areas (page coordinates) to paint again going from scene `a` to `b`: for each node added,
 * removed, changed or moved, where it was and where it is. A node whose own properties changed takes
 * its children's areas too (its opacity, clip or turn reaches them). Then anything that reads what is
 * behind it (a background blur, a shader) and sits over damage is painted again whole.
 */
export function damage(a: Drawn, ab: Bounds, b: Drawn, bb: Bounds): Box[] {
  const out: Box[] = [];
  const add = (box: Box | undefined) => box && box.w > 0 && box.h > 0 && out.push(box);
  const before = new Map(a.tree.children.map((t) => [t.id, t]));
  const compare = (x: TreeNode, y: TreeNode) => {
    if (x === y && sameBox(a.boxes.get(x.id), b.boxes.get(y.id))) {
      // The same subtree; only where the layout moved things (its parent changed size, say).
      if (sameSubtreeBoxes(x, a.boxes, b.boxes)) return;
    }
    if (!propsSame(x, y)) {
      add(ab.reach.get(x.id));
      add(bb.reach.get(y.id));
      return;
    }
    if (!sameBox(ab.own.get(x.id), bb.own.get(y.id))) {
      add(ab.own.get(x.id));
      add(bb.own.get(y.id));
    }
    const kids = new Map(x.children.map((c) => [c.id, c]));
    const order = x.children.map((c) => c.id).join("\n") !== y.children.map((c) => c.id).join("\n");
    for (const c of y.children) {
      const old = kids.get(c.id);
      kids.delete(c.id);
      if (!old || order) {
        // New here, or the order changed (what is on top of what): the whole of it.
        if (old) add(ab.reach.get(old.id));
        add(bb.reach.get(c.id));
      } else compare(old, c);
    }
    for (const gone of kids.values()) add(ab.reach.get(gone.id));
  };
  const order = a.tree.children.map((c) => c.id).join("\n") !== b.tree.children.map((c) => c.id).join("\n");
  for (const t of b.tree.children) {
    const old = before.get(t.id);
    before.delete(t.id);
    if (!old) add(bb.reach.get(t.id));
    else if (order) (add(ab.reach.get(t.id)), add(bb.reach.get(t.id)));
    else if (old !== t || !sameSubtreeBoxes(t, a.boxes, b.boxes)) compare(old, t);
  }
  for (const gone of before.values()) add(ab.reach.get(gone.id));
  return withBehind(out, bb);
}

/** Adds the whole of anything that reads what is behind it and sits over `rects`. */
export function withBehind(rects: Box[], bb: Bounds): Box[] {
  if (!rects.length) return rects;
  const out = [...rects];
  for (const id of bb.readsBehind) {
    const own = bb.own.get(id);
    if (own && rects.some((r) => overlaps(r, own))) out.push(bb.reach.get(id) ?? own);
  }
  return out;
}

function sameSubtreeBoxes(n: TreeNode, a: Boxes, b: Boxes): boolean {
  if (!sameBox(a.get(n.id), b.get(n.id))) return false;
  return n.children.every((c) => sameSubtreeBoxes(c, a, b));
}
