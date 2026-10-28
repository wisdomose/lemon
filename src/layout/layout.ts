// Layout: positions and sizes for every node, computed with Yoga (single-axis flexbox, no wrapping),
// by Pen's rules:
//   - A frame lays its children out in a row unless `layout` says "vertical" or "none" (placed by x/y).
//     A group places its children by its x/y plus theirs (negative ones too) and its box is where
//     they reach, from the leftmost and topmost; in a row or column they start at its slot's corner.
//   - Sizes are pixels, "fill_container" (the parent's space; needs a parent with a layout) or
//     "fit_content" (the children's; needs a layout and children), each with an optional fallback in
//     pixels for when it can't apply: "fit_content(100)". Frames and groups fit their content by default.
//   - Text sizes by `textGrowth`: "auto" (the default) takes the text's own size and never wraps;
//     "fixed-width" wraps at its width and takes its height from the text; "fixed-width-height" is
//     the box it is given.
//   - `layoutPosition: "absolute"` takes a node out of its parent's layout, placed by x/y.
//   - A node switched off (`enabled: false`) takes no space.
// Text is measured with the same paragraphs the renderer draws.
import Yoga, {
  Align,
  Direction,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  PositionType,
  type Node as YogaNode,
} from "yoga-layout";
import type { NodeProps, TreeNode, Vars } from "../doc/schema.js";
import { resolveOr, withTheme } from "../doc/values.js";
import { FontsNeeded, type FontFace } from "../text/fonts.js";
import { faceOf, type TextEngine } from "../text/paragraph.js";
import { iconFace } from "../text/icon-fonts.js";

/** A node's box in page coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Boxes = Map<string, Box>;

const config = Yoga.Config.create();
// No rounding to whole pixels: rounding a measured text width down would make the text wrap.
config.setPointScaleFactor(0);

/** How a parent places its children: along a row or column, or each by its x/y. */
type ParentKind = "row" | "column" | "free";

export function num(v: unknown, vars: Vars, fallback = 0): number {
  const r = resolveOr(v, vars, fallback);
  const n = typeof r === "number" ? r : typeof r === "string" && r.trim() !== "" ? Number(r) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** A size read: pixels, fill the parent, or fit the content (with a fallback). */
export type SizeRule = { kind: "px"; px: number } | { kind: "fill" | "fit"; fallback?: number };

export function sizeRule(value: unknown, vars: Vars): SizeRule | undefined {
  if (value === undefined || value === null) return undefined;
  const v = resolveOr(value, vars, undefined);
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "px", px: Math.max(0, v) } : undefined;
  if (typeof v !== "string") return undefined;
  const m = /^(fill_container|fit_content)(?:\(\s*(-?[\d.]+)\s*\))?$/.exec(v.trim());
  if (!m) return Number.isFinite(Number(v)) && v.trim() !== "" ? { kind: "px", px: Math.max(0, Number(v)) } : undefined;
  return { kind: m[1] === "fill_container" ? "fill" : "fit", ...(m[2] !== undefined ? { fallback: Math.max(0, Number(m[2])) } : {}) };
}

/** [top, right, bottom, left]. */
export function padding(p: NodeProps["padding"], vars: Vars): [number, number, number, number] {
  if (p === undefined) return [0, 0, 0, 0];
  if (!Array.isArray(p)) {
    const n = num(p, vars);
    return [n, n, n, n];
  }
  if (p.length === 2) return [num(p[0], vars), num(p[1], vars), num(p[0], vars), num(p[1], vars)];
  return [num(p[0], vars), num(p[1], vars), num(p[2], vars), num(p[3], vars)];
}

/** Whether a node is switched off. */
export const isOff = (p: NodeProps, vars: Vars) => resolveOr(p.enabled, vars, true) === false;

/** How a container places its children. */
export function kindOf(node: TreeNode): ParentKind {
  if (node.type === "group") return "free";
  if (node.type !== "frame") return "free";
  const l = node.props.layout;
  return l === "none" ? "free" : l === "vertical" ? "column" : "row";
}

const TEXTS = new Set(["note", "prompt", "context"]);
/** A note card's size in Pen, whatever the file says (measured from Pen). */
const CARD_MIN_WIDTH = 250;
const CARD_HEIGHT = 219;

/** A free container fitting its content by an axis: set once the children are placed (see `fitFree`). */
interface FreeFit {
  node: YogaNode;
  tree: TreeNode;
  w: boolean;
  h: boolean;
  /** In a row or column (not placed by its own x/y). */
  inFlow: boolean;
}

