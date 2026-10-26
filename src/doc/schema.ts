// The shape of a Lemon document.
//
// Stored flat (one record per node: type, parent, order key, properties) so that people and agents
// can edit at the same time through Yjs. Read as a tree (TreeNode) for layout, drawing, the agent's
// scripts and exports.

export type NodeType = "frame" | "text" | "rect" | "ellipse" | "image" | "instance";
export const NODE_TYPES: readonly NodeType[] = ["frame", "text", "rect", "ellipse", "image", "instance"];

/** A size along one axis: a fixed number of pixels, fill the parent, or fit the content. */
export type Size = number | "fill" | "fit";

/** A colour as "#rrggbb" / "#rrggbbaa", or a variable reference such as "$primary". */
export type Color = string;

export interface LinearGradient {
  type: "linear";
  /** Degrees; 0 runs top to bottom, 90 left to right. */
  angle: number;
  stops: { color: Color; at: number }[];
}
export type Paint = Color | LinearGradient;

export interface Stroke {
  color: Color;
  width: number;
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: Color;
}

/** Every property any node can carry. Which ones apply depends on the node type. */
export interface NodeProps {
  name?: string;
  // Position: used for top-level frames, children of a frame without layout, and `absolute` children.
  x?: number;
  y?: number;
  absolute?: boolean;
  width?: Size;
  height?: Size;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  visible?: boolean;
  opacity?: number;
  fill?: Paint;
  stroke?: Stroke;
  /** One radius, or [top-left, top-right, bottom-right, bottom-left]. */
  radius?: number | [number, number, number, number];
  shadow?: Shadow;
  /** A top-level frame an agent is building: drawn with the "Generating" shimmer until cleared. */
  generating?: boolean;
  /** A main component: other places can show copies of it (instances) that follow its changes. */
  component?: boolean;

  // Frame layout: a single axis, no wrapping.
  layout?: "row" | "column" | "none";
  gap?: number;
  /** One value, [vertical, horizontal], or [top, right, bottom, left]. */
  padding?: number | [number, number] | [number, number, number, number];
  justify?: "start" | "center" | "end" | "between";
  align?: "start" | "center" | "end" | "stretch";
  clip?: boolean;

  // Text.
  text?: string;
  font?: string;
  size?: number;
  weight?: number;
  italic?: boolean;
  /** Multiple of the font size. */
  lineHeight?: number;
  /** Pixels. */
  letterSpacing?: number;
  color?: Color;
  textAlign?: "left" | "center" | "right";
  uppercase?: boolean;

  // Image: until there is an image source, a placeholder describing the photo that belongs here.
  description?: string;
}

export type PropName = keyof NodeProps;

/** The page itself: the parent of every top-level frame. Never stored as a record. */
export const ROOT_ID = "root";

export interface TreeNode {
  id: string;
  type: NodeType;
  props: NodeProps;
  children: TreeNode[];
  /** On a copy of a component: the main component's id (the copy is read as the main's tree). */
  instance?: string;
}

/** What an agent or a person sends to create nodes: a node with nested children. */
export interface NodeSpec extends NodeProps {
  type: NodeType;
  /** A label the script can use to find this node's id afterwards (returned in `refs`). */
  ref?: string;
  children?: NodeSpec[];
  /** An instance's main component. */
  of?: string;
  /** An instance's changes to parts of its main component, by their id path (see doc/components.ts). */
  overrides?: Overrides;
}

/** An instance's changes to its main component's parts: properties by the part's id path in the main. */
export type Overrides = Record<string, Partial<NodeProps>>;

/** Variables (design tokens): colours, numbers and font names a node can reference as "$name". */
export type Vars = Record<string, string | number>;

export const DEFAULTS: Record<NodeType, Partial<NodeProps>> = {
  frame: { width: "fit", height: "fit", layout: "column" },
  text: { width: "fit", height: "fit", size: 16, weight: 400, lineHeight: 1.4, color: "#000000" },
  rect: { width: 100, height: 100 },
  ellipse: { width: 100, height: 100 },
  image: { width: 400, height: 300 },
  // An instance takes everything from its main component; its own properties override.
  instance: {},
};
