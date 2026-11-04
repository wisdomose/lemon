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
const sizeOf = (name: string) => sizeUniform(name);

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

// ---- SkSL ---------------------------------------------------------------------------------------
// The same shaders run inside CanvasKit as RuntimeEffects, on the canvas's own GPU surface (as Pen runs
// them): no WebGL context of their own, no read-back. The GLSL is translated:
//   - `void main()` becomes `_pen_main()`, called from SkSL's `half4 main(float2 p)`, where p is in node
//     units from the box's top-left; gl_FragCoord is that point counted from the bottom-left (as in WebGL);
//   - each sampler2D becomes a child shader: texture2D(s, uv) reads it at uv (bottom-up, as WebGL reads a
//     picture loaded flipped) times its size in pixels (`_pen_size_<s>`), which textureSize() returns;
//   - an @sdf sampler is read from two pictures (distance in 16 bits, then its direction) and blended
//     between texels here, so it keeps its precision on any GPU;
//   - bool uniforms become ints; `#define`s are expanded; precision statements go;
//   - derivatives (dFdx, dFdy, fwidth), which SkSL lacks, are worked out by running main for the
//     pixel's neighbours first (across and along, paired in 2 × 2 squares of the node's own pixels as
//     GPUs pair them), keeping what each call was given (`_pen_px` is a device pixel in node units).
// What SkSL can't run (a sampler passed to a function, array constructors…) is reported, and
// the editor runs that shader with WebGL instead.

/** The uniform with a sampler's size in pixels (WebGL: a vec2; SkSL: a float2). */
export const sizeUniform = (sampler: string) => `_pen_size_${sampler}`;
/** A bool uniform as SkSL has it (an int). */
export const boolUniform = (name: string) => `_pen_bool_${name}`;
/** An @sdf's second picture (its direction), as a child shader. */
export const gradientChild = (sampler: string) => `_pen_grad_${sampler}`;
/** The uniform with the output's size in node units (SkSL). */
export const BOX_UNIFORM = "_pen_box";
/** The uniform with one device pixel in node units (SkSL, for derivatives). */
export const PIXEL_UNIFORM = "_pen_px";
/** An @sdf's distance is kept in 16 bits: this many steps per node unit, around the middle. */
export const SDF_STEPS = 16;
export const SDF_ZERO = 32768;

export interface SkslShader {
  /** The SkSL source. */
  sksl: string;
  uniforms: ShaderUniform[];
  /** Child shaders in the order SkSL declares them: a sampler, or an @sdf's direction picture. */
  children: { sampler: string; part: "picture" | "sdf-distance" | "sdf-direction" }[];
}

