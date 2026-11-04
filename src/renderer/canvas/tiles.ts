// The canvas drawn in tiles, as Pen draws it: 128 device-pixel squares, one set of them (a level) per
// zoom, kept between frames and painted again only where a change damaged them. Each frame paints the
// tiles in view that need it, nearest the middle first, until its time is up, then asks for another
// frame; meanwhile a damaged tile keeps showing what it showed (new tiles are shown together once all
// in view are ready, or after 32 ms), and a tile not painted yet at this zoom shows the nearest other
// zoom's, scaled. Old tiles go least recently used first.
//
// This file keeps the books (what is where, what is damaged, what to paint next); canvas.ts paints.
import type { Box } from "../../layout/layout.js";

/** A tile's side in device pixels. */
export const TILE = 128;
/** New tiles wait at most this long for the rest of the view before they are shown. */
export const HOLD_MS = 32;

export interface Tile<T> {
  i: number;
  j: number;
  /** What it shows now. */
  image?: T;
  /** Painted since, shown once the rest of the view is ready (see `commit`). */
  next?: T;
  /** Something changed under it since it was painted. */
  dirty: boolean;
  /** The last frame it was in view. */
  used: number;
}

export interface Level<T> {
  /** Device pixels per page unit. */
  scale: number;
  tiles: Map<string, Tile<T>>;
}

const key = (i: number, j: number) => `${i},${j}`;

/** The tiles (i, j ranges, inclusive) a page rect covers at `scale`. */
export function tileRange(rect: Box, scale: number): { i0: number; i1: number; j0: number; j1: number } {
  const size = TILE / scale;
  return {
    i0: Math.floor(rect.x / size),
    i1: Math.ceil((rect.x + rect.w) / size) - 1,
    j0: Math.floor(rect.y / size),
    j1: Math.ceil((rect.y + rect.h) / size) - 1,
  };
}

/** A tile's square in page coordinates. */
export function tileRect(i: number, j: number, scale: number): Box {
  const size = TILE / scale;
  return { x: i * size, y: j * size, w: size, h: size };
}

/** Zooms closer than this share a level (a scale is kept to 1 part in a million). */
const levelKey = (scale: number) => Math.round(scale * 1e6) / 1e6;

export class Tiles<T> {
  readonly levels = new Map<number, Level<T>>();
  private frame = 0;
  /** When the oldest damage not yet shown came. */
  private heldSince: number | undefined;

  constructor(
    /** Lets go of a tile's image. */
    private readonly release: (image: T) => void,
    /** The most tiles kept, all levels together. */
    private readonly most = 1024,
  ) {}

  level(scale: number): Level<T> {
    const k = levelKey(scale);
    let l = this.levels.get(k);
    if (!l) this.levels.set(k, (l = { scale: k, tiles: new Map() }));
    return l;
  }

