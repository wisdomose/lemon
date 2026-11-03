// The editor's ShaderHost (render/draw.ts): runs shader fills and effects with WebGL (shader-gl.ts) and
// hands the canvas their pictures. Shader files are read beside the document (once each, until the
// document is opened again); a shader reading @time keeps the canvas drawing every frame.
import type { CanvasKit, Image } from "canvaskit-wasm";
import type { Box } from "../../layout/layout.js";
import type { TreeNode } from "../../doc/schema.js";
import type { ShaderHost, ShaderInputs } from "../../render/draw.js";
import { animated } from "../../render/shader-source.js";
import { ShaderRunner, type Pixels } from "./shader-gl.js";

/** The most pixels one shader draws (a 2048 × 2048 square's worth). */
const MOST_PIXELS = 2048 * 2048;
/** An @sdf is worked out at most this many texels along its longer side. */
const SDF_SIDE = 256;

export class EditorShaders implements ShaderHost {
  scale = 1;
  private runner = new ShaderRunner();
  private sources = new Map<string, string | null | { error: string }>();
  private pictures = new Map<string, ImageBitmap | null>();
  private made: Image[] = [];
  private start = performance.now();
  /** A shader drawn since the last `begin` reads the time: draw again next frame. */
  animating = false;

  constructor(
    private ck: CanvasKit,
    /** Reads a shader file (its url as the .pen file has it): its text, or null. */
    private read: (url: string) => Promise<string | null>,
    /** A picture a sampler names, by url: its bytes. */
    private bytes: (url: string) => Uint8Array | undefined,
    /** Something the canvas shows changed (a file read, a picture decoded). */
    private changed: () => void,
  ) {}

  /** A new drawing of the page begins: the last one's pictures are let go (a recorded page keeps its own). */
  begin(): void {
    for (const i of this.made) i.delete();
    this.made = [];
    this.animating = false;
  }

