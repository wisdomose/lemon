// The editor's ShaderHost (render/draw.ts). Shader fills and effects run inside CanvasKit as
// RuntimeEffects (render/shader-effect.ts), on the canvas's own GPU surface: the pictures they sample are
// image shaders, nothing is read back. A shader SkSL can't run is drawn with WebGL instead (shader-gl.ts),
// and the console says why. Shader files are read beside the document (once each, until the document is
// opened again).
//
// As in Pen, only the shaders of what is selected move: the canvas gives each node its own clock
// (`time`), which only runs for selected nodes; every other shader is drawn still at its clock's time.
import type { CanvasKit, Image, Shader } from "canvaskit-wasm";
import type { Box } from "../../layout/layout.js";
import type { ShaderFill, TreeNode } from "../../doc/schema.js";
import { picture, type ShaderHost, type ShaderInputs, type ShaderResult } from "../../render/draw.js";
import { animated, shaderUniforms } from "../../render/shader-source.js";
import { ShaderEffects } from "../../render/shader-effect.js";
import { encodeSdf, sdf, type Pixels } from "../../render/sdf.js";
import type { Assets } from "../../doc/assets.js";
import { ShaderRunner } from "./shader-gl.js";

/** The most pixels one WebGL shader draws (a 2048 × 2048 square's worth). */
const MOST_PIXELS = 2048 * 2048;

type Field = { key: string; distance: Image; direction: Image; pixels: Pixels };

export class EditorShaders implements ShaderHost {
  /** Device pixels per node unit for the pictures shaders sample. */
  scale = 1;
  /** One device pixel in node units, where the shader is drawn. */
  pixel = 1;
  /** Seconds on a node's clock (see canvas.ts: only selected nodes' clocks run). */
  time: (node: TreeNode) => number = () => 0;
  private effects: ShaderEffects;
  private runner: ShaderRunner | undefined;
  private sources = new Map<string, string | null | { error: string }>();
  private bitmaps = new Map<string, ImageBitmap | null>();
  /** Shaders that fell back to WebGL, by url (said once each). */
  private fellBack = new Set<string>();
  /** Each node's distance field, until its shape changes. */
  private fields = new Map<string, Field>();
  /** What this frame made; let go by `flush` (a recorded picture keeps its own reference). */
  private made: (Image | Shader)[] = [];

  constructor(
    private ck: CanvasKit,
    /** Reads a shader file (its url as the .pen file has it): its text, or null. */
    private read: (url: string) => Promise<string | null>,
    /** A picture a sampler names, by url: its bytes. */
    private assets: Assets,
    /** Something the canvas shows changed (a file read, a picture decoded). */
    private changed: () => void,
  ) {
    this.effects = new ShaderEffects(ck);
  }

  /** Lets go of what the frame made. */
  flush(): void {
    for (const m of this.made) m.delete();
    this.made = [];
  }

  /** Forgets distance fields of nodes no longer drawn. */
  keepFields(alive: (id: string) => boolean): void {
    for (const [id, f] of this.fields)
      if (!alive(id)) {
        f.distance.delete();
        f.direction.delete();
        this.fields.delete(id);
      }
  }

  /** The shader's source once read (null until then). */
  source(url: string): string | null {
    const known = this.sources.get(url);
    if (typeof known === "string") return known;
    if (known === undefined) {
      this.sources.set(url, null);
      void this.read(url).then((text) => {
        this.sources.set(url, text ?? { error: `${url} not found` });
        if (text) this.changed();
      });
    }
    return null;
  }

  /** Whether the shader at `url` reads the time (false until its file is read). */
  readsTime(url: string): boolean {
    const s = this.source(url);
    return !!s && animated(shaderUniforms(s));
  }

  draw(node: TreeNode, url: string, uniforms: ShaderFill["uniforms"], box: Box, inputs: ShaderInputs): ShaderResult | null {
    const source = this.source(url);
    if (!source || box.w <= 0 || box.h <= 0) return null;
    const compiled = this.effects.compile(source);
    if ("error" in compiled) return this.drawWithWebGL(node, url, source, compiled.error, uniforms, box, inputs);
    const made = this.effects.make(source, {
      width: box.w,
      height: box.h,
      at: box,
      pixel: this.pixel,
      ...(uniforms ? { values: uniforms } : {}),
      time: this.time(node),
      image: (name) => (name === "pencil:object" ? inputs.object() : name === "pencil:background" ? inputs.background() : picture(this.ck, this.assets, name)),
      sdf: () => this.field(node, box, inputs),
    });
    if ("error" in made) {
      console.warn(`Shader ${url} on ${node.id}:`, made.error);
      return null;
    }
    this.made.push(made);
    return { shader: made };
  }

