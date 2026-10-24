// Layout: positions and sizes for every node, computed with Yoga (single-axis flexbox, no wrapping).
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
import { resolve } from "../doc/values.js";
import { FontsNeeded, type FontFace } from "../text/fonts.js";
import { faceOf, type TextEngine } from "../text/paragraph.js";

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

type ParentKind = "row" | "column" | "free";

function num(v: unknown, vars: Vars, fallback = 0): number {
  const r = resolve(v, vars);
  return typeof r === "number" && Number.isFinite(r) ? r : fallback;
}

function padding(p: NodeProps["padding"], vars: Vars): [number, number, number, number] {
  if (p === undefined) return [0, 0, 0, 0];
  if (typeof p === "number" || typeof p === "string") {
    const n = num(p, vars);
    return [n, n, n, n];
  }
  if (p.length === 2) return [num(p[0], vars), num(p[1], vars), num(p[0], vars), num(p[1], vars)];
  return [num(p[0], vars), num(p[1], vars), num(p[2], vars), num(p[3], vars)];
}

function sizeAxis(yn: YogaNode, axis: "w" | "h", value: unknown, parent: ParentKind, vars: Vars): void {
  const v = resolve(value, vars);
  if (typeof v === "number") {
    if (axis === "w") yn.setWidth(v);
    else yn.setHeight(v);
    return;
  }
  if (v !== "fill" || parent === "free") return; // "fit": Yoga's auto size hugs the content
  const mainAxis = (parent === "row") === (axis === "w");
  if (mainAxis) {
    yn.setFlexGrow(1);
    yn.setFlexShrink(1);
    yn.setFlexBasis(0);
  } else {
    yn.setAlignSelf(Align.Stretch);
  }
}

function build(node: TreeNode, parent: ParentKind, vars: Vars, text: TextEngine, nodes: Map<string, YogaNode>): YogaNode {
  const p = node.props;
  const yn = Yoga.Node.create(config);
  nodes.set(node.id, yn);
  if (p.visible === false) yn.setDisplay(Display.None);
  if (parent === "free" || p.absolute) {
    yn.setPositionType(PositionType.Absolute);
    yn.setPosition(Edge.Left, num(p.x, vars));
    yn.setPosition(Edge.Top, num(p.y, vars));
  }
  sizeAxis(yn, "w", p.width, parent, vars);
  sizeAxis(yn, "h", p.height, parent, vars);
  if (p.minWidth !== undefined) yn.setMinWidth(num(p.minWidth, vars));
  if (p.maxWidth !== undefined) yn.setMaxWidth(num(p.maxWidth, vars));
  if (p.minHeight !== undefined) yn.setMinHeight(num(p.minHeight, vars));
  if (p.maxHeight !== undefined) yn.setMaxHeight(num(p.maxHeight, vars));

  if (node.type === "text") {
    yn.setMeasureFunc((width, widthMode, _height, _heightMode) => {
      const para = text.paragraph(p, vars);
      para.layout(1e7);
      const natural = Math.ceil(para.getMaxIntrinsicWidth());
      const w =
        widthMode === MeasureMode.Exactly ? width : widthMode === MeasureMode.AtMost ? Math.min(width, natural) : natural;
      para.layout(w);
      return { width: w, height: Math.ceil(para.getHeight()) };
    });
    return yn;
  }
  if (node.type !== "frame") return yn;

  const kind: ParentKind = p.layout === "row" ? "row" : p.layout === "none" ? "free" : "column";
  yn.setFlexDirection(kind === "row" ? FlexDirection.Row : FlexDirection.Column);
  const [pt, pr, pb, pl] = padding(p.padding, vars);
  yn.setPadding(Edge.Top, pt);
  yn.setPadding(Edge.Right, pr);
  yn.setPadding(Edge.Bottom, pb);
  yn.setPadding(Edge.Left, pl);
  yn.setGap(Gutter.All, num(p.gap, vars));
  yn.setJustifyContent(
    p.justify === "center"
      ? Justify.Center
      : p.justify === "end"
        ? Justify.FlexEnd
        : p.justify === "between"
          ? Justify.SpaceBetween
          : Justify.FlexStart,
  );
  yn.setAlignItems(
    p.align === "center" ? Align.Center : p.align === "end" ? Align.FlexEnd : p.align === "stretch" ? Align.Stretch : Align.FlexStart,
  );
  node.children.forEach((child, i) => yn.insertChild(build(child, kind, vars, text, nodes), i));
  return yn;
}

/** Every font face the text in `root` uses. */
export function facesUsed(root: TreeNode, vars: Vars): FontFace[] {
  const out: FontFace[] = [];
  const walk = (n: TreeNode) => {
    if (n.type === "text" && n.props.visible !== false) out.push(faceOf(n.props, vars));
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * Lays out every top-level frame of `root` (the page) and returns page-coordinate boxes for all nodes.
 * Throws FontsNeeded (before doing any work) if some text's font isn't loaded yet.
 */
export function layout(root: TreeNode, vars: Vars, text: TextEngine): Boxes {
  const missing = text.fonts.missing(facesUsed(root, vars));
  if (missing.length) throw new FontsNeeded(missing);
  const boxes: Boxes = new Map();
  for (const top of root.children) {
    const nodes = new Map<string, YogaNode>();
    const yn = build(top, "column", vars, text, nodes);
    try {
      yn.calculateLayout(undefined, undefined, Direction.LTR);
      const walk = (node: TreeNode, ox: number, oy: number) => {
        const n = nodes.get(node.id)!;
        const x = ox + n.getComputedLeft();
        const y = oy + n.getComputedTop();
        boxes.set(node.id, { x, y, w: n.getComputedWidth(), h: n.getComputedHeight() });
        for (const c of node.children) walk(c, x, y);
      };
      walk(top, num(top.props.x, vars), num(top.props.y, vars));
    } finally {
      yn.freeRecursive();
    }
  }
  return boxes;
}