function build(
  node: TreeNode,
  parent: ParentKind,
  vars: Vars,
  text: TextEngine,
  nodes: Map<string, YogaNode>,
  freeFits: FreeFit[],
): YogaNode {
  vars = withTheme(vars, node.props.theme);
  const p = node.props;
  const yn = Yoga.Node.create(config);
  nodes.set(node.id, yn);
  if (isOff(p, vars)) yn.setDisplay(Display.None);
  const absolute = parent === "free" || p.layoutPosition === "absolute";
  if (absolute) {
    yn.setPositionType(PositionType.Absolute);
    yn.setPosition(Edge.Left, num(p.x, vars));
    yn.setPosition(Edge.Top, num(p.y, vars));
  }
  const flows = !absolute;
  const kind = kindOf(node);
  const container = node.type === "frame" || node.type === "group";
  const hasKids = node.children.length > 0;

  const axis = (a: "w" | "h", value: unknown, deflt: SizeRule | undefined): "fit-free" | undefined => {
    const rule = sizeRule(value, vars) ?? deflt;
    const set = (px: number) => (a === "w" ? yn.setWidth(px) : yn.setHeight(px));
    if (!rule) return;
    if (rule.kind === "px") return void set(rule.px);
    if (rule.kind === "fill") {
      if (!flows) return void (rule.fallback !== undefined ? set(rule.fallback) : undefined);
      const mainAxis = (parent === "row") === (a === "w");
      if (mainAxis) {
        yn.setFlexGrow(1);
        yn.setFlexShrink(1);
        yn.setFlexBasis(0);
      } else yn.setAlignSelf(Align.Stretch);
      return;
    }
    // Fit the content: Yoga's own size for a frame with a layout and children; a free container's
    // reach is measured after its children are placed; with nothing to fit, the fallback (or nothing).
    if (container && hasKids && kind !== "free") return;
    if (container && hasKids && kind === "free") return "fit-free";
    if (rule.fallback !== undefined) set(rule.fallback);
    else if (container) set(0);
  };

  if (node.type === "text") {
    const growth = p.textGrowth ?? "auto";
    if (growth === "fixed-width-height") {
      axis("w", p.width, undefined);
      axis("h", p.height, undefined);
    } else {
      if (growth === "fixed-width") axis("w", p.width, undefined);
      yn.setMeasureFunc((width, widthMode) => {
        const para = text.paragraph(p, vars);
        para.layout(1e7);
        const natural = Math.ceil(para.getMaxIntrinsicWidth());
        const w = growth === "auto" ? natural : widthMode === MeasureMode.Exactly ? width : widthMode === MeasureMode.AtMost ? Math.min(width, natural) : natural;
        para.layout(Math.max(1, w));
        return { width: w, height: Math.ceil(para.getHeight()) };
      });
      // Auto text is its text's size, whatever the layout offers.
      if (growth === "auto") yn.setFlexShrink(0);
    }
    return yn;
  }

  // Notes, prompts and contexts are cards Pen sizes itself: at least 250 wide, 219 high.
  if (TEXTS.has(node.type)) {
    const w = sizeRule(p.width, vars);
    yn.setWidth(Math.max(CARD_MIN_WIDTH, w?.kind === "px" ? w.px : 0));
    yn.setHeight(CARD_HEIGHT);
    return yn;
  }
  const fit: SizeRule = { kind: "fit" };
  const fw = axis("w", p.width, container ? fit : undefined);
  const fh = axis("h", p.height, container ? fit : undefined);
  if (fw || fh) freeFits.push({ node: yn, tree: node, w: !!fw, h: !!fh, inFlow: flows });
  if (!container) {
    // What a script returned sits inside it, each by its x/y.
    if (node.type === "script") node.children.forEach((child, i) => yn.insertChild(build(child, "free", vars, text, nodes, freeFits), i));
    return yn;
  }

  yn.setFlexDirection(kind === "row" ? FlexDirection.Row : FlexDirection.Column);
  if (node.type === "frame") {
    const [pt, pr, pb, pl] = padding(p.padding, vars);
    yn.setPadding(Edge.Top, pt);
    yn.setPadding(Edge.Right, pr);
    yn.setPadding(Edge.Bottom, pb);
    yn.setPadding(Edge.Left, pl);
    yn.setGap(Gutter.All, num(p.gap, vars));
    const j = p.justifyContent;
    yn.setJustifyContent(
      j === "center" ? Justify.Center : j === "end" ? Justify.FlexEnd : j === "space_between" ? Justify.SpaceBetween : j === "space_around" ? Justify.SpaceAround : Justify.FlexStart,
    );
    const a = p.alignItems;
    yn.setAlignItems(a === "center" ? Align.Center : a === "end" ? Align.FlexEnd : Align.FlexStart);
  }
  node.children.forEach((child, i) => yn.insertChild(build(child, kind, vars, text, nodes, freeFits), i));
  return yn;
}

