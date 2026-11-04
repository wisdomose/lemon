// Shader sources (src/render/shader-source.ts): Pen's uniform annotations, the source WebGL gets, and
// the SkSL CanvasKit runs (drawn here with CanvasKit's CPU surface).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOX_UNIFORM, animated, boolUniform, colorNumbers, shaderUniforms, skslSource, webglSource } from "../src/render/shader-source.js";
import { ShaderEffects, type EffectRun } from "../src/render/shader-effect.js";
import { encodeSdf, sdf } from "../src/render/sdf.js";
import { setup } from "./helpers.js";

// Pen's own example, from its guide.
const CHECKER = `/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Size
 * @default 32
 */
uniform float u_size;

/**
 * @label Primary Color
 * @color
 * @default #ffffff
 */
uniform vec3 u_color1;

/**
 * @label Pixel Size
 * @default 8
 * @range 1, 64
 */
uniform float u_pixelSize;

void main() {
  vec2 cell = floor(gl_FragCoord.xy / u_size);
  gl_FragColor = vec4(u_color1 * mod(cell.x + cell.y, 2.0), 1.0);
}`;

describe("shader uniforms", () => {
  it("reads each uniform's annotations", () => {
    expect(shaderUniforms(CHECKER)).toEqual([
      { name: "u_resolution", type: "vec2", bound: "resolution" },
      { name: "u_size", type: "float", label: "Size", default: 32 },
      { name: "u_color1", type: "vec3", label: "Primary Color", color: true, default: "#ffffff" },
      { name: "u_pixelSize", type: "float", label: "Pixel Size", default: 8, min: 1, max: 64 },
    ]);
  });

  it("knows the uniforms the app sets, and a list default", () => {
    const u = shaderUniforms("/** @time */ uniform float t;\n/** @sdf */ uniform sampler2D s;\n/** @default 0.5, 0.25 */ uniform vec2 c;");
    expect(u.map((x) => x.bound)).toEqual(["time", "sdf", undefined]);
    expect(u[2]!.default).toEqual([0.5, 0.25]);
    expect(animated(u)).toBe(true);
  });

  it("reads colours with and without alpha", () => {
    expect(colorNumbers("#ff0000")).toEqual([1, 0, 0]);
    expect(colorNumbers("#00000080")).toEqual([0, 0, 0, 128 / 255]);
    expect(colorNumbers("red")).toBeNull();
  });
});

