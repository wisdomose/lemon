// The sizes the window keeps a picture at (picture-store.ts), shared with the worker that makes them.

/** Longest sides a picture is kept at. */
export const SIZES = [128, 512, 2048, 4096] as const;
export const SMALLEST = SIZES[0];

/** The size to hold for a picture shown `wanted` pixels long, of a picture `longest` pixels long (0: not known yet). */
export function sizeFor(wanted: number, longest: number): number {
  const size = SIZES.find((s) => s >= wanted) ?? SIZES.at(-1)!;
  return longest ? Math.min(size, longest) : size;
}

/** A picture's size shrunk to `size` on its longest side. */
export function shrunk(width: number, height: number, size: number): { width: number; height: number } {
  const k = Math.min(1, size / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** What a decode is asked: the picture's bytes, the size wanted, and the sizes already held (not made again). */
export interface DecodeJob {
  id: number;
  bytes: ArrayBuffer;
  wanted: number;
  held: number[];
}
export type DecodeResult = { id: number; width: number; height: number; made: { size: number; bitmap: ImageBitmap }[] } | { id: number; error: string };

const OPTIONS: ImageBitmapOptions = { premultiplyAlpha: "premultiply", colorSpaceConversion: "default" };

/**
 * Decodes a picture with the browser's own codecs and shrinks it to the size wanted (and to the
 * smallest size, which comes with every load so there is always something to show). Its own size
 * isn't known beforehand, so it is decoded whole once, shrunk, and the whole let go.
 */
export async function decode(job: DecodeJob): Promise<DecodeResult> {
  try {
    const whole = await createImageBitmap(new Blob([job.bytes]), OPTIONS);
    const { width, height } = whole;
    const longest = Math.max(width, height);
    const size = sizeFor(job.wanted, longest);
    const sizes = new Set([size]);
    if (size > SMALLEST) sizes.add(Math.min(SMALLEST, longest));
    const made: { size: number; bitmap: ImageBitmap }[] = [];
    for (const s of sizes) {
      if (job.held.includes(s)) continue;
      const to = shrunk(width, height, s);
      const same = to.width === width && to.height === height;
      made.push({ size: s, bitmap: await createImageBitmap(whole, same ? OPTIONS : { ...OPTIONS, resizeWidth: to.width, resizeHeight: to.height, resizeQuality: "high" }) });
    }
    whole.close();
    return { id: job.id, width, height, made };
  } catch (e) {
    return { id: job.id, error: e instanceof Error ? e.message : String(e) };
  }
}