  private source(url: string): string | null {
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

  private picture(url: string): ImageBitmap | null {
    if (this.pictures.has(url)) return this.pictures.get(url)!;
    this.pictures.set(url, null);
    const bytes = this.bytes(url);
    if (bytes)
      void createImageBitmap(new Blob([bytes as BlobPart]))
        .then((b) => (this.pictures.set(url, b), this.changed()))
        .catch(() => {});
    return null;
  }

  draw(node: TreeNode, url: string, uniforms: Record<string, unknown> | undefined, box: Box, inputs: ShaderInputs): Image | null {
    const source = this.source(url);
    if (!source || !this.runner.available || box.w <= 0 || box.h <= 0) return null;
    const scale = Math.min(this.scale, Math.sqrt(MOST_PIXELS / (box.w * box.h)));
    const pixels = (i: Image | null): Pixels | null => {
      if (!i) return null;
      const data = i.readPixels(0, 0, { width: i.width(), height: i.height(), colorType: this.ck.ColorType.RGBA_8888, alphaType: this.ck.AlphaType.Premul, colorSpace: this.ck.ColorSpace.SRGB });
      return data ? { width: i.width(), height: i.height(), data: data as Uint8Array } : null;
    };
    // Every picture it samples is made first: making one (what's behind it) may run other shaders on the
    // same WebGL context, which mustn't happen in the middle of this one's run.
    const prepared = this.runner.prepare(source);
    if ("error" in prepared) {
      console.warn(`Shader ${url} on ${node.id}:`, prepared.error);
      return null;
    }
    const textures = new Map<string, Pixels | ImageBitmap | null>();
    for (const u of prepared.uniforms) {
      if (u.type !== "sampler2D") continue;
      const given = uniforms?.[u.name] ?? u.default;
      const name = u.bound === "sdf" ? "sdf" : typeof given === "string" ? given : "";
      if (!name || textures.has(name)) continue;
      textures.set(
        name,
        name === "pencil:object"
          ? pixels(inputs.object())
          : name === "pencil:background"
            ? pixels(inputs.background())
            : name === "sdf"
              ? sdf(pixels(inputs.shape()), box)
              : this.picture(name),
      );
    }
    const result = this.runner.run(source, {
      width: box.w,
      height: box.h,
      scale,
      values: uniforms,
      time: (performance.now() - this.start) / 1000,
      textures: (name) => textures.get(name),
    });
    if (!result.ok) {
      console.warn(`Shader ${url} on ${node.id}:`, result.error);
      return null;
    }
    if (animated(result.uniforms)) this.animating = true;
    const image = this.readBack();
    if (image) this.made.push(image);
    return image;
  }

  /** The runner's canvas as a picture in memory, so it draws on any surface (WebGL's rows run bottom up). */
  private readBack(): Image | null {
    const gl = this.runner.canvas.getContext("webgl")!;
    const { width: w, height: h } = this.runner.canvas;
    const raw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const rows = new Uint8Array(raw.length);
    for (let y = 0; y < h; y++) rows.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    return this.ck.MakeImage({ width: w, height: h, colorType: this.ck.ColorType.RGBA_8888, alphaType: this.ck.AlphaType.Premul, colorSpace: this.ck.ColorSpace.SRGB }, rows, w * 4);
  }
}

/**
 * A shape's signed distance field from its coverage (alpha over half is inside): distance in node units,
 * positive inside, in r; the direction distance grows in, per texel, in g and b. Top row first.
 */
export function sdf(shape: Pixels | null, box: Box): Pixels | null {
  if (!shape) return null;
  const k = Math.min(1, SDF_SIDE / Math.max(shape.width, shape.height));
  const w = Math.max(1, Math.round(shape.width * k));
  const h = Math.max(1, Math.round(shape.height * k));
  // Worked out with a texel of outside all round: past the box is outside the shape.
  const pw = w + 2;
  const ph = h + 2;
  const inside = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(shape.width - 1, Math.floor(x / k));
      const sy = Math.min(shape.height - 1, Math.floor(y / k));
      inside[(y + 1) * pw + x + 1] = (shape.data[(sy * shape.width + sx) * 4 + 3] ?? 0) > 127 ? 1 : 0;
    }
  const toEdgeOut = distances(inside, pw, ph, 1);
  const toEdgeIn = distances(inside, pw, ph, 0);
  const unit = box.w / w;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y + 1) * pw + x + 1;
      // Measured to the boundary between texels: half a texel less than to the nearest other texel.
      const inn = toEdgeIn[i] ? Math.sqrt(toEdgeIn[i]!) - 0.5 : 0;
      const out = toEdgeOut[i] ? Math.sqrt(toEdgeOut[i]!) - 0.5 : 0;
      d[y * w + x] = (inn - out) * unit;
    }
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (d[y * w + Math.min(w - 1, x + 1)]! - d[y * w + Math.max(0, x - 1)]!) / 2;
      // Rows run top down here; texture space (as the shader sees it) runs bottom up.
      const gy = (d[Math.max(0, y - 1) * w + x]! - d[Math.min(h - 1, y + 1) * w + x]!) / 2;
      const len = Math.hypot(gx, gy) || 1;
      data.set([d[i]!, gx / len, gy / len, 1], i * 4);
    }
  return { width: w, height: h, data, float: true };
}

/** Squared distance from each texel to the nearest texel where `mask` equals `target` (exact, two passes). */
function distances(mask: Uint8Array, w: number, h: number, target: number): Float64Array {
  const INF = 1e20;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = mask[i] === target ? 0 : INF;
  const line = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    const f = new Float64Array(n);
    for (let i = 0; i < n; i++) f[i] = get(i);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1]! < q) k++;
      set(q, (q - v[k]!) * (q - v[k]!) + f[v[k]!]!);
    }
  };
  for (let x = 0; x < w; x++) line((i) => grid[i * w + x]!, (i, val) => (grid[i * w + x] = val), h);
  for (let y = 0; y < h; y++) line((i) => grid[y * w + i]!, (i, val) => (grid[y * w + i] = val), w);
  return grid;
}