describe("the source WebGL gets", () => {
  it("measures gl_FragCoord in node units and keeps the person's main", () => {
    const { source } = webglSource("#version 100\n" + CHECKER);
    expect(source).not.toContain("#version");
    expect(source).toContain("#define gl_FragCoord _pen_fc");
    expect(source).toContain("void _pen_main()");
    expect(source).toMatch(/void main\(\) \{\n {2}_pen_fc = vec4\(gl_FragCoord\.xy \/ _pen_scale \+ _pen_origin/);
  });

  it("gives textureSize a uniform of ours and puts #extension first", () => {
    const { source, sized } = webglSource("uniform sampler2D tex;\n#extension GL_OES_standard_derivatives : enable\nvoid main() { vec2 s = vec2(textureSize(tex, 0)); gl_FragColor = vec4(s, 0.0, 1.0); }");
    expect(sized).toEqual(["tex"]);
    expect(source.startsWith("#extension GL_OES_standard_derivatives : enable")).toBe(true);
    expect(source).toContain("ivec2(_pen_size_tex)");
    expect(source).toContain("uniform vec2 _pen_size_tex;");
  });

  it("every library shader labels the uniforms a person sets", () => {
    const dir = join(import.meta.dirname, "..", "src", "main", "shader-library");
    for (const file of readdirSync(dir)) {
      const unlabeled = shaderUniforms(readFileSync(join(dir, file), "utf8")).filter((u) => !u.bound && !u.label);
      expect(unlabeled.map((u) => `${file} ${u.name}`)).toEqual([]);
    }
  });
});

describe("the SkSL CanvasKit runs (shaders on the canvas's own surface)", () => {
  const dir = join(import.meta.dirname, "..", "src", "main", "shader-library");
  const library = readdirSync(dir).filter((f) => f.endsWith(".glsl"));

  /** Draws `source` over a w × h box at 1:1; its pixels, top row first, unpremultiplied. */
  async function draw(source: string, w: number, h: number, run: Partial<EffectRun> = {}) {
    const { engine } = await setup();
    const { ck } = engine;
    const made = new ShaderEffects(ck).make(source, { width: w, height: h, pixel: 1, time: 0, image: () => null, sdf: () => null, ...run });
    if ("error" in made) throw new Error(made.error);
    const surface = ck.MakeSurface(w, h)!;
    const paint = new ck.Paint();
    paint.setShader(made);
    surface.getCanvas().drawRect(ck.XYWHRect(0, 0, w, h), paint);
    const image = surface.makeImageSnapshot();
    const px = image.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
    paint.delete();
    surface.delete();
    return (x: number, y: number) => [...px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
  }

  it("translates and compiles every library shader", async () => {
    const { engine } = await setup();
    const effects = new ShaderEffects(engine.ck);
    for (const file of library) {
      const compiled = effects.compile(readFileSync(join(dir, file), "utf8"));
      expect("error" in compiled ? `${file}: ${compiled.error}` : file).toBe(file);
    }
  });

  it("draws every library shader with its defaults, a picture and a distance field", async () => {
    const { engine } = await setup();
    const { ck } = engine;
    const picture = ck.MakeImage({ width: 8, height: 8, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Premul, colorSpace: ck.ColorSpace.SRGB }, new Uint8Array(8 * 8 * 4).fill(255), 32)!;
    const shape = { width: 40, height: 30, data: new Uint8Array(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) };
    const field = encodeSdf(ck, sdf(shape, { x: 0, y: 0, w: 40, h: 30 })!)!;
    for (const file of library) {
      const at = await draw(readFileSync(join(dir, file), "utf8"), 40, 30, { time: 1.5, image: () => picture, sdf: () => field });
      // Every library shader paints its whole box opaque.
      expect([file, at(20, 15)[3]]).toEqual([file, 255]);
    }
  });

  it("keeps the person's main, measures gl_FragCoord from the bottom-left, and names our uniforms", () => {
    const t = skslSource(CHECKER);
    if ("error" in t) throw new Error(t.error);
    expect(t.sksl).toContain("void _pen_main()");
    expect(t.sksl).toContain("half4 main(float2 p)");
    expect(t.sksl).toContain(`_pen_fc = vec4(p.x, ${BOX_UNIFORM}.y - p.y, 0.5, 1.0);`);
    expect(t.sksl).not.toMatch(/\bgl_Frag(Coord|Color)\b/);
    expect(t.children).toEqual([]);
  });

  it("draws gl_FragCoord bottom-up in node units, as WebGL does", async () => {
    // Red grows to the right, green upwards.
    const at = await draw("/** @resolution */ uniform vec2 r;\nvoid main() { gl_FragColor = vec4(gl_FragCoord.xy / r, 0.0, 1.0); }", 100, 50);
    expect(at(0, 49).slice(0, 2)).toEqual([1, 3]); // bottom-left: (0.5 / 100, 0.5 / 50)
    expect(at(99, 0).slice(0, 2)).toEqual([254, 252]);
  });

  it("reads a sampler as a picture loaded flipped: uv (0, 0) is its bottom-left", async () => {
    const { engine } = await setup();
    const { ck } = engine;
    // Top half red, bottom half blue.
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) data.set(i < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const image = ck.MakeImage({ width: 4, height: 4, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Premul, colorSpace: ck.ColorSpace.SRGB }, data, 16)!;
    const source = "/** @default pencil:background */ uniform sampler2D tex;\n/** @resolution */ uniform vec2 r;\nvoid main() { gl_FragColor = texture2D(tex, gl_FragCoord.xy / r); }";
    const at = await draw(source, 20, 20, { image: (name) => (name === "pencil:background" ? image : null) });
    expect(at(10, 2)).toEqual([255, 0, 0, 255]);
    expect(at(10, 17)).toEqual([0, 0, 255, 255]);
    // textureSize() is the picture's size in pixels.
    const size = await draw("uniform sampler2D tex;\nvoid main() { gl_FragColor = vec4(vec2(textureSize(tex, 0)) / 255.0, 0.0, 1.0); }", 2, 2, { values: { tex: "pencil:object" }, image: () => image });
    expect(size(0, 0).slice(0, 2)).toEqual([4, 4]);
  });

  it("reads an @sdf's distance (node units, inside positive) and its direction", async () => {
    const { engine } = await setup();
    const { ck } = engine;
    // A 60 × 40 box filled but for its outer 10 units.
    const shape = { width: 60, height: 40, data: new Uint8Array(60 * 40 * 4) };
    for (let y = 10; y < 30; y++) for (let x = 10; x < 50; x++) shape.data[(y * 60 + x) * 4 + 3] = 255;
    const pixels = sdf(shape, { x: 0, y: 0, w: 60, h: 40 })!;
    const field = encodeSdf(ck, pixels)!;
    const source = "/** @sdf */ uniform sampler2D s;\n/** @resolution */ uniform vec2 r;\nvoid main() { vec4 f = texture2D(s, gl_FragCoord.xy / r); gl_FragColor = vec4(clamp(f.r + 16.0, 0.0, 255.0) / 255.0, f.g * 0.5 + 0.5, f.b * 0.5 + 0.5, 1.0); }";
    const at = await draw(source, 60, 40, { sdf: () => field });
    const expected = (x: number, y: number) => pixels.data[(y * 60 + x) * 4]!;
    for (const [x, y] of [[30, 20], [12, 20], [5, 5], [55, 35]] as const) expect(Math.abs(at(x, y)[0]! - (expected(x, y) + 16))).toBeLessThanOrEqual(1);
    // The distance grows inwards: right from the left edge, down (y up: −) from the top edge.
    expect(at(12, 20)[1]).toBeGreaterThan(200);
    expect(at(30, 12)[2]).toBeLessThan(60);
  });

  it("turns bools into ints, expands #defines, drops precision and keeps #ifdef GL_ES branches", async () => {
    const source = [
      "#ifdef GL_ES",
      "precision mediump float;",
      "#endif",
      "#define HALF 0.5",
      "#define MIX(a, b) ((a) * HALF + (b) * HALF)",
      "#ifndef GL_ES",
      "this is never seen;",
      "#endif",
      "/** @default true */ uniform bool u_on;",
      "void main() { gl_FragColor = vec4(u_on ? MIX(1.0, 0.0) : 0.0, 0.0, 0.0, 1.0); }",
    ].join("\n");
    const t = skslSource(source);
    if ("error" in t) throw new Error(t.error);
    expect(t.sksl).toContain(`uniform int ${boolUniform("u_on")};`);
    expect(t.sksl).not.toContain("precision");
    expect((await draw(source, 1, 1))(0, 0)[0]).toBe(128);
    expect((await draw(source, 1, 1, { values: { u_on: false } }))(0, 0)[0]).toBe(0);
  });

  it("works out derivatives from the neighbouring pixels", async () => {
    // fwidth of x in node units at 1:1 is one pixel; at 2 pixels per unit, half a unit.
    const source = "void main() { gl_FragColor = vec4(fwidth(gl_FragCoord.x) * 100.0 / 255.0, dFdx(gl_FragCoord.x * 2.0) * 100.0 / 255.0, dFdy(gl_FragCoord.y) * 100.0 / 255.0, 1.0); }";
    expect((await draw(source, 4, 4))(1, 1).slice(0, 3)).toEqual([100, 200, 100]);
    expect((await draw(source, 4, 4, { pixel: 0.5 }))(2, 1).slice(0, 3)).toEqual([50, 100, 50]);
  });

  it("says what SkSL can't run, so the editor falls back to WebGL", () => {
    expect(skslSource("float f(sampler2D t) { return 1.0; }\nvoid main() { gl_FragColor = vec4(1.0); }")).toEqual({ error: "SkSL can't run a sampler passed to a function" });
    expect(skslSource("varying vec2 v;\nvoid main() { gl_FragColor = vec4(1.0); }")).toEqual({ error: "SkSL can't run varyings" });
    expect(skslSource("void main() { gl_FragColor = texture2D(nope, vec2(0.0)); }")).toEqual({ error: "texture2D reads nope, which isn't a sampler uniform" });
  });
});
