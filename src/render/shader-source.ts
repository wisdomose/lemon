// Shader fills and effects, as Pen writes them (its scripts-and-shaders guide): WebGL 1.0 fragment
// shaders whose uniforms are described by `@` annotations in the block comment before each one. This
// reads those annotations and turns the source into one plain WebGL 1.0 can compile:
//   - gl_FragCoord is in the node's own units (a node 200 wide has x 0..200 at any zoom), counted
//     from its bottom-left corner as in WebGL;
//   - textureSize(sampler, lod), Pen's one addition, reads the sampler's size from a uniform of ours.

export type UniformType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "ivec2" | "ivec3" | "ivec4" | "sampler2D";

export interface ShaderUniform {
  name: string;
  type: UniformType;
  label?: string;
  /** A vec3/vec4 to pick as a colour. */
  color?: boolean;
  /** As written after @default (a number, "#rrggbb", a list, a url). */
  default?: number | boolean | string | number[];
  min?: number;
  max?: number;
  /** Set by the app, never by the person: the output's size, the time, the pointer, the shape's distance field. */
  bound?: "resolution" | "time" | "mouse" | "sdf";
  mipmap?: boolean;
}

const TYPES = new Set<string>(["float", "int", "bool", "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "sampler2D"]);

function value(text: string): number | boolean | string | number[] {
  const t = text.trim();
  if (t === "true" || t === "false") return t === "true";
  if (/^-?[\d.]+(e-?\d+)?$/i.test(t)) return Number(t);
  const list = t.replace(/^[[(]|[\])]$/g, "");
  if (/^-?[\d.]+(\s*,\s*-?[\d.]+)+$/.test(list)) return list.split(",").map(Number);
  return t.replace(/^["']|["']$/g, "");
}

/** The uniforms a shader declares, with what their comments say about them. */
export function shaderUniforms(source: string): ShaderUniform[] {
  const out: ShaderUniform[] = [];
  const re = /(?:\/\*\*?([\s\S]*?)\*\/\s*)?uniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+(\w+)\s*;/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const [, comment = "", type, name] = m;
    if (!TYPES.has(type!)) continue;
    const u: ShaderUniform = { name: name!, type: type as UniformType };
    for (const line of comment.split(/\r?\n/).map((l) => l.replace(/^\s*\*?\s?/, "").trim())) {
      const tag = /^@(\w+)\s*(.*)$/.exec(line);
      if (!tag) continue;
      const [, key, rest = ""] = tag;
      if (key === "resolution" || key === "time" || key === "mouse" || key === "sdf") u.bound = key;
      else if (key === "color") u.color = true;
      else if (key === "mipmap") u.mipmap = true;
      else if (key === "label") u.label = rest;
      else if (key === "default") u.default = value(rest);
      else if (key === "min") u.min = Number(rest);
      else if (key === "max") u.max = Number(rest);
      else if (key === "range") [u.min, u.max] = rest.split(",").map((v) => Number(v.trim())) as [number, number];
    }
    out.push(u);
  }
  return out;
}

/** The sampler uniforms whose size textureSize() asks for: their size comes in `_pen_size_<name>`. */
const sizeOf = (name: string) => `_pen_size_${name}`;

/**
 * The shader as WebGL 1.0 compiles it, drawing at `scale` device pixels per node unit with the output's
 * bottom-left at (`_pen_origin`) in node units. Our uniforms: `_pen_scale`, `_pen_origin`, and
 * `_pen_size_<sampler>` for each sampler textureSize() reads.
 */
export function webglSource(source: string): { source: string; sized: string[] } {
  let body = source.replace(/^\s*#version[^\n]*\n/m, "");
  // #extension lines must come before anything else.
  const extensions: string[] = [];
  body = body.replace(/^\s*#extension[^\n]*$/gm, (line) => (extensions.push(line.trim()), ""));
  const sized = new Set<string>();
  body = body.replace(/textureSize\s*\(\s*(\w+)\s*,[^)]*\)/g, (_m, s: string) => (sized.add(s), `ivec2(${sizeOf(s)})`));
  body = body.replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, "void _pen_main()");
  const prelude = [
    ...extensions,
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "uniform vec2 _pen_scale;",
    "uniform vec2 _pen_origin;",
    ...[...sized].map((s) => `uniform vec2 ${sizeOf(s)};`),
    "vec4 _pen_fc;",
    "#define gl_FragCoord _pen_fc",
  ];
  const wrapper = ["#undef gl_FragCoord", "void main() {", "  _pen_fc = vec4(gl_FragCoord.xy / _pen_scale + _pen_origin, gl_FragCoord.zw);", "  _pen_main();", "}"];
  return { source: [...prelude, body, ...wrapper].join("\n"), sized: [...sized] };
}

/** "#rrggbb" or "#rrggbbaa" as 0..1 numbers (three or four). */
export function colorNumbers(hex: string): number[] | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const n = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255);
  return m[2] ? [...n, parseInt(m[2], 16) / 255] : n;
}

/** Whether a shader needs drawing again every frame (it reads the time). */
export const animated = (uniforms: ShaderUniform[]) => uniforms.some((u) => u.bound === "time");
