// Shader fills and effects as CanvasKit RuntimeEffects (SkSL, see shader-source.ts): compiled once per
// source and made into a Shader per draw, on whatever surface draws it (the canvas's own GPU surface in
// the editor). Pictures a shader samples come in as image shaders, never as copies of their pixels.
import type { CanvasKit, Image, RuntimeEffect, Shader } from "canvaskit-wasm";
import { BOX_UNIFORM, PIXEL_UNIFORM, boolUniform, sizeUniform, skslSource, uniformNumbers, type ShaderUniform, type SkslShader } from "./shader-source.js";

/** What one draw of a shader is given. */
export interface EffectRun {
  /** The output's size in node units; the shader draws from (0, 0) unless `at` moves it. */
  width: number;
  height: number;
  /** Where the box's top-left is (the shader's local matrix moves it there). */
  at?: { x: number; y: number };
  /** One device pixel in node units (for derivatives). */
  pixel: number;
  /** Values for the person's uniforms (as in the .pen file), over the shader's own defaults. */
  values?: Record<string, unknown>;
  time: number;
  /** The pointer in node units (y up), for @mouse. */
  mouse?: [number, number];
  /** A sampler's picture: by special name ("pencil:object", "pencil:background") or url. */
  image(name: string): Image | null | undefined;
  /** The node's @sdf as `encodeSdf` gives it. */
  sdf(): { distance: Image; direction: Image } | null | undefined;
}

export type Compiled = { effect: RuntimeEffect; shader: SkslShader };

export class ShaderEffects {
  private compiled = new Map<string, Compiled | { error: string }>();

  constructor(private ck: CanvasKit) {}

  /** Translates and compiles `source` (once): the effect, or why SkSL can't run it. */
  compile(source: string): Compiled | { error: string } {
    const known = this.compiled.get(source);
    if (known) return known;
    const shader = skslSource(source);
    let result: Compiled | { error: string };
    if ("error" in shader) result = shader;
    else {
      let error = "";
      const effect = this.ck.RuntimeEffect.Make(shader.sksl, (e) => (error = e));
      result = effect ? { effect, shader } : { error: error || "SkSL didn't compile" };
    }
    this.compiled.set(source, result);
    return result;
  }

  /** The shader for one draw of `source`, or why it can't be made. */
  make(source: string, run: EffectRun): Shader | { error: string } {
    const c = this.compile(source);
    if ("error" in c) return c;
    const { ck } = this;
    const { effect, shader } = c;
    // The pictures first: a sampler's size is a uniform.
    const children: Shader[] = [];
    const sizes = new Map<string, [number, number]>();
    const sdf = shader.children.some((ch) => ch.part !== "picture") ? run.sdf() : undefined;
    for (const ch of shader.children) {
      const u = shader.uniforms.find((x) => x.name === ch.sampler);
      let image: Image | null | undefined;
      if (ch.part === "picture") {
        const given = run.values?.[ch.sampler] ?? u?.default;
        image = typeof given === "string" && given ? run.image(given) : null;
      } else image = ch.part === "sdf-distance" ? sdf?.distance : sdf?.direction;
      if (!image) {
        children.push(ck.Shader.MakeColor(ck.TRANSPARENT, ck.ColorSpace.SRGB));
        if (!sizes.has(ch.sampler)) sizes.set(ch.sampler, [1, 1]);
        continue;
      }
      // An @sdf is blended texel by texel in the shader; pictures are sampled smoothly.
      const smooth = ch.part === "picture";
      children.push(
        image.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, smooth ? ck.FilterMode.Linear : ck.FilterMode.Nearest, smooth && u?.mipmap ? ck.MipmapMode.Linear : ck.MipmapMode.None),
      );
      if (!sizes.has(ch.sampler) || ch.part === "sdf-distance") sizes.set(ch.sampler, [image.width(), image.height()]);
    }
    // Integer uniforms are given as numbers too: CanvasKit turns them into ints.
    const floats = new Float32Array(effect.getUniformFloatCount());
    const byName = new Map<string, ShaderUniform>(shader.uniforms.map((u) => [u.name, u]));
    for (let i = 0; i < effect.getUniformCount(); i++) {
      const name = effect.getUniformName(i);
      const slot = effect.getUniform(i);
      const count = slot.columns * slot.rows;
      const values = this.value(name, count, byName, run, sizes);
      for (let k = 0; k < count; k++) {
        floats[slot.slot + k] = slot.isInteger ? Math.round(values[k] ?? 0) : (values[k] ?? 0);
      }
    }
    const at = run.at ?? { x: 0, y: 0 };
    const made = effect.makeShaderWithChildren(floats, children, [1, 0, at.x, 0, 1, at.y, 0, 0, 1]);
    for (const ch of children) ch.delete();
    return made;
  }

  private value(name: string, count: number, byName: Map<string, ShaderUniform>, run: EffectRun, sizes: Map<string, [number, number]>): number[] {
    if (name === BOX_UNIFORM) return [run.width, run.height];
    if (name === PIXEL_UNIFORM) return [run.pixel];
    const sized = [...sizes].find(([s]) => sizeUniform(s) === name);
    if (sized) return sized[1];
    const bool = [...byName.values()].find((u) => u.type === "bool" && boolUniform(u.name) === name);
    const u = bool ?? byName.get(name);
    if (!u) return [];
    const v =
      u.bound === "resolution"
        ? [run.width, run.height]
        : u.bound === "time"
          ? run.time
          : u.bound === "mouse"
            ? (run.mouse ?? [run.width / 2, run.height / 2])
            : (run.values?.[u.name] ?? u.default);
    return uniformNumbers(v, count);
  }
}

/** Every child a shader reads from an @sdf (it needs the node's distance field). */
export const readsSdf = (s: SkslShader) => s.children.some((c) => c.part !== "picture");