  /** Marks the tiles under `rects` (page coordinates), or every tile, as needing paint. */
  invalidate(rects: Box[] | "all", now = 0): void {
    if (rects !== "all" && !rects.length) return;
    let any = false;
    for (const l of this.levels.values()) {
      if (rects === "all") {
        for (const t of l.tiles.values()) t.dirty = any = true;
        continue;
      }
      for (const r of rects) {
        const { i0, i1, j0, j1 } = tileRange(r, l.scale);
        // A damage rect bigger than the level's tiles: go through the tiles instead.
        if ((i1 - i0 + 1) * (j1 - j0 + 1) > l.tiles.size) {
          for (const t of l.tiles.values()) if (t.i >= i0 && t.i <= i1 && t.j >= j0 && t.j <= j1) t.dirty = any = true;
          continue;
        }
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const t = l.tiles.get(key(i, j));
            if (t) t.dirty = any = true;
          }
      }
    }
    if (any) this.heldSince ??= now;
  }

  /** A new frame begins (tiles in view are counted as used in it). */
  begin(): void {
    this.frame++;
  }

  /** The tiles covering `view` (page coordinates) at `scale`, made when missing. */
  inView(view: Box, scale: number): Tile<T>[] {
    const l = this.level(scale);
    const { i0, i1, j0, j1 } = tileRange(view, l.scale);
    const out: Tile<T>[] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = key(i, j);
        let t = l.tiles.get(k);
        if (!t) l.tiles.set(k, (t = { i, j, dirty: true, used: this.frame }));
        t.used = this.frame;
        out.push(t);
      }
    return out;
  }

  /** Of `tiles`, those to paint, the middle of the view first. */
  toPaint(tiles: Tile<T>[]): Tile<T>[] {
    if (!tiles.length) return [];
    const ci = (Math.min(...tiles.map((t) => t.i)) + Math.max(...tiles.map((t) => t.i))) / 2;
    const cj = (Math.min(...tiles.map((t) => t.j)) + Math.max(...tiles.map((t) => t.j))) / 2;
    return tiles.filter((t) => t.dirty).sort((a, b) => Math.hypot(a.i - ci, a.j - cj) - Math.hypot(b.i - ci, b.j - cj));
  }

  /** A tile was painted: its picture waits to be shown (at once if it showed nothing). */
  painted(t: Tile<T>, image: T): void {
    t.dirty = false;
    if (t.next !== undefined) this.release(t.next);
    if (t.image === undefined) t.image = image;
    else t.next = image;
  }

  /**
   * Shows the waiting pictures when every tile in view is painted, or the oldest damage has waited
   * `HOLD_MS`: a change appears all at once rather than tile by tile. Returns whether any is still waiting.
   */
  commit(view: Tile<T>[], now: number): boolean {
    const ready = view.every((t) => !t.dirty);
    if (!ready && this.heldSince !== undefined && now - this.heldSince < HOLD_MS) return true;
    for (const l of this.levels.values())
      for (const t of l.tiles.values())
        if (t.next !== undefined) {
          if (t.image !== undefined) this.release(t.image);
          t.image = t.next;
          t.next = undefined;
        }
    this.heldSince = ready ? undefined : now;
    return false;
  }

  /**
   * Pictures from other zooms covering `rect` (page coordinates), to show while this zoom's are
   * painted: nearest zoom last, so it ends up on top.
   */
  standIns(rect: Box, scale: number): { level: Level<T>; tile: Tile<T> }[] {
    const here = levelKey(scale);
    const others = [...this.levels.values()].filter((l) => l.scale !== here).sort((a, b) => Math.abs(Math.log(b.scale / here)) - Math.abs(Math.log(a.scale / here)));
    const out: { level: Level<T>; tile: Tile<T> }[] = [];
    for (const l of others) {
      const { i0, i1, j0, j1 } = tileRange(rect, l.scale);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const t = l.tiles.get(key(i, j));
          if (t?.image !== undefined) out.push({ level: l, tile: t });
        }
    }
    return out;
  }

  /** Whether any tile in view (in the last frame) at `scale` under `rects` still waits to be painted or shown. */
  pendingUnder(rects: Box[], scale: number): boolean {
    const l = this.levels.get(levelKey(scale));
    if (!l) return false;
    for (const r of rects) {
      const { i0, i1, j0, j1 } = tileRange(r, l.scale);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const t = l.tiles.get(key(i, j));
          if (t && t.used === this.frame && (t.dirty || t.next !== undefined)) return true;
        }
    }
    return false;
  }

  /** Lets go of the least recently used tiles over the limit (never those in view now). */
  evict(): void {
    let count = 0;
    for (const l of this.levels.values()) count += l.tiles.size;
    if (count > this.most) {
      const all: { l: Level<T>; k: string; t: Tile<T> }[] = [];
      for (const l of this.levels.values()) for (const [k, t] of l.tiles) if (t.used < this.frame) all.push({ l, k, t });
      all.sort((a, b) => a.t.used - b.t.used);
      for (const { l, k, t } of all.slice(0, count - this.most)) {
        this.drop(t);
        l.tiles.delete(k);
      }
    }
    for (const [k, l] of this.levels) if (!l.tiles.size) this.levels.delete(k);
  }

  /** Lets go of everything (the surface was made again). */
  clear(): void {
    for (const l of this.levels.values()) for (const t of l.tiles.values()) this.drop(t);
    this.levels.clear();
    this.heldSince = undefined;
  }

  /** How many tiles are kept. */
  get size(): number {
    let n = 0;
    for (const l of this.levels.values()) n += l.tiles.size;
    return n;
  }

  private drop(t: Tile<T>): void {
    if (t.image !== undefined) this.release(t.image);
    if (t.next !== undefined) this.release(t.next);
    t.image = t.next = undefined;
  }
}
