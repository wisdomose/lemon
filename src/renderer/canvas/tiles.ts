// The canvas drawn in tiles, as Pen draws it: 128 device-pixel squares, one set of them (a level) per
// zoom, kept between frames and painted again only where a change damaged them. Each frame paints the
// tiles in view that need it, nearest the middle first, until its time is up, then asks for another
// frame; meanwhile a damaged tile keeps showing what it showed (new tiles are shown together once all
// in view are ready, or after 32 ms), and a tile not painted yet at this zoom shows the nearest other
// zoom's, scaled. While the zoom is changing (canvas.ts), tiles are painted only at whole steps of it
// (powers of two) and shown scaled: each step's tiles last for many frames of the zoom, where tiles of
// every zoom passed through would each be thrown away after one. Once the view is painted, so is a margin around it (canvas.ts), ahead of where the
// view is going first: what scrolls or zooms into view is already there, not filled in as one watches.
// Old tiles go least recently used first.
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
  /**
   * Goes up whenever a tile is damaged, painted, shown anew or let go, or all are cleared: while it
   * stays the same (and the view does), the last frame's tiles can be shown again without looking.
   */
  version = 0;

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
    if (any) {
      this.heldSince ??= now;
      this.version++;
    }
  }

  /** A new frame begins (tiles in view are counted as used in it). */
  begin(): void {
    this.frame++;
  }

  /**
   * The tiles covering `view` (page coordinates) at `scale`, made when missing. With `keep` false the
   * missing ones are only stood for (not kept): for a zoom passed through, whose tiles are never painted.
   */
  inView(view: Box, scale: number, keep = true): Tile<T>[] {
    const l = keep ? this.level(scale) : this.levels.get(levelKey(scale));
    const { i0, i1, j0, j1 } = tileRange(view, levelKey(scale));
    const out: Tile<T>[] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = key(i, j);
        let t = l?.tiles.get(k);
        if (!t) {
          t = { i, j, dirty: true, used: this.frame };
          if (keep) l!.tiles.set(k, t);
        }
        t.used = this.frame;
        out.push(t);
      }
    return out;
  }

  /** Whether a picture from another zoom covers the page point (x, y): something to show there meanwhile. */
  coveredAt(x: number, y: number, scale: number): boolean {
    const here = levelKey(scale);
    for (const l of this.levels.values()) {
      if (l.scale === here) continue;
      const size = TILE / l.scale;
      if (l.tiles.get(key(Math.floor(x / size), Math.floor(y / size)))?.image !== undefined) return true;
    }
    return false;
  }

  /** Of `tiles`, those to paint, the middle of the view first (or what is nearest `centre`, in tiles). */
  toPaint(tiles: Tile<T>[], centre?: { i: number; j: number }): Tile<T>[] {
    if (!tiles.length) return [];
    let [ci, cj] = [0, 0];
    if (centre) [ci, cj] = [centre.i, centre.j];
    else {
      let [i0, i1, j0, j1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const t of tiles) [i0, i1, j0, j1] = [Math.min(i0, t.i), Math.max(i1, t.i), Math.min(j0, t.j), Math.max(j1, t.j)];
      [ci, cj] = [(i0 + i1) / 2, (j0 + j1) / 2];
    }
    return tiles.filter((t) => t.dirty).sort((a, b) => Math.hypot(a.i - ci, a.j - cj) - Math.hypot(b.i - ci, b.j - cj));
  }

  /** A tile was painted: its picture waits to be shown (at once if it showed nothing). */
  painted(t: Tile<T>, image: T): void {
    this.version++;
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
          this.version++;
        }
    this.heldSince = ready ? undefined : now;
    return false;
  }

  /**
   * Pictures from other zooms covering `rect` (page coordinates), to show while this zoom's are
   * painted: nearest zoom last, so it ends up on top. Zooms further off than one that covers all of
   * `rect` are left out (they would be drawn over): a frame of a zoom in progress draws a few pictures
   * per tile, not every one kept under it.
   */
  standIns(rect: Box, scale: number): { level: Level<T>; tile: Tile<T> }[] {
    const here = levelKey(scale);
    const others = this.others(here);
    const out: { level: Level<T>; tile: Tile<T> }[] = [];
    // Nearest first, until one covers the rect; then turned round.
    for (let n = others.length - 1; n >= 0; n--) {
      const l = others[n]!;
      const { i0, i1, j0, j1 } = tileRange(rect, l.scale);
      // A zoom far closer than this one: its tiles here are too many and too small to be worth drawing.
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) continue;
      let whole = true;
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const t = l.tiles.get(key(i, j));
          if (t?.image !== undefined) out.push({ level: l, tile: t });
          else whole = false;
        }
      if (whole) break;
    }
    return out.reverse();
  }

  /** The other zooms' levels, furthest from `here` first (worked out once per frame and set of levels). */
  private others(here: number): Level<T>[] {
    const c = this.othersCache;
    if (c && c.here === here && c.frame === this.frame && c.count === this.levels.size) return c.list;
    const list = [...this.levels.values()].filter((l) => l.scale !== here).sort((a, b) => Math.abs(Math.log(b.scale / here)) - Math.abs(Math.log(a.scale / here)));
    this.othersCache = { here, frame: this.frame, count: this.levels.size, list };
    return list;
  }
  private othersCache: { here: number; frame: number; count: number; list: Level<T>[] } | undefined;

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
    this.version++;
  }

  /** How many tiles are kept. */
  get size(): number {
    let n = 0;
    for (const l of this.levels.values()) n += l.tiles.size;
    return n;
  }

  private drop(t: Tile<T>): void {
    this.version++;
    if (t.image !== undefined) this.release(t.image);
    if (t.next !== undefined) this.release(t.next);
    t.image = t.next = undefined;
  }
}

/**
 * Whether the view needs putting together from its tiles again: it moved, changed size or look (`key`),
 * or a tile in it shows another picture. Otherwise the last picture of the whole view is drawn as it is,
 * so a frame that only moves something on top (the "Generating" sheen, a cursor, the text caret) costs
 * one picture, not one per tile. While a tile has no picture yet (stand-ins from other zooms show), the
 * view is put together every frame.
 */
export class ViewComposite<T> {
  private key: string | undefined;
  private images: (T | undefined)[] = [];

  changed(key: string, tiles: readonly Tile<T>[]): boolean {
    let changed = key !== this.key || tiles.length !== this.images.length;
    for (let k = 0; !changed && k < tiles.length; k++) changed = tiles[k]!.image === undefined || tiles[k]!.image !== this.images[k];
    if (changed) {
      this.key = key;
      this.images = tiles.map((t) => t.image);
    }
    return changed;
  }

  /** Forgets the last picture (the surface was made again). */
  reset(): void {
    this.key = undefined;
    this.images = [];
  }
}
