// The shaders that come with Lemon ("Choose a style" → Shaders): .glsl files in src/main/shader-library,
// Lemon's own, written for it. Each is a fill (it makes the picture) or an effect (it reworks the node
// it is on), with a few looks to start from (values for its uniforms) and an example design using it.
import type { PenNode } from "../doc/schema.js";

export interface ShaderLook {
  label: string;
  uniforms: Record<string, number | string | number[]>;
}

export interface LibraryShader {
  id: string;
  name: string;
  kind: "fill" | "effect";
  /** What the example shows. */
  example: string;
  /** The first is the shader as written (its defaults). */
  looks: ShaderLook[];
}

export const SHADERS: LibraryShader[] = [
  {
    id: "aurora",
    name: "Aurora",
    kind: "fill",
    example: "Hero banner",
    looks: [
      { label: "Shader only", uniforms: {} },
      { label: "Ember", uniforms: { u_sky: "#1a0b05", u_first: "#ff9f1c", u_second: "#e63946" } },
      { label: "Mint dawn", uniforms: { u_sky: "#e8f4f0", u_first: "#5eead4", u_second: "#c4b5fd", u_softness: 0.9 } },
      { label: "Fast", uniforms: { u_speed: 0.6 } },
    ],
  },
  {
    id: "grain-gradient",
    name: "Grain Gradient",
    kind: "fill",
    example: "App icon and card",
    looks: [
      { label: "Shader only", uniforms: {} },
      { label: "Dusk", uniforms: { u_a: "#2b2d42", u_b: "#ef476f", u_c: "#073b4c", u_d: "#ffd166" } },
      { label: "Paper", uniforms: { u_a: "#f1ede4", u_b: "#e8dcc8", u_c: "#d9cbb3", u_d: "#f7f3ea", u_grain: 0.14 } },
      { label: "Clean", uniforms: { u_grain: 0 } },
    ],
  },
  {
    id: "contours",
    name: "Contours",
    kind: "fill",
    example: "Trail map card",
    looks: [
      { label: "Shader only", uniforms: {} },
      { label: "Night", uniforms: { u_paper: "#0d1b2a", u_ink: "#7dd3fc" } },
      { label: "Dense", uniforms: { u_lines: 30 } },
      { label: "Wide", uniforms: { u_scale: 0.8 } },
    ],
  },
  {
    id: "neon-edge",
    name: "Neon Edge",
    kind: "fill",
    example: "Sign button",
    looks: [
      { label: "Shader only", uniforms: {} },
      { label: "Ice", uniforms: { u_glow: "#38bdf8", u_inside: "#020617" } },
      { label: "Thick", uniforms: { u_width: 7 } },
      { label: "Steady", uniforms: { u_flicker: 0 } },
    ],
  },
  {
    id: "frosted-glass",
    name: "Frosted Glass",
    kind: "fill",
    example: "Glass card over a photo",
    looks: [
      { label: "Shader only", uniforms: { u_behind: "pencil:background" } },
      { label: "Clear", uniforms: { u_behind: "pencil:background", u_frost: 2, u_bend: 20 } },
      { label: "Milky", uniforms: { u_behind: "pencil:background", u_frost: 22, u_tintAmount: 0.35 } },
      { label: "Tinted", uniforms: { u_behind: "pencil:background", u_tint: "#6366f1", u_tintAmount: 0.3 } },
    ],
  },
  {
    id: "halftone",
    name: "Halftone",
    kind: "effect",
    example: "Poster",
    looks: [
      { label: "Content effect", uniforms: { u_content: "pencil:object" } },
      { label: "Fine", uniforms: { u_content: "pencil:object", u_spacing: 4 } },
      { label: "Coarse", uniforms: { u_content: "pencil:object", u_spacing: 16, u_angle: 15 } },
      { label: "Blue ink", uniforms: { u_content: "pencil:object", u_ink: "#1d4ed8", u_paper: "#fdfbf6" } },
    ],
  },
  {
    id: "dither",
    name: "Dither",
    kind: "effect",
    example: "Game card",
    looks: [
      { label: "Content effect", uniforms: { u_content: "pencil:object" } },
      { label: "Paper white", uniforms: { u_content: "pencil:object", u_dark: "#222222", u_light: "#f4f1ea" } },
      { label: "Big pixels", uniforms: { u_content: "pencil:object", u_pixel: 6 } },
      { label: "Amber", uniforms: { u_content: "pencil:object", u_dark: "#1a0f00", u_light: "#ffb000" } },
    ],
  },
  {
    id: "ripple",
    name: "Ripple",
    kind: "effect",
    example: "Pool party flyer",
    looks: [
      { label: "Content effect", uniforms: { u_content: "pencil:object" } },
      { label: "Gentle", uniforms: { u_content: "pencil:object", u_strength: 2 } },
      { label: "Corner", uniforms: { u_content: "pencil:object", u_centre: [0.1, 0.9] } },
      { label: "Tight rings", uniforms: { u_content: "pencil:object", u_spacing: 12 } },
    ],
  },
];

