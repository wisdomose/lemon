// Shader sources (src/render/shader-source.ts): Pen's uniform annotations, and the source WebGL gets.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { animated, colorNumbers, shaderUniforms, webglSource } from "../src/render/shader-source.js";

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
