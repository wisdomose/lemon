// The shape of a document: Pen's .pen schema (version 2.21), property for property. A node in memory
// carries exactly the properties it has in the file, under the same names, so a file reads and saves
// without losing anything — including properties this version doesn't draw yet.
//
// Stored flat (one record per node: type, parent, order key, properties) so that people and agents
// can edit at the same time through Yjs (doc/store.ts). Read as a tree (TreeNode) for layout, drawing,
// the agent's scripts and the file.

export type NodeType =
  | "frame"
  | "group"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "path"
  | "line"
  | "text"
  | "note"
  | "prompt"
  | "context"
  | "icon"
  | "script"
  | "browser"
  | "ref";
export const NODE_TYPES: readonly NodeType[] = [
  "frame",
  "group",
  "rectangle",
  "ellipse",
  "polygon",
  "path",
  "line",
  "text",
  "note",
  "prompt",
  "context",
  "icon",
  "script",
  "browser",
  "ref",
];

/** Only frames and groups have children of their own (a ref shows its component's). */
export const canHaveChildren = (type: NodeType | undefined) => type === "frame" || type === "group";

/** A variable reference: "$name". */
export type Variable = string;
export type NumberOrVariable = number | Variable;
/** "#RGB", "#RRGGBB" or "#RRGGBBAA", or a variable. */
export type Color = string;
export type BooleanOrVariable = boolean | Variable;

/** Theme axis → value, e.g. { Mode: "Dark" }. */
export type Theme = Record<string, string>;

/**
 * A size along one axis: pixels, a variable, or "fill_container" / "fit_content", each optionally with
 * a fallback in pixels for when it can't apply: "fit_content(100)".
 */
export type Size = NumberOrVariable | string;

export type BlendMode =
  | "normal"
  | "darken"
  | "multiply"
  | "linearBurn"
  | "colorBurn"
  | "light"
  | "screen"
  | "linearDodge"
  | "colorDodge"
  | "overlay"
  | "softLight"
  | "hardLight"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface ColorFill {
  type: "color";
  enabled?: BooleanOrVariable;
  blendMode?: BlendMode;
  color: Color;
}
export interface GradientFill {
  type: "gradient";
  enabled?: BooleanOrVariable;
  blendMode?: BlendMode;
  /** Default "linear". */
  gradientType?: "linear" | "radial" | "angular";
  opacity?: NumberOrVariable;
  /** Normalised to the box. Default 0.5, 0.5. */
  center?: { x?: number; y?: number };
  /** Normalised to the box. Default 1, 1. Linear: height is the gradient's length; radial/angular: the ellipse's diameters. */
  size?: { width?: NumberOrVariable; height?: NumberOrVariable };
  /** Degrees counter-clockwise (0 up, 90 left, 180 down). */
  rotation?: NumberOrVariable;
  colors?: { color: Color; position: NumberOrVariable }[];
}
/** A picture. `url` is relative to the .pen file ("./images/hero.jpg"). */
export interface ImageFill {
  type: "image";
  enabled?: BooleanOrVariable;
  blendMode?: BlendMode;
  opacity?: NumberOrVariable;
  url?: string;
  /** Default "cover". */
  mode?: "cover" | "contain" | "stretch";
  /** Crop: an affine matrix [a, b, c, d, tx, ty] from the picture's 0..1 space into the crop's. */
  transform?: [number, number, number, number, number, number];
}
/** A WebGL fragment shader file, relative to the .pen file. */
export interface ShaderFill {
  type: "shader";
  enabled?: BooleanOrVariable;
  blendMode?: BlendMode;
  opacity?: NumberOrVariable;
  url: string;
  uniforms?: Record<string, number | boolean | string | number[]>;
}
export interface MeshGradientFill {
  type: "mesh_gradient";
  enabled?: BooleanOrVariable;
  blendMode?: BlendMode;
  opacity?: NumberOrVariable;
  columns?: number;
  rows?: number;
  colors?: Color[];
  points?: ([number, number] | { position: [number, number]; [handle: string]: [number, number] })[];
}
export type Fill = Color | ColorFill | GradientFill | ImageFill | ShaderFill | MeshGradientFill;
export type Fills = Fill | Fill[];

export type StrokeWidth = NumberOrVariable | { top?: NumberOrVariable; right?: NumberOrVariable; bottom?: NumberOrVariable; left?: NumberOrVariable };

export type Effect =
  | { type: "blur"; enabled?: BooleanOrVariable; radius?: NumberOrVariable }
  | { type: "background_blur"; enabled?: BooleanOrVariable; radius?: NumberOrVariable }
  | {
      type: "shadow";
      enabled?: BooleanOrVariable;
      shadowType?: "inner" | "outer";
      offset?: { x: NumberOrVariable; y: NumberOrVariable };
      blur?: NumberOrVariable;
      /** Found in Pen's own files though the schema doesn't list it: grows the shadow's shape. */
      spread?: NumberOrVariable;
      color?: Color;
      blendMode?: BlendMode;
    }
  | { type: "shader"; enabled?: BooleanOrVariable; url: string; uniforms?: Record<string, number | boolean | string | number[]> };
export type Effects = Effect | Effect[];

export type Padding = NumberOrVariable | [NumberOrVariable, NumberOrVariable] | [NumberOrVariable, NumberOrVariable, NumberOrVariable, NumberOrVariable];
export type CornerRadius = NumberOrVariable | [NumberOrVariable, NumberOrVariable, NumberOrVariable, NumberOrVariable];

/**
 * Every property a node can carry, by Pen's names. Which ones apply depends on the type (see Pen's
 * schema); a node keeps any others it is given, untouched.
 */