/**
 * Sizes free containers (groups, frames without a layout) that fit their content to how far their
 * children reach, deepest first, laying out again until nothing changes. Returns, for each group,
 * where its children start relative to its own x/y (its box starts there).
 */
function fitFree(root: YogaNode, freeFits: FreeFit[], nodes: Map<string, YogaNode>, vars: Vars): Map<string, { x: number; y: number }> {
  const reach = new Map<string, { x: number; y: number }>();
  if (!freeFits.length) return reach;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const f of [...freeFits].reverse()) {
      const shown = f.tree.children.filter((c) => !isOff(c.props, vars)).map((c) => nodes.get(c.id)!);
      // A group spans its children wherever they are; in a row or column they start at the corner
      // of its slot instead (both as in Pen). A frame spans from its own corner.
      const from = { x: 0, y: 0 };
      if (f.tree.type === "group" && shown.length) {
        const minX = Math.min(...shown.map((cn) => cn.getComputedLeft()));
        const minY = Math.min(...shown.map((cn) => cn.getComputedTop()));
        if (!f.inFlow) Object.assign(from, { x: minX, y: minY });
        else if (Math.abs(minX) > 0.01 || Math.abs(minY) > 0.01) {
          for (const cn of shown) {
            cn.setPosition(Edge.Left, cn.getComputedLeft() - minX);
            cn.setPosition(Edge.Top, cn.getComputedTop() - minY);
          }
          changed = true;
        }
        reach.set(f.tree.id, from);
      }
      let w = 0;
      let h = 0;
      for (const cn of shown) {
        w = Math.max(w, cn.getComputedLeft() + cn.getComputedWidth() - from.x);
        h = Math.max(h, cn.getComputedTop() + cn.getComputedHeight() - from.y);
      }
      if (f.w && Math.abs(f.node.getComputedWidth() - w) > 0.01) (f.node.setWidth(w), (changed = true));
      if (f.h && Math.abs(f.node.getComputedHeight() - h) > 0.01) (f.node.setHeight(h), (changed = true));
    }
    if (!changed) return reach;
    root.calculateLayout(undefined, undefined, Direction.LTR);
  }
  return reach;
}

/** Every font face the text in `root` uses. */
export function facesUsed(root: TreeNode, vars: Vars): FontFace[] {
  const out: FontFace[] = [];
  const walk = (n: TreeNode, v: Vars) => {
    v = withTheme(v, n.props.theme);
    if (isOff(n.props, v)) return;
    if (n.type === "text") out.push(faceOf(n.props, v));
    if (TEXTS.has(n.type)) out.push({ family: "JetBrains Mono", weight: 400, italic: false }, { family: "JetBrains Mono", weight: 500, italic: false });
    // A script's error shows its code in the cards' monospace font.
    if (n.type === "script") out.push({ family: "JetBrains Mono", weight: 400, italic: false });
    if (n.type === "icon") {
      const face = iconFace(resolveOr(n.props.library, v, ""), resolveOr(n.props.weight, v, undefined));
      if (face) out.push(face);
    }
    n.children.forEach((c) => walk(c, v));
  };
  walk(root, vars);
  return out;
}

/**
 * Lays out every top-level node of `root` (the document) and returns page-coordinate boxes for all
 * nodes. Throws FontsNeeded (before doing any work) if some text's font isn't loaded yet.
 */
export function layout(root: TreeNode, vars: Vars, text: TextEngine): Boxes {
  const missing = text.fonts.missing(facesUsed(root, vars));
  if (missing.length) throw new FontsNeeded(missing);
  const boxes: Boxes = new Map();
  for (const top of root.children) {
    const nodes = new Map<string, YogaNode>();
    const freeFits: FreeFit[] = [];
    // A top-level node stands on its own: it is laid out as the only child of a free page.
    const page = Yoga.Node.create(config);
    const yn = build(top, "free", vars, text, nodes, freeFits);
    page.insertChild(yn, 0);
    try {
      page.calculateLayout(undefined, undefined, Direction.LTR);
      const reach = fitFree(page, freeFits, nodes, vars);
      const walk = (node: TreeNode, ox: number, oy: number) => {
        const n = nodes.get(node.id)!;
        const x = ox + n.getComputedLeft();
        const y = oy + n.getComputedTop();
        // A group's box starts where its children do, which may be left of or above its own x/y.
        const from = reach.get(node.id) ?? { x: 0, y: 0 };
        boxes.set(node.id, { x: x + from.x, y: y + from.y, w: n.getComputedWidth(), h: n.getComputedHeight() });
        for (const c of node.children) walk(c, x, y);
      };
      walk(top, 0, 0);
    } finally {
      page.freeRecursive();
    }
  }
  return boxes;
}