  /** The node's distance field: worked out again only when its shape (`inputs.shapeKey`) or size changes. */
  private field(node: TreeNode, box: Box, inputs: ShaderInputs): Field | null {
    const key = `${inputs.shapeKey}|${box.w}x${box.h}`;
    const known = this.fields.get(node.id);
    if (known?.key === key) return known;
    const pixels = sdf(readPixels(this.ck, inputs.shape()), box);
    const images = pixels ? encodeSdf(this.ck, pixels) : null;
    if (known) {
      known.distance.delete();
      known.direction.delete();
      this.fields.delete(node.id);
    }
    if (!pixels || !images) return null;
    const field = { key, ...images, pixels };
    this.fields.set(node.id, field);
    return field;
  }

  /** A shader SkSL can't run, drawn on a WebGL context of its own and read back (the old way). */
  private drawWithWebGL(node: TreeNode, url: string, source: string, why: string, uniforms: ShaderFill["uniforms"], box: Box, inputs: ShaderInputs): ShaderResult | null {
    if (!this.fellBack.has(url)) {
      this.fellBack.add(url);
      console.warn(`Shader ${url} runs with WebGL: SkSL can't run it (${why}).`);
    }
    this.runner ??= new ShaderRunner();
    if (!this.runner.available) return null;
    const prepared = this.runner.prepare(source);
    if ("error" in prepared) {
      console.warn(`Shader ${url} on ${node.id}:`, prepared.error);
      return null;
    }
    const scale = Math.min(this.scale, Math.sqrt(MOST_PIXELS / (box.w * box.h)));
    const textures = new Map<string, Pixels | ImageBitmap | null>();
    for (const u of prepared.uniforms) {
      if (u.type !== "sampler2D") continue;
      const given = uniforms?.[u.name] ?? u.default;
      const name = u.bound === "sdf" ? "sdf" : typeof given === "string" ? given : "";
      if (!name || textures.has(name)) continue;
      textures.set(
        name,
        name === "pencil:object"
          ? readPixels(this.ck, inputs.object())
          : name === "pencil:background"
            ? readPixels(this.ck, inputs.background())
            : name === "sdf"
              ? (this.field(node, box, inputs)?.pixels ?? null)
              : this.bitmap(name),
      );
    }
    const result = this.runner.run(source, { width: box.w, height: box.h, scale, ...(uniforms ? { values: uniforms } : {}), time: this.time(node), textures: (name) => textures.get(name) });
    if (!result.ok) {
      console.warn(`Shader ${url} on ${node.id}:`, result.error);
      return null;
    }
    const image = this.readBack();
    if (!image) return null;
    this.made.push(image);
    return { image };
  }

  private bitmap(url: string): ImageBitmap | null {
    if (this.bitmaps.has(url)) return this.bitmaps.get(url)!;
    this.bitmaps.set(url, null);
    const bytes = this.assets(url);
    if (bytes)
      void createImageBitmap(new Blob([bytes as BlobPart]))
        .then((b) => (this.bitmaps.set(url, b), this.changed()))
        .catch(() => {});
    return null;
  }

  /** The runner's canvas as a picture in memory, so it draws on any surface (WebGL's rows run bottom up). */
  private readBack(): Image | null {
    const canvas = this.runner!.canvas;
    const gl = canvas.getContext("webgl")!;
    const { width: w, height: h } = canvas;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const rows = new Uint8Array(raw.length);
    for (let y = 0; y < h; y++) rows.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return this.ck.MakeImage({ width: w, height: h, colorType: this.ck.ColorType.RGBA_8888, alphaType: this.ck.AlphaType.Premul, colorSpace: this.ck.ColorSpace.SRGB }, rows, w * 4);
  }
}

/** A picture's pixels, read once (for a distance field, or the WebGL runner). */
function readPixels(ck: CanvasKit, i: Image | null): Pixels | null {
  if (!i) return null;
  const data = i.readPixels(0, 0, { width: i.width(), height: i.height(), colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Premul, colorSpace: ck.ColorSpace.SRGB });
  return data ? { width: i.width(), height: i.height(), data: data as Uint8Array } : null;
}