export interface NodeProps {
  // Entity (every node).
  name?: string;
  /** What the node is for, in words (Pen uses it to describe components). */
  context?: string;
  /** A component: other places can show it through `ref` nodes. */
  reusable?: boolean;
  /** Theme values for this node and everything inside it. */
  theme?: Theme;
  /** False hides the node (and takes it out of layout). */
  enabled?: BooleanOrVariable;
  opacity?: NumberOrVariable;
  flipX?: BooleanOrVariable;
  flipY?: BooleanOrVariable;
  /** "absolute" takes the node out of its parent's layout, placed by x/y. Default "auto". */
  layoutPosition?: "auto" | "absolute";
  metadata?: { type: string; [key: string]: unknown };
  /** Degrees counter-clockwise around the top-left corner. */
  rotation?: NumberOrVariable;
  /** Relative to the parent's top-left; ignored inside a layout. */
  x?: number;
  y?: number;
  width?: Size;
  height?: Size;

  // Graphics.
  fill?: Fills;
  stroke?: Fills;
  strokeWidth?: StrokeWidth;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "bevel" | "round";
  strokeAlignment?: "inner" | "center" | "outer";
  effect?: Effects;
  cornerRadius?: CornerRadius;

  // Frame layout: one axis, no wrapping.
  layout?: "none" | "vertical" | "horizontal";
  gap?: NumberOrVariable;
  layoutIncludeStroke?: boolean;
  /** All sides, [vertical, horizontal], or [top, right, bottom, left]. */
  padding?: Padding;
  justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
  alignItems?: "start" | "center" | "end";
  clip?: BooleanOrVariable;
  /** A frame being worked on (an agent building it): drawn with a shimmer until cleared. */
  placeholder?: boolean;
  /** A frame meant to be filled in each instance; the ids are the components recommended for it. */
  slot?: false | string[];

  // Ellipse.
  innerRadius?: NumberOrVariable;
  startAngle?: NumberOrVariable;
  sweepAngle?: NumberOrVariable;
  // Polygon.
  polygonCount?: NumberOrVariable;
  // Path.
  fillRule?: "nonzero" | "evenodd";
  geometry?: string;
  viewBox?: [number, number, number, number];

  // Text (and note, prompt, context).
  content?: string;
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
  fontFamily?: string;
  fontSize?: NumberOrVariable;
  /** "normal", "bold", "500", … or a variable. */
  fontWeight?: string;
  letterSpacing?: NumberOrVariable;
  /** "normal" or "italic". */
  fontStyle?: string;
  underline?: BooleanOrVariable;
  strikethrough?: BooleanOrVariable;
  /** A multiple of the font size; the font's own when left out. */
  lineHeight?: NumberOrVariable;
  textAlign?: "left" | "center" | "right" | "justify";
  textAlignVertical?: "top" | "middle" | "bottom";
  href?: string;
  /** Prompt: the model it is for. */
  model?: string;

  // Icon.
  /** "lucide", "feather", "Material Symbols Outlined" / "Rounded" / "Sharp", "phosphor". */
  library?: string;
  icon?: string;
  weight?: NumberOrVariable;

  // Script.
  scriptUri?: string;
  inputs?: Record<string, string | number | boolean>;

  // Browser.
  url?: string;
  deviceId?: string;
  zoom?: number;
  scrollX?: number;
  scrollY?: number;

  // Ref: the component it shows (its id).
  ref?: string;
}

export type PropName = keyof NodeProps;

/** The page itself (Pen's `document`): the parent of every top-level node. Never stored as a record. */
export const ROOT_ID = "document";

export interface TreeNode {
  id: string;
  type: NodeType;
  props: NodeProps;
  children: TreeNode[];
  /** On a ref (an instance of a component) read through its component: the component's id. */
  instance?: string;
  /** On a node a script returned (drawn, not in the document): the script node's id. */
  script?: string;
}

/** A node as Pen writes it: type, id, properties and children (refs: `descendants`). */
export interface PenNode extends NodeProps {
  type: NodeType;
  id?: string;
  children?: PenNode[];
  /** A ref's changes to its component's nodes, by id path (see doc/store.ts). */
  descendants?: Descendants;
  [key: string]: unknown;
}

/**
 * A ref's changes to its component's nodes, by id path. Without `type`: properties to change (and with
 * `children`, what fills that node). With `type`: a whole node that takes that node's place.
 */
export type Descendants = Record<string, Partial<PenNode>>;

export type VariableType = "color" | "number" | "string" | "boolean";
export type VariableValue = string | number | boolean;
export interface VariableDef {
  type: VariableType;
  /** One value, or a value per theme: [{ value, theme: { Mode: "Dark" } }, …]. */
  value: VariableValue | { value: VariableValue; theme?: Theme }[];
}
export type Variables = Record<string, VariableDef>;
/** Theme axes and their values, the first being the default: { Mode: ["Light", "Dark"] }. */
export type Themes = Record<string, string[]>;

/** Variables resolved for one theme: name → value. What layout and drawing look values up in. */
export type Vars = Record<string, VariableValue>;

/** The .pen version this writes. */
export const PEN_VERSION = "2.21";

/** The file's top level: everything but `children`. */
export interface PenDocument {
  version: string;
  themes?: Themes;
  imports?: Record<string, string>;
  variables?: Variables;
  children: PenNode[];
}

/** Properties a new node gets when a person or an agent makes one without saying (Pen's defaults are absences). */
export const DEFAULTS: Partial<Record<NodeType, Partial<NodeProps>>> = {
  rectangle: { width: 100, height: 100 },
  ellipse: { width: 100, height: 100 },
  polygon: { width: 100, height: 100 },
  icon: { width: 24, height: 24, library: "lucide" },
};
