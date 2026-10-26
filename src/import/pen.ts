// Opening a Pen file (.pen, Pen's JSON format, version 2.x) as a Lemon document. The .pen file is only
// read; the result is a new Lemon document. Pen's nodes map onto Lemon's one by one, keeping their ids
// (so a copy's changes, keyed by id path in both, carry over as they are):
//
//   frame → frame (Pen's default layout is a row; "vertical" → column, "none" → free)
//   rectangle → rect · ellipse → ellipse · text → text · icon (Lucide) → icon
//   reusable: true → a main component · ref → a copy (instance), its `descendants` → its changes
//   group → a frame without layout · fill_container / fit_content → "fill" / "fit"
//   image fills → pictures, read from the files beside the .pen (`read`)
//
// What Lemon has no counterpart for is left out and counted in the report (`leftOut`): vector paths
// and polygons keep their space as empty frames; a fill list keeps its top fill; radial and other
// gradients become their first colour; strokes are drawn inside; only an outer drop shadow is kept.
import * as Y from "yjs";
import { generateNKeysBetween } from "fractional-indexing";
import { assetId, putAsset } from "../doc/assets.js";
import { ROOT_ID, type NodeProps, type NodeType, type Paint, type Size, type Stroke } from "../doc/schema.js";
import { nodesOf, varsOf } from "../doc/store.js";
import { hasIcon } from "../render/icons.js";

/** A Pen node, as read from the file (only what the import looks at is typed). */
type PenNode = { id?: string; type?: string; children?: PenNode[]; descendants?: Record<string, PenNode>; [k: string]: unknown };

export interface PenReport {
  /** Layers brought over (copies count as one). */
  layers: number;
  components: number;
  copies: number;
  pictures: number;
  /** Picture files the .pen refers to that weren't found beside it. */
  missingPictures: string[];
  /** What was left out or changed, with how often: "vector paths (kept their space)" → 1. */
  leftOut: Record<string, number>;
}

export class PenError extends Error {}

/** Default line height for text that leaves it to the font (Pen uses the font's own; most are near 1.2). */
const FONT_LINE_HEIGHT = 1.2;

const LAYOUT: Record<string, NodeProps["layout"]> = { vertical: "column", horizontal: "row", none: "none" };
const JUSTIFY: Record<string, NodeProps["justify"]> = { start: "start", center: "center", end: "end", space_between: "between", space_around: "between" };
const ALIGN: Record<string, NodeProps["align"]> = { start: "start", center: "center", end: "end" };
const WEIGHTS: Record<string, number> = { thin: 100, extralight: 200, light: 300, normal: 400, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };

const isVar = (v: unknown): v is string => typeof v === "string" && v.startsWith("$");
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrVar = (v: unknown) => (isNum(v) || isVar(v) ? (v as number) : undefined);