const GLSL_ONLY = [
  [/\bvarying\b|\battribute\b/, "varyings"],
  [/\bsampler2D\s+\w+\s*[,)]/, "a sampler passed to a function"],
  [/\b(?:float|int|vec[234]|ivec[234]|bool)\s*\[\s*\d*\s*\]\s*\(/, "array constructors"],
  [/\btexture(?:2D)?(?:Lod|Proj)\w*\s*\(|\btextureCube\s*\(/, "texture lookups other than texture2D"],
  [/\bgl_FragData\b|\bgl_PointCoord\b|\bgl_FrontFacing\b/, "gl_FragData, gl_PointCoord or gl_FrontFacing"],
] as const;

/** Expands object-like and function-like #defines, keeps #ifdef GL_ES branches; throws on what it can't follow. */
function preprocess(source: string): string {
  const defines = new Map<string, { params?: string[]; body: string }>([
    ["GL_ES", { body: "1" }],
    ["GL_FRAGMENT_PRECISION_HIGH", { body: "1" }],
  ]);
  const out: string[] = [];
  /** Whether each open #if branch is being kept, and whether a branch of it already was. */
  const stack: { on: boolean; taken: boolean }[] = [];
  const on = () => stack.every((s) => s.on);
  const test = (expr: string): boolean => {
    const e = expr
      .replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_m, a, b) => (defines.has(a ?? b) ? "1" : "0"))
      .replace(/\b[A-Za-z_]\w*\b/g, (w) => defines.get(w)?.body ?? "0")
      .trim();
    if (!/^[\d\s()!&|<>=+\-*/]+$/.test(e)) throw new Error(`#if ${expr.trim()} can't be followed`);
    return !!Function(`return (${e});`)();
  };
  for (const line of source.split(/\r?\n/)) {
    const d = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (!d) {
      out.push(on() ? line : "");
      continue;
    }
    const [, directive, rest = ""] = d;
    out.push("");
    if (directive === "ifdef" || directive === "ifndef") {
      const has = defines.has(rest.trim());
      const v = directive === "ifdef" ? has : !has;
      stack.push({ on: v, taken: v });
    } else if (directive === "if") {
      const v = on() && test(rest);
      stack.push({ on: v, taken: v });
    } else if (directive === "elif") {
      const top = stack.at(-1);
      if (!top) throw new Error("#elif without #if");
      top.on = !top.taken && test(rest);
      top.taken ||= top.on;
    } else if (directive === "else") {
      const top = stack.at(-1);
      if (!top) throw new Error("#else without #if");
      top.on = !top.taken;
      top.taken = true;
    } else if (directive === "endif") {
      if (!stack.pop()) throw new Error("#endif without #if");
    } else if (!on()) continue;
    else if (directive === "define") {
      const m = /^(\w+)(\(([^)]*)\))?\s*(.*)$/.exec(rest);
      if (!m) throw new Error(`#define ${rest} can't be followed`);
      defines.set(m[1]!, { ...(m[2] !== undefined ? { params: m[3]!.split(",").map((p) => p.trim()).filter(Boolean) } : {}), body: m[4]!.replace(/\/\/.*$/, "").trim() });
    } else if (directive === "undef") defines.delete(rest.trim());
    // #version, #extension, #pragma and #line mean nothing to SkSL.
    else if (!["version", "extension", "pragma", "line"].includes(directive!)) throw new Error(`#${directive} isn't supported`);
  }
  let text = out.join("\n");
  const own = [...defines].filter(([k]) => k !== "GL_ES" && k !== "GL_FRAGMENT_PRECISION_HIGH");
  for (let pass = 0; pass < 8 && own.length; pass++) {
    let changed = false;
    for (const [name, def] of own) {
      const re = new RegExp(`\\b${name}\\b`, "g");
      if (!def.params) {
        text = text.replace(re, () => ((changed = true), `(${def.body})`));
        continue;
      }
      // A function-like macro: its arguments, to the matching parenthesis.
      for (let m = re.exec(text); m; m = re.exec(text)) {
        let i = m.index + name.length;
        while (/\s/.test(text[i] ?? "")) i++;
        if (text[i] !== "(") continue;
        const args: string[] = [];
        let depth = 0;
        let start = i + 1;
        let end = -1;
        for (let j = i; j < text.length; j++) {
          const ch = text[j];
          if (ch === "(") depth++;
          else if (ch === ")" && --depth === 0) {
            args.push(text.slice(start, j));
            end = j + 1;
            break;
          } else if (ch === "," && depth === 1) {
            args.push(text.slice(start, j));
            start = j + 1;
          }
        }
        if (end < 0) throw new Error(`${name}( isn't closed`);
        const params = def.params;
        const body = params.length ? def.body.replace(new RegExp(`\\b(${params.join("|")})\\b`, "g"), (p) => `(${args[params.indexOf(p)]?.trim() ?? ""})`) : def.body;
        text = text.slice(0, m.index) + `(${body})` + text.slice(end);
        re.lastIndex = m.index;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return text;
}

/**
 * The shader as SkSL for CanvasKit's RuntimeEffect, or why it can't be (the WebGL runner draws it then).
 * Uniforms: the person's (bools as ints), `_pen_box` (the output in node units), and per sampler its
 * size in pixels; children: one per sampler, two per @sdf.
 */
export function skslSource(source: string): SkslShader | { error: string } {
  const uniforms = shaderUniforms(source);
  let body: string;
  try {
    body = preprocess(source);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // Comments go first, so nothing in them is mistaken for code.
  body = body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  for (const [re, what] of GLSL_ONLY) if (re.test(body)) return { error: `SkSL can't run ${what}` };
  body = body.replace(/^\s*precision\s+\w+\s+\w+\s*;/gm, "").replace(/\b(?:lowp|mediump|highp)\s+/g, "");
  if (!/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(body)) return { error: "no void main()" };
  const children: SkslShader["children"] = [];
  const decls: string[] = [];
  const helpers: string[] = [];
  const bools: string[] = [];
  const uniformRe = /\buniform\s+(\w+)\s+([\w\s,]+?)\s*;/g;
  body = body.replace(uniformRe, (_m, type: string, names: string) => {
    const list = names.split(",").map((n) => n.trim());
    return list
      .map((name) => {
        if (type === "bool") {
          bools.push(name);
          return `uniform int ${boolUniform(name)};`;
        }
        if (type !== "sampler2D") return `uniform ${type} ${name};`;
        const u = uniforms.find((x) => x.name === name);
        const size = sizeUniform(name);
        if (u?.bound === "sdf") {
          const grad = gradientChild(name);
          children.push({ sampler: name, part: "sdf-distance" }, { sampler: name, part: "sdf-direction" });
          decls.push(`uniform float2 ${size};`);
          // Distance (16 bits in r and g) and direction (r, g) are read texel by texel and blended here.
          helpers.push(
            `float4 _pen_sdf_${name}(float2 q) {`,
            `  half4 a = ${name}.eval(q);`,
            `  half4 g = ${grad}.eval(q);`,
            `  float d = (floor(float(a.r) * 255.0 + 0.5) * 256.0 + floor(float(a.g) * 255.0 + 0.5) - ${SDF_ZERO}.0) / ${SDF_STEPS}.0;`,
            `  return float4(d, float(g.r) * 2.0 - 1.0, float(g.g) * 2.0 - 1.0, 1.0);`,
            `}`,
            `vec4 _pen_tex_${name}(vec2 uv) {`,
            `  float2 q = clamp(float2(uv.x, 1.0 - uv.y) * ${size} - 0.5, float2(0.0), ${size} - 1.0);`,
            `  float2 i = floor(q);`,
            `  float2 f = q - i;`,
            `  float2 j = min(i + 1.0, ${size} - 1.0);`,
            `  float4 top = mix(_pen_sdf_${name}(i + 0.5), _pen_sdf_${name}(float2(j.x, i.y) + 0.5), f.x);`,
            `  float4 bottom = mix(_pen_sdf_${name}(float2(i.x, j.y) + 0.5), _pen_sdf_${name}(j + 0.5), f.x);`,
            `  return mix(top, bottom, f.y);`,
            `}`,
          );
          return `uniform shader ${name};\nuniform shader ${grad};`;
        }
        children.push({ sampler: name, part: "picture" });
        decls.push(`uniform float2 ${size};`);
        helpers.push(`vec4 _pen_tex_${name}(vec2 uv) { return vec4(${name}.eval(float2(uv.x, 1.0 - uv.y) * ${size})); }`);
        return `uniform shader ${name};`;
      })
      .join("\n");
  });
  for (const b of bools) body = body.replace(new RegExp(`\\b${b}\\b`, "g"), `(${boolUniform(b)} != 0)`);
  const samplers = new Set(children.map((c) => c.sampler));
  let unknown: string | undefined;
  body = body.replace(/\btexture(?:2D)?\s*\(\s*(\w+)\s*,/g, (_m, s: string) => (samplers.has(s) ? `_pen_tex_${s}(` : ((unknown ??= s), _m)));
  if (unknown) return { error: `texture2D reads ${unknown}, which isn't a sampler uniform` };
  body = body.replace(/\btextureSize\s*\(\s*(\w+)\s*,[^)]*\)/g, (_m, s: string) => `ivec2(${sizeUniform(s)})`);
  // texture2D's optional bias is dropped: the helpers take the coordinate only.
  for (const s of samplers) helpers.push(`vec4 _pen_tex_${s}(vec2 uv, float bias) { return _pen_tex_${s}(uv); }`);
  const derivatives = rewriteDerivatives(body);
  if ("error" in derivatives) return derivatives;
  body = derivatives.body;
  helpers.push(...derivatives.helpers);
  body = body
    .replace(/\bgl_FragCoord\b/g, "_pen_fc")
    .replace(/\bgl_FragColor\b/g, "_pen_color")
    .replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, "void _pen_main()")
    .replace(/\bdiscard\s*;/g, "{ _pen_color = vec4(0.0); return; }");
  // Uniforms first, then our globals and helpers, then the person's code.
  const lines = body.split("\n");
  const isUniform = (l: string) => /^\s*uniform\b/.test(l);
  const sksl = [
    ...lines.filter(isUniform),
    `uniform float2 ${BOX_UNIFORM};`,
    ...(derivatives.count ? [`uniform float ${PIXEL_UNIFORM};`, "int _pen_pass;", "float _pen_sx;", "float _pen_sy;"] : []),
    ...decls,
    "vec4 _pen_fc;",
    "vec4 _pen_color;",
    ...helpers,
    ...lines.map((l) => (isUniform(l) ? "" : l)),
    "half4 main(float2 p) {",
    ...(derivatives.count
      ? [
          // The neighbours first: the one across, then the one along (see rewriteDerivatives).
          `  _pen_sx = mod(floor(p.x / ${PIXEL_UNIFORM}), 2.0) < 0.5 ? 1.0 : -1.0;`,
          `  _pen_sy = mod(floor((${BOX_UNIFORM}.y - p.y) / ${PIXEL_UNIFORM}), 2.0) < 0.5 ? 1.0 : -1.0;`,
          `  _pen_pass = 1; _pen_fc = vec4(p.x + ${PIXEL_UNIFORM} * _pen_sx, ${BOX_UNIFORM}.y - p.y, 0.5, 1.0); _pen_color = vec4(0.0); _pen_main();`,
          `  _pen_pass = 2; _pen_fc = vec4(p.x, ${BOX_UNIFORM}.y - p.y + ${PIXEL_UNIFORM} * _pen_sy, 0.5, 1.0); _pen_color = vec4(0.0); _pen_main();`,
          "  _pen_pass = 0;",
        ]
      : []),
    `  _pen_fc = vec4(p.x, ${BOX_UNIFORM}.y - p.y, 0.5, 1.0);`,
    "  _pen_color = vec4(0.0);",
    "  _pen_main();",
    "  return half4(clamp(_pen_color, 0.0, 1.0));",
    "}",
  ].join("\n");
  return { sksl, uniforms, children };
}

/**
 * dFdx, dFdy and fwidth calls, each made a function of its own that keeps what it was given on the
 * neighbours' runs (`_pen_pass` 1: right, 2: up) and answers on the last run with the difference.
 */
function rewriteDerivatives(body: string): { body: string; helpers: string[]; count: number } | { error: string } {
  const helpers: string[] = [];
  let count = 0;
  const re = /\b(dFdx|dFdy|fwidth)\s*\(/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let j = open; j < body.length; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")" && --depth === 0) {
        close = j;
        break;
      }
    }
    if (close < 0) return { error: `${m[1]}( isn't closed` };
    const k = count++;
    const fn = `_pen_${m[1]}_${k}`;
    // The neighbour across is right of an even column and left of an odd one; along, above an even row
    // and below an odd one (rows counted up, as in WebGL): always right minus left, upper minus lower.
    const answer = m[1] === "dFdx" ? `(r - v) * _pen_sx` : m[1] === "dFdy" ? `(u - v) * _pen_sy` : `abs(r - v) + abs(u - v)`;
    helpers.push(`vec4 _pen_d${k}r; vec4 _pen_d${k}u;`);
    for (const [type, swz] of [["float", ".x"], ["vec2", ".xy"], ["vec3", ".xyz"], ["vec4", ""]] as const) {
      const wide = type === "vec4" ? "v" : type === "float" ? "vec4(v, 0.0, 0.0, 0.0)" : type === "vec2" ? "vec4(v, 0.0, 0.0)" : "vec4(v, 0.0)";
      helpers.push(
        `${type} ${fn}(${type} v) {`,
        `  if (_pen_pass == 1) _pen_d${k}r = ${wide}; else if (_pen_pass == 2) _pen_d${k}u = ${wide};`,
        `  ${type} r = _pen_d${k}r${swz}; ${type} u = _pen_d${k}u${swz};`,
        `  return ${answer};`,
        `}`,
      );
    }
    body = body.slice(0, m.index) + fn + body.slice(m.index + m[1]!.length);
    re.lastIndex = m.index + fn.length;
  }
  return { body, helpers, count };
}

/**
 * A uniform's value as numbers (`count` of them): a colour fills a vec3/vec4 (opaque when it has no
 * alpha), a list or a number fills from the start, a boolean is 1 or 0.
 */
export function uniformNumbers(v: unknown, count: number): number[] {
  if (typeof v === "string") {
    const c = colorNumbers(v);
    if (c) return [...c, 1, 1, 1, 1].slice(0, count);
  }
  const list = Array.isArray(v) ? v.map(Number) : typeof v === "number" ? [v] : typeof v === "boolean" ? [v ? 1 : 0] : [];
  return Array.from({ length: count }, (_, i) => list[i] ?? 0);
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
