// Runs Pen-format fragment shaders (render/shader-source.ts) on a WebGL 1.0 context of their own, for
// the canvas's shader fills and effects and the gallery's shader cards. CanvasKit (Skia) can't run GLSL,
// so a shader draws here and the result is handed back as a picture.
import { shaderUniforms, uniformNumbers, webglSource, type ShaderUniform } from "../../render/shader-source.js";
import type { Pixels } from "../../render/sdf.js";

export type { Pixels };


export interface Run {
  /** Output size in node units, and device pixels per unit. */
  width: number;
  height: number;
  scale: number;
  /** Values for the person's uniforms (as in the .pen file), over the shader's own defaults. */
  values?: Record<string, unknown>;
  time?: number;
  /** The pointer in node units (y up), for @mouse. */
  mouse?: [number, number];
  /** Pictures for sampler uniforms: by special name ("pencil:object", "pencil:background", "sdf") or url. */
  textures?: (name: string) => Pixels | TexImageSource | null | undefined;
}

interface Program {
  program: WebGLProgram;
  uniforms: ShaderUniform[];
  sized: string[];
  locations: Map<string, WebGLUniformLocation | null>;
}

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const VERTEX = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

export class ShaderRunner {
  readonly canvas = document.createElement("canvas");
  private gl: WebGLRenderingContext | null;
  private programs = new Map<string, Program | { error: string }>();
  private floats: boolean;
  /** Float textures can be sampled smoothly (otherwise they are read texel by texel). */
  private floatsLinear: boolean;

  constructor() {
    this.gl = this.canvas.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    this.floats = !!this.gl?.getExtension("OES_texture_float");
    this.floatsLinear = !!this.gl?.getExtension("OES_texture_float_linear");
    this.gl?.getExtension("OES_standard_derivatives");
    if (this.gl) {
      const buffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, QUAD, this.gl.STATIC_DRAW);
    }
  }

  get available(): boolean {
    return !!this.gl;
  }

  /** Compiles `source` (once): its uniforms, or why it doesn't compile. */
  prepare(source: string): { uniforms: ShaderUniform[] } | { error: string } {
    const p = this.program(source);
    return "error" in p ? p : { uniforms: p.uniforms };
  }

  private program(source: string): Program | { error: string } {
    const known = this.programs.get(source);
    if (known) return known;
    const gl = this.gl;
    if (!gl) return { error: "WebGL isn't available." };
    const { source: fragment, sized } = webglSource(source);
    const compile = (type: number, text: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "The shader doesn't compile.");
      return s;
    };
    let result: Program | { error: string };
    try {
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.bindAttribLocation(program, 0, "p");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "The shader doesn't link.");
      result = { program, uniforms: shaderUniforms(source), sized, locations: new Map() };
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    this.programs.set(source, result);
    return result;
  }

  /** Draws `source` into this runner's canvas (read it before the next run), or says why it can't. */
  run(source: string, r: Run): { ok: true; uniforms: ShaderUniform[] } | { ok: false; error: string } {
    const gl = this.gl;
    const p = this.program(source);
    if (!gl || "error" in p) return { ok: false, error: gl ? (p as { error: string }).error : "WebGL isn't available." };
    const w = Math.max(1, Math.round(r.width * r.scale));
    const h = Math.max(1, Math.round(r.height * r.scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p.program);
    const at = (name: string) => {
      if (!p.locations.has(name)) p.locations.set(name, gl.getUniformLocation(p.program, name));
      return p.locations.get(name)!;
    };
    gl.uniform2f(at("_pen_scale"), w / r.width, h / r.height);
    gl.uniform2f(at("_pen_origin"), 0, 0);
    const textures: WebGLTexture[] = [];
    let unit = 0;
    for (const u of p.uniforms) {
      const loc = at(u.name);
      if (!loc && u.type !== "sampler2D") continue;
      if (u.type === "sampler2D") {
        const given = r.values?.[u.name] ?? u.default;
        const key = u.bound === "sdf" ? "sdf" : typeof given === "string" ? given : "";
        const pixels = key ? r.textures?.(key) : null;
        const tex = gl.createTexture()!;
        textures.push(tex);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // As Pen loads them: flipped, so texture2D(tex, gl_FragCoord.xy / resolution) shows the picture upright.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        let size: [number, number] = [1, 1];
        let filter: number = gl.LINEAR;
        if (pixels && !(pixels instanceof ImageData) && "data" in pixels) {
          const float = pixels.float && this.floats;
          const data = pixels.float ? (float ? (pixels.data as Float32Array) : toBytes(pixels.data as Float32Array)) : new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixels.width, pixels.height, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
          if (float && !this.floatsLinear) filter = gl.NEAREST;
          size = [pixels.width, pixels.height];
        } else if (pixels) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          size = [(pixels as { width: number }).width, (pixels as { height: number }).height];
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        }
        // WebGL 1.0 samples textures of any size only clamped and without mipmaps.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.uniform1i(loc, unit);
        if (p.sized.includes(u.name)) gl.uniform2f(at(`_pen_size_${u.name}`), size[0], size[1]);
        unit++;
        continue;
      }
      const v =
        u.bound === "resolution"
          ? [r.width, r.height]
          : u.bound === "time"
            ? (r.time ?? 0)
            : u.bound === "mouse"
              ? (r.mouse ?? [r.width / 2, r.height / 2])
              : (r.values?.[u.name] ?? u.default);
      setUniform(gl, loc, u, v);
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    for (const t of textures) gl.deleteTexture(t);
    return { ok: true, uniforms: p.uniforms };
  }
}

/** Without float textures: distance squeezed into a byte around 128 (an SDF then reads coarse, but reads). */
function toBytes(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(128 + f[i]! * 4)));
  return out;
}

const numbers = uniformNumbers;

function setUniform(gl: WebGLRenderingContext, loc: WebGLUniformLocation | null, u: ShaderUniform, v: unknown) {
  if (!loc) return;
  switch (u.type) {
    case "float":
      return gl.uniform1f(loc, numbers(v, 1)[0]!);
    case "int":
    case "bool":
      return gl.uniform1i(loc, Math.round(numbers(v, 1)[0]!));
    case "vec2":
      return gl.uniform2fv(loc, numbers(v, 2));
    case "vec3":
      return gl.uniform3fv(loc, numbers(v, 3));
    case "vec4":
      return gl.uniform4fv(loc, numbers(v, 4));
    case "ivec2":
      return gl.uniform2iv(loc, numbers(v, 2).map(Math.round));
    case "ivec3":
      return gl.uniform3iv(loc, numbers(v, 3).map(Math.round));
    case "ivec4":
      return gl.uniform4iv(loc, numbers(v, 4).map(Math.round));
  }
}