/** Reads a Pen file's text into `into` (an empty document). `read` gives a picture file's bytes by the path the .pen uses. */
export async function importPen(text: string, into: Y.Doc, read: (url: string) => Uint8Array | undefined): Promise<PenReport> {
  let file: { version?: unknown; children?: unknown; variables?: Record<string, { type?: string; value?: unknown }>; themes?: unknown; imports?: unknown };
  try {
    file = JSON.parse(text);
  } catch (e) {
    throw new PenError(`This isn't a Pen file (it isn't valid JSON: ${(e as Error).message}).`);
  }
  if (!file || typeof file !== "object" || !Array.isArray(file.children)) throw new PenError("This isn't a Pen file.");
  if (typeof file.version === "string" && !file.version.startsWith("2.")) throw new PenError(`This Pen file is version ${file.version}; only version 2 files can be opened.`);

  const report: PenReport = { layers: 0, components: 0, copies: 0, pictures: 0, missingPictures: [], leftOut: {} };
  const leave = (what: string) => (report.leftOut[what] = (report.leftOut[what] ?? 0) + 1);

  // ---- Variables: a themed value becomes its first (default) value. Names Lemon can't take are renamed.
  const varNames = new Map<string, string>();
  const vars: Record<string, string | number> = {};
  for (const [name, def] of Object.entries(file.variables ?? {})) {
    let value = def?.value;
    if (Array.isArray(value)) {
      leave("themes (each variable keeps its first value)");
      value = (value.find((v) => !v?.theme) ?? value[0])?.value;
    }
    if (typeof value === "boolean") {
      leave("true/false variables");
      continue;
    }
    if (typeof value !== "string" && !isNum(value)) continue;
    const safe = /^[A-Za-z][\w-]*$/.test(name) ? name : `v-${name.replace(/[^\w-]/g, "-")}`;
    varNames.set(name, safe);
    vars[safe] = value;
  }
  if (file.imports && Object.keys(file.imports).length) leave("other Pen files it imports");
  /** A value with its variable reference renamed to Lemon's name for it. */
  const v = <T>(value: T): T => (isVar(value) && varNames.has(value.slice(1)) ? (`$${varNames.get(value.slice(1))}` as T) : value);
  /** A variable's value (for text, which can't refer to one). */
  const valueOf = (value: unknown) => (isVar(value) ? vars[varNames.get(value.slice(1)) ?? ""] : value);

  // ---- Every node by id, to read copies against their main.
  const byId = new Map<string, PenNode>();
  const walk = (n: PenNode) => {
    if (typeof n.id === "string") byId.set(n.id, n);
    (n.children ?? []).forEach(walk);
  };
  (file.children as PenNode[]).forEach(walk);
  /** The node a copy's change at `path` (an id path) lands on: the last id, through copies inside copies. */
  const target = (path: string) => byId.get(path.split("/").at(-1)!);
  /** What a node is drawn as: a copy is its main's kind. */
  const kindOf = (n: PenNode | undefined, depth = 0): string | undefined =>
    n?.type === "ref" && depth < 20 ? kindOf(byId.get(String(n.ref)), depth + 1) : n?.type;

  // ---- Pictures, read once each.
  const pictures = new Map<string, string | null>();
  const picture = async (url: string): Promise<string | null> => {
    if (pictures.has(url)) return pictures.get(url)!;
    const bytes = read(url);
    let id: string | null = null;
    if (bytes) {
      id = await assetId(bytes);
      putAsset(into, id, bytes);
      report.pictures++;
    } else report.missingPictures.push(url);
    pictures.set(url, id);
    return id;
  };

  /** One Pen fill (or fill list) as Lemon's one paint; undefined when it shows nothing. */
  const paint = async (fill: unknown): Promise<Paint | undefined> => {
    const list = (Array.isArray(fill) ? fill : [fill]).filter((f) => f !== undefined && f !== null && (typeof f !== "object" || (f as { enabled?: unknown }).enabled !== false));
    if (!list.length) return undefined;
    if (list.length > 1) leave("extra fills (the top one is kept)");
    const f = list.at(-1) as string | { type?: string; [k: string]: unknown };
    if (typeof f === "string") return v(f);
    if (f.type === "color" && typeof f.color === "string") return v(f.color);
    if (f.type === "image" && typeof f.url === "string") {
      const asset = await picture(f.url);
      const fit = f.mode === "contain" ? "contain" : f.mode === "stretch" ? "stretch" : "cover";
      // A missing picture keeps its place: drawn as a placeholder until the picture is there.
      return { type: "image", asset: asset ?? `missing:${f.url}`, fit };
    }
    if (f.type === "gradient") {
      const stops = (Array.isArray(f.colors) ? f.colors : []) as { color?: unknown; position?: unknown }[];
      const colours = stops.filter((s) => typeof s.color === "string").map((s) => ({ color: v(s.color as string), at: isNum(s.position) ? s.position : 0 }));
      if (!colours.length) return undefined;
      if ((f.gradientType ?? "linear") !== "linear") {
        leave("radial and angular gradients (shown as their first colour)");
        return colours[0]!.color;
      }
      // Pen turns counter-clockwise from "up"; Lemon's angle runs clockwise from "down".
      const rotation = isNum(f.rotation) ? f.rotation : 0;
      return { type: "linear", angle: (((180 + rotation) % 360) + 360) % 360, stops: colours };
    }
    leave(f.type === "shader" ? "shader fills" : f.type === "mesh_gradient" ? "mesh gradients" : "unknown fills");
    return undefined;
  };

  /** A Pen size as Lemon's, given how the parent lays out its children. */
  const size = (value: unknown, freeParent: boolean, hasChildren: boolean): Size | undefined => {
    if (isNum(value) || isVar(value)) return v(value) as Size;
    if (typeof value !== "string") return undefined;
    const m = /^(fill_container|fit_content)(?:\((-?[\d.]+)\))?$/.exec(value.trim());
    if (!m) return undefined;
    const fallback = m[2] !== undefined ? Number(m[2]) : undefined;
    if (m[1] === "fill_container") return freeParent && fallback !== undefined ? fallback : "fill";
    return !hasChildren && fallback !== undefined ? fallback : "fit";
  };

  /** A stroke from a node's stroke and strokeWidth (either may come from `base`, the node a change lands on). */
  const stroke = async (n: PenNode, base?: PenNode): Promise<Stroke | null | undefined> => {
    if (!("stroke" in n) && !("strokeWidth" in n)) return undefined;
    const fill = "stroke" in n ? n.stroke : base?.stroke;
    const width = "strokeWidth" in n ? n.strokeWidth : (base?.strokeWidth ?? 1);
    if (fill === undefined) return undefined;
    const colour = await paint(fill);
    if (typeof colour !== "string") {
      if (colour) leave("gradient or picture strokes");
      return null;
    }
    if (n.strokeAlignment && n.strokeAlignment !== "inner") leave("strokes centred or outside (drawn inside)");
    if (width && typeof width === "object") {
      const w = width as Record<string, unknown>;
      const side = (k: string) => (isNum(w[k]) ? (w[k] as number) : 0);
      return { color: colour, width: [side("top"), side("right"), side("bottom"), side("left")] };
    }
    const one = numOrVar(width) ?? 1;
    return { color: colour, width: v(one) };
  };

  /**
   * Lemon properties for a Pen node of kind `kind`. `whole` for a node of its own (Pen's defaults are
   * filled in); otherwise only the properties present are converted (a copy's own properties and its
   * changes, applied over its main's), with `base` the node they change.
   */
  const props = async (n: PenNode, kind: string | undefined, whole: boolean, freeParent: boolean, base?: PenNode): Promise<Partial<NodeProps>> => {
    const out: Record<string, unknown> = {};
    const has = (k: string) => k in n;
    if (typeof n.name === "string") out.name = n.name;
    if (isNum(n.x) && (whole ? freeParent || n.layoutPosition === "absolute" : true)) out.x = n.x;
    if (isNum(n.y) && (whole ? freeParent || n.layoutPosition === "absolute" : true)) out.y = n.y;
    if (has("enabled")) {
      if (n.enabled === false) out.visible = false;
      else if (n.enabled === true && !whole) out.visible = null;
    }
    if (numOrVar(n.opacity) !== undefined) out.opacity = v(n.opacity);
    if (n.layoutPosition === "absolute") out.absolute = true;
    else if (n.layoutPosition === "auto" && !whole) out.absolute = null;
    if (isNum(n.rotation) && n.rotation) out.rotation = n.rotation;
    if (n.flipX === true || n.flipY === true) leave("flips");
    if (n.reusable === true) out.component = true;

    const children = (kind === "frame" || kind === "group") && !!(n.children ?? base?.children)?.length;
    const text = kind === "text";
    // Text sizes count only with textGrowth (Pen ignores them otherwise).
    const growth = (n.textGrowth ?? base?.textGrowth) as string | undefined;
    if (!text || growth === "fixed-width" || growth === "fixed-width-height" || !whole) {
      const w = size(n.width, freeParent, children);
      if (w !== undefined && (!text || growth !== "auto")) out.width = w;
      const h = size(n.height, freeParent, children);
      if (h !== undefined && (!text || growth === "fixed-width-height")) out.height = h;
    }
    if (text && growth === "auto" && has("textGrowth")) out.width = "fit";

    if (has("cornerRadius")) {
      const r = n.cornerRadius;
      out.radius = Array.isArray(r) ? r.map((x) => v(numOrVar(x) ?? 0)) : v(numOrVar(r) ?? 0);
    }
    if (has("fill")) {
      const f = await paint(n.fill);
      if (text || kind === "icon") out.color = typeof f === "string" ? f : null;
      else out.fill = f ?? null;
    }
    const s = await stroke(n, base);
    if (s !== undefined && !text && kind !== "icon") out.stroke = s;
    if (has("effect")) {
      const effects = (Array.isArray(n.effect) ? n.effect : [n.effect]).filter((e) => e && (e as { enabled?: unknown }).enabled !== false) as { type?: string; [k: string]: unknown }[];
      const shadow = effects.find((e) => e.type === "shadow" && e.shadowType !== "inner");
      for (const e of effects) if (e !== shadow) leave(e.type === "shadow" ? "inner shadows" : e.type === "background_blur" ? "background blurs" : e.type === "blur" ? "blurs" : "other effects");
      if (shadow) {
        const off = (shadow.offset ?? {}) as { x?: unknown; y?: unknown };
        out.shadow = { x: numOrVar(off.x) ?? 0, y: numOrVar(off.y) ?? 0, blur: numOrVar(shadow.blur) ?? 0, color: v(typeof shadow.color === "string" ? shadow.color : "#00000040") };
      } else out.shadow = null;
    }

    if (kind === "frame" || kind === "group") {
      if (has("layout")) out.layout = LAYOUT[String(n.layout)] ?? "row";
      else if (whole) out.layout = kind === "group" ? "none" : "row";
      if (numOrVar(n.gap) !== undefined) out.gap = v(n.gap);
      if (has("padding")) out.padding = Array.isArray(n.padding) ? n.padding.map((p) => v(numOrVar(p) ?? 0)) : v(numOrVar(n.padding) ?? 0);
      if (has("justifyContent")) {
        out.justify = JUSTIFY[String(n.justifyContent)] ?? "start";
        if (n.justifyContent === "space_around") leave("space-around spacing (spaced between)");
      }
      if (has("alignItems")) out.align = ALIGN[String(n.alignItems)] ?? "start";
      if (has("clip")) out.clip = n.clip === true;
    }

    if (text) {
      if (has("content")) out.text = String(valueOf(n.content) ?? "");
      if (has("fontFamily")) out.font = v(n.fontFamily);
      if (numOrVar(n.fontSize) !== undefined) out.size = v(n.fontSize);
      if (has("fontWeight")) {
        const w = n.fontWeight;
        out.weight = isVar(w) ? v(w) : isNum(w) ? w : (WEIGHTS[String(w).toLowerCase().replace(/[\s-]/g, "")] ?? (Number(w) || 400));
      }
      if (has("fontStyle")) out.italic = /italic|oblique/i.test(String(valueOf(n.fontStyle)));
      if (numOrVar(n.letterSpacing) !== undefined) out.letterSpacing = v(n.letterSpacing);
      if (numOrVar(n.lineHeight) !== undefined) out.lineHeight = v(n.lineHeight);
      else if (whole) out.lineHeight = FONT_LINE_HEIGHT;
      if (has("textAlign")) {
        out.textAlign = n.textAlign === "center" || n.textAlign === "right" ? n.textAlign : "left";
        if (n.textAlign === "justify") leave("justified text (aligned left)");
      }
      if (n.underline === true || n.strikethrough === true) leave("underlines and strikethroughs");
      if (n.textAlignVertical && n.textAlignVertical !== "top") leave("text aligned to the middle or bottom of its box");
    }

    if (kind === "icon") {
      const library = String(valueOf(n.library ?? base?.library ?? "lucide"));
      if (has("icon") || has("library")) {
        const name = String(valueOf(n.icon ?? base?.icon) ?? "");
        out.icon = name;
        if (!/lucide|feather/i.test(library)) leave(`icons from ${library} (Lemon has Lucide's)`);
        else if (!hasIcon(name)) leave(`icons Lucide doesn't have (${name})`);
      }
    }
    if (kind === "ellipse" && (isNum(n.innerRadius) || has("startAngle") || has("sweepAngle"))) leave("arcs and rings (drawn as whole ellipses)");
    return out as Partial<NodeProps>;
  };

  // ---- The nodes, as records (plain until they go into the document).
  type Rec = Record<string, unknown>;
  const records = new Map<string, Rec>();
  const used = new Set<string>([ROOT_ID]);
  const idFor = (n: PenNode) => {
    let id = typeof n.id === "string" && n.id && !n.id.includes("/") ? n.id : "";
    while (!id || used.has(id)) id = `p${Math.random().toString(36).slice(2, 10)}`;
    used.add(id);
    return id;
  };
  const LEMON: Record<string, NodeType> = { frame: "frame", group: "frame", rectangle: "rect", ellipse: "ellipse", text: "text", icon: "icon" };

  const add = async (n: PenNode, parent: string, order: string, freeParent: boolean): Promise<void> => {
    const rec: Rec = { parent, order };
    const id = idFor(n);
    report.layers++;
    let kids: PenNode[] = [];
    if (n.type === "ref") {
      const main = byId.get(String(n.ref));
      if (!main) {
        leave("copies of components that aren't in the file");
        report.layers--;
        return;
      }
      if (main.reusable !== true) main.reusable = true; // its main becomes a component when that is read
      rec.type = "instance";
      rec.of = main.id;
      report.copies++;
      const kind = kindOf(main);
      const own = await props(n, kind, false, freeParent, main);
      for (const [k, val] of Object.entries(own)) if (val !== null && val !== undefined) rec[k] = val;
      for (const [path, change] of Object.entries(n.descendants ?? {})) {
        if (!change || typeof change !== "object") continue;
        if ("type" in change) {
          leave("whole parts replaced in copies");
          continue;
        }
        const on = target(path);
        const p = await props(change, kindOf(on), false, false, on);
        // A change to nothing (all of it left out) is not kept.
        const kept = Object.fromEntries(Object.entries(p).filter(([, val]) => val !== undefined));
        if (Object.keys(kept).length) rec[`/${path}`] = kept;
      }
    } else {
      const type = LEMON[String(n.type)];
      if (!type) {
        const what =
          n.type === "path" ? "vector paths (kept their space)" :
          n.type === "polygon" ? "polygons (kept their space)" :
          n.type === "note" || n.type === "prompt" || n.type === "context" ? "sticky notes, prompts and context notes" :
          n.type === "script" ? "script layers (kept their space)" :
          n.type === "browser" ? "live web pages (kept their space)" : `layers of type "${String(n.type)}"`;
        leave(what);
        if (!/kept their space/.test(what)) {
          report.layers--;
          return;
        }
        // An empty frame of the same size, so the layout around it stays as it was.
        rec.type = "frame";
        const p = await props({ ...n, fill: undefined, stroke: undefined, effect: undefined, type: "frame" }, "frame", true, freeParent);
        for (const [k, val] of Object.entries({ ...p, layout: "none" })) if (val !== null && val !== undefined) rec[k] = val;
      } else {
        rec.type = type;
        const p = await props(n, n.type, true, freeParent);
        for (const [k, val] of Object.entries(p)) if (val !== null && val !== undefined) rec[k] = val;
        if (type === "frame") kids = n.children ?? [];
      }
    }
    records.set(id, rec);
    const free = (rec.layout ?? "column") === "none";
    const keys = generateNKeysBetween(null, null, kids.length);
    for (const [i, c] of kids.entries()) await add(c, id, keys[i]!, free);
  };

  const top = file.children as PenNode[];
  const keys = generateNKeysBetween(null, null, top.length);
  for (const [i, n] of top.entries()) await add(n, ROOT_ID, keys[i]!, true);
  // Copies may refer to mains that weren't marked reusable: mark them now.
  for (const [id, rec] of records) if (byId.get(id)?.reusable === true && rec.type !== "instance") rec.component = true;
  for (const [, rec] of records) if (rec.component) report.components++;

  into.transact(() => {
    const nodes = nodesOf(into);
    for (const [id, rec] of records) nodes.set(id, new Y.Map(Object.entries(rec)));
    const map = varsOf(into);
    for (const [k, val] of Object.entries(vars)) map.set(k, val);
  });
  return report;
}

/** The report in plain words, for the person: what came over, and what didn't. */
export function describeReport(name: string, r: PenReport): { title: string; details: string[] } {
  const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
  const title = `Opened ${name}: ${n(r.layers, "layer")}, ${n(r.components, "component")}, ${n(r.copies, "copy", "copies")}, ${n(r.pictures, "picture")}.`;
  const details: string[] = [];
  if (r.missingPictures.length) details.push(`${n(r.missingPictures.length, "picture")} not found beside the file (shown as placeholders): ${r.missingPictures.slice(0, 3).join(", ")}${r.missingPictures.length > 3 ? ", …" : ""}`);
  for (const [what, count] of Object.entries(r.leftOut).sort((a, b) => b[1] - a[1])) details.push(`${what}: ${count.toLocaleString("en")}`);
  return { title, details };
}