/** A shader as a fill or effect for the .pen file, its file at `url`. */
export function shaderEntry(url: string, look: ShaderLook) {
  return { type: "shader" as const, url, uniforms: { ...look.uniforms } };
}

/**
 * An editable example using the shader (Pen's "Use Shader Example"): a frame whose fill is the shader,
 * or, for an effect, a small design with the shader as its effect. Its top-left at 0, 0.
 */
export function shaderExample(s: LibraryShader, url: string): PenNode {
  const entry = shaderEntry(url, s.looks[0]!);
  const text = (content: string, size: number, fill: string, weight = "700") => ({ type: "text", content, fontSize: size, fontWeight: weight, fill, fontFamily: "Inter" });
  if (s.kind === "fill") {
    const dark = s.id !== "contours" && s.id !== "frosted-glass";
    const ink = dark ? "#FFFFFF" : "#1C1917";
    if (s.id === "frosted-glass") {
      // Glass needs something behind it: a bright backdrop with the glass card on top.
      return {
        type: "frame",
        name: s.example,
        width: 520,
        height: 340,
        layout: "none",
        fill: { type: "gradient", gradientType: "linear", rotation: 135, colors: [{ color: "#F97316", position: 0 }, { color: "#8B5CF6", position: 1 }] },
        children: [
          { type: "ellipse", name: "Sun", x: 320, y: 30, width: 160, height: 160, fill: "#FDE047" },
          { type: "ellipse", name: "Moon", x: 40, y: 200, width: 120, height: 120, fill: "#22D3EE" },
          {
            type: "frame",
            name: "Glass card",
            x: 90,
            y: 70,
            width: 340,
            height: 200,
            cornerRadius: 28,
            layout: "vertical",
            padding: 28,
            gap: 8,
            fill: [entry],
            children: [text("Glass", 34, "#FFFFFF"), text("What's behind shows through, softened.", 14, "#FFFFFFCC", "400")],
          },
        ],
      } as PenNode;
    }
    return {
      type: "frame",
      name: s.example,
      width: 520,
      height: 300,
      cornerRadius: s.id === "neon-edge" ? 150 : 24,
      layout: "vertical",
      justifyContent: "end",
      padding: 32,
      gap: 6,
      fill: [entry],
      children: [text(s.name, 40, ink), text("Made with a shader fill. Change its look in the Fill section.", 14, ink + "CC", "400")],
    } as PenNode;
  }
  // An effect works on what the node draws: a little poster for it to rework.
  return {
    type: "frame",
    name: s.example,
    width: 420,
    height: 300,
    cornerRadius: 20,
    layout: "vertical",
    padding: 32,
    gap: 10,
    fill: { type: "gradient", gradientType: "linear", rotation: 160, colors: [{ color: "#FDE68A", position: 0 }, { color: "#F472B6", position: 0.55 }, { color: "#6366F1", position: 1 }] },
    effect: [entry],
    children: [
      text("SUMMER", 64, "#111827", "900"),
      text("SOUNDS", 64, "#FFFFFF", "900"),
      text("Fri 14 Aug · The Old Baths", 16, "#111827", "600"),
    ],
  } as PenNode;
}
