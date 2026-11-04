// A shape's signed distance field, for a shader's @sdf sampler: worked out once from the shape's
// coverage and kept until the shape changes. The WebGL runner takes it as float texels; CanvasKit's
// RuntimeEffects take it as two 8-bit pictures (distance in 16 bits, then its direction), see `encodeSdf`.
import type { CanvasKit, Image } from "canvaskit-wasm";
import type { Box } from "../layout/layout.js";
import { SDF_STEPS, SDF_ZERO } from "./shader-source.js";

/** A texture's pixels: RGBA, premultiplied, top row first. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray | Float32Array;
  /** Float data (an SDF: distance, then its gradient). */
  float?: boolean;
}

/** An @sdf is worked out at most this many texels along its longer side. */
export const SDF_SIDE = 256;

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

/**
 * An SDF (from `sdf`) as two opaque 8-bit pictures for SkSL (render/shader-source.ts reads them):
 * distance × 16 + 32768 in r (high byte) and g (low byte), and its direction's x and y in r and g of the
 * second, from −1..1 to 0..255. Top row first, as `sdf` gives it.
 */
export function encodeSdf(ck: CanvasKit, field: Pixels): { distance: Image; direction: Image } | null {
  const { width: w, height: h } = field;
  const n = w * h;
  const dist = new Uint8Array(n * 4);
  const dir = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const d = Math.max(0, Math.min(65535, Math.round(field.data[i * 4]! * SDF_STEPS + SDF_ZERO)));
    dist[i * 4] = d >> 8;
    dist[i * 4 + 1] = d & 255;
    dist[i * 4 + 3] = 255;
    dir[i * 4] = Math.round((Math.max(-1, Math.min(1, field.data[i * 4 + 1]!)) * 0.5 + 0.5) * 255);
    dir[i * 4 + 1] = Math.round((Math.max(-1, Math.min(1, field.data[i * 4 + 2]!)) * 0.5 + 0.5) * 255);
    dir[i * 4 + 3] = 255;
  }
  const info = { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Opaque, colorSpace: ck.ColorSpace.SRGB };
  const distance = ck.MakeImage(info, dist, w * 4);
  const direction = ck.MakeImage(info, dir, w * 4);
  if (!distance || !direction) {
    distance?.delete();
    direction?.delete();
    return null;
  }
  return { distance, direction };
}
