// The window's pictures. A document's pictures are files beside it (doc/assets.ts) and a board may
// hold thousands of them, so none is read when the file opens: the canvas asks for a picture when it
// draws one, at the size it shows, and gets the best this store has meanwhile; the store fetches the
// file, has the browser decode and shrink it in a worker (picture-worker.ts), and hands the result to the GPU
// as a texture (it never passes through CanvasKit's memory, which holds 2 GB at most). Like Pen's:
//   - A picture is kept at a few sizes (SIZES in picture-sizes.ts, longest side), never larger than itself: a small one
//     that comes with every load and shows at once while a bigger one is on its way.
//   - A few load at a time (LOADS), what was asked for last first: that is what is in view now. When the
//     view moves on, the canvas drops what still waits (`dropWaiting`); it is asked for again if it
//     comes back into view.
//   - Textures are made for a few milliseconds a frame (UPLOAD_MS), smallest first.
//   - Over BUDGET (an estimate: width × height × 4), the least recently drawn are let go, big before
//     small. The canvas keeps what it painted in its tiles, so a picture let go costs nothing until
//     its tiles are painted again.
// Pictures the document still carries (just added, not saved yet) come from the document itself.
//
// Elsewhere in the window (shader inputs, slide and export pictures, the colour picker) pictures are
// few and wanted whole: `pictureBytes` gives a picture's bytes if they are here, fetching them if not.
import type { CanvasKit, Image, Surface } from "canvaskit-wasm";
import type * as Y from "yjs";
import { assetsOf, type Assets } from "../doc/assets.js";
import type { Shown } from "../render/draw.js";
import { SIZES, SMALLEST, decode, sizeFor, type DecodeJob, type DecodeResult } from "./picture-sizes.js";

export { SIZES, sizeFor, shrunk } from "./picture-sizes.js";

const LOADS = 4;
const UPLOAD_MS = 4;
const BUDGET = 768 * 1024 * 1024;

interface Held {
  image: Image;
  bytes: number;
  used: number;
}
interface Entry {
  url: string;
  /** The picture's own size; 0 until it has been read once. */
  width: number;
  height: number;
  held: Map<number, Held>;
  /** The size asked for and not here yet (0: none), and when it was asked (a count of requests). */
  wanted: number;
  asked: number;
  loading: boolean;
  /** No such picture (until the document carries one under this url). */
  missing: boolean;
}
interface Decoded {
  entry: Entry;
  size: number;
  bitmap: ImageBitmap;
}

export interface PictureHost {
  ck: CanvasKit;
  /** The canvas's surface (pictures are textures on its GPU), or null while there is none. */
  surface(): Surface | null;
  /** Fetches a saved picture's bytes. */
  fetch(url: string): Promise<Uint8Array | null>;
  /** These pictures can be drawn better now (or were given up on): what shows them is painted again. */
  changed(urls: string[]): void;
}

/**
 * Decoding, in a few workers (the window's own thread if they can't be started): the browser's codecs
 * do the work either way, but in a worker nothing of it holds up a frame.
 */
class Decoder {
  private workers: Worker[] = [];
  private waiting = new Map<number, (r: DecodeResult) => void>();
  private next = 0;

  constructor(count: number) {
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL("./picture-worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (e: MessageEvent<DecodeResult>) => {
          const done = this.waiting.get(e.data.id);
          this.waiting.delete(e.data.id);
          done?.(e.data);
        };
        // A worker that can't run: its jobs are done here instead.
        w.onerror = () => {
          this.workers = this.workers.filter((x) => x !== w);
          for (const [id, done] of this.waiting) (this.waiting.delete(id), done({ id, error: "retry" }));
        };
        this.workers.push(w);
      }
    } catch {
      this.workers = [];
    }
  }

  async run(bytes: Uint8Array, wanted: number, held: number[]): Promise<DecodeResult> {
    const id = ++this.next;
    // Its own buffer, so it can be handed over (a picture the document carries is copied: the document keeps its own).
    const copy = () => bytes.slice().buffer as ArrayBuffer;
    const worker = this.workers[id % Math.max(1, this.workers.length)];
    if (!worker) return decode({ id, bytes: copy(), wanted, held });
    const buffer = copy();
    const result = await new Promise<DecodeResult>((done) => {
      this.waiting.set(id, done);
      worker.postMessage({ id, bytes: buffer, wanted, held } satisfies DecodeJob, [buffer]);
    });
    return "error" in result && result.error === "retry" ? decode({ id, bytes: copy(), wanted, held }) : result;
  }
}

export class PictureStore {
  private entries = new Map<string, Entry>();
  private uploads: Decoded[] = [];
  private active = 0;
  private tick = 0;
  private total = 0;
  private told = new Set<string>();
  /** The longest one texture took to make (a frame waits that long). */
  private longestUpload = 0;
  private decoder = new Decoder(LOADS);

  constructor(
    private readonly doc: Y.Doc,
    private readonly host: PictureHost,
  ) {
    // A picture the document starts to carry (dropped in, or an agent's): it is there now.
    assetsOf(doc).observe((e) => {
      const urls = [...e.keysChanged].filter((u) => assetsOf(doc).has(u) && this.entries.get(u)?.missing);
      for (const u of urls) this.entries.get(u)!.missing = false;
      if (urls.length) this.host.changed(urls);
    });
  }

  /** How many pictures are known, loading, waiting for the GPU, and the textures' estimated bytes. */
  get stats() {
    let ready = 0;
    let waiting = 0;
    for (const e of this.entries.values()) {
      if (e.held.size) ready++;
      if (e.wanted && !e.loading) waiting++;
    }
    return { pictures: this.entries.size, ready, loading: this.active, waiting, uploads: this.uploads.length, bytes: this.total, budget: BUDGET, longestUploadMs: +this.longestUpload.toFixed(1) };
  }

  /** Whether anything is still on its way. */
  get busy(): boolean {
    return this.active > 0 || this.uploads.length > 0;
  }

  /** The canvas's hook (DrawContext.pictures): the best picture here for `wanted` pixels, asking for better if need be. */
  get = (url: string, wanted: number): Shown | "loading" | null => {
    let e = this.entries.get(url);
    if (!e) this.entries.set(url, (e = { url, width: 0, height: 0, held: new Map(), wanted: 0, asked: 0, loading: false, missing: false }));
    if (e.missing) return null;
    const size = sizeFor(Number.isFinite(wanted) ? wanted : SIZES.at(-1)!, Math.max(e.width, e.height));
    // The smallest held that is big enough, else the biggest held.
    let best: Held | undefined;
    let bestSize = 0;
    for (const [s, h] of e.held) {
      if (bestSize >= size ? s >= size && s < bestSize : s > bestSize) [best, bestSize] = [h, s];
    }
    if (bestSize < size) {
      e.wanted = Math.max(e.wanted, size);
      e.asked = ++this.tick;
      this.scheduleSoon();
    }
    if (!best) return "loading";
    best.used = ++this.tick;
    return { image: best.image, width: e.width, height: e.height };
  };

  /** Once a frame: makes textures of what has been decoded, for a few milliseconds. Returns whether more waits. */
  pump(): boolean {
    const surface = this.host.surface();
    if (!surface || !this.uploads.length) return this.uploads.length > 0;
    const t0 = performance.now();
    const { ck } = this.host;
    // Smallest first: something to show for as many pictures as possible.
    this.uploads.sort((a, b) => a.size - b.size);
    while (this.uploads.length) {
      const { entry, size, bitmap } = this.uploads.shift()!;
      const began = performance.now();
      let image: Image | null = null;
      try {
        image =
          surface.makeImageFromTextureSource(bitmap, { width: bitmap.width, height: bitmap.height, alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB }, true) ??
          // No GPU: through a canvas, into CanvasKit's own memory.
          ck.MakeImageFromCanvasImageSource(bitmap);
      } catch {
        try {
          image = ck.MakeImageFromCanvasImageSource(bitmap);
        } catch {}
      }
      const bytes = bitmap.width * bitmap.height * 4;
      bitmap.close();
      this.longestUpload = Math.max(this.longestUpload, performance.now() - began);
      if (image) {
        const old = entry.held.get(size);
        if (old) (old.image.delete(), (this.total -= old.bytes));
        entry.held.set(size, { image, bytes, used: ++this.tick });
        this.total += bytes;
        this.told.add(entry.url);
      }
      if (performance.now() - t0 >= UPLOAD_MS) break;
    }
    this.evict();
    this.tell();
    return this.uploads.length > 0;
  }

  /** The surface was made again: its textures are gone with it. What was known of each picture's size stays. */
  reset(): void {
    for (const e of this.entries.values()) {
      for (const h of e.held.values()) h.image.delete();
      e.held.clear();
    }
    for (const u of this.uploads) u.bitmap.close();
    this.uploads = [];
    this.total = 0;
  }

  private tell(): void {
    if (!this.told.size) return;
    const urls = [...this.told];
    this.told.clear();
    this.host.changed(urls);
  }

  /**
   * Forgets what was asked for and hasn't started loading (the view moved on). Returns those pictures:
   * what shows them is to be painted again when next in view, which asks again.
   */
  dropWaiting(): string[] {
    const urls: string[] = [];
    for (const e of this.entries.values()) {
      if (!e.wanted || e.loading) continue;
      e.wanted = 0;
      urls.push(e.url);
    }
    return urls;
  }

  private queued = false;
  /** Many pictures are asked for in one paint: loads are started once, after it. */
  private scheduleSoon(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.schedule();
    });
  }

  /** Starts loads while there is room, what was asked for last first. */
  private schedule(): void {
    if (this.active >= LOADS) return;
    const waiting = [...this.entries.values()].filter((e) => e.wanted && !e.loading && !e.missing).sort((a, b) => b.asked - a.asked);
    for (const e of waiting) {
      if (this.active >= LOADS) break;
      this.active++;
      e.loading = true;
      void this.load(e).finally(() => {
        this.active--;
        e.loading = false;
        this.schedule();
        this.tell();
      });
    }
  }

  private async load(e: Entry): Promise<void> {
    const want = e.wanted;
    e.wanted = 0;
    try {
      const bytes = assetsOf(this.doc).get(e.url) ?? (await this.host.fetch(e.url));
      if (!bytes) {
        e.missing = true;
        this.told.add(e.url);
        return;
      }
      const result = await this.decoder.run(bytes, want, [...e.held.keys()]);
      if ("error" in result) throw new Error(result.error);
      e.width = result.width;
      e.height = result.height;
      const size = sizeFor(want, Math.max(e.width, e.height));
      for (const { size: s, bitmap } of result.made) this.uploads.push({ entry: e, size: s, bitmap });
      // Asked for bigger meanwhile.
      if (e.wanted && e.wanted <= size) e.wanted = 0;
      this.host.changed([]);
    } catch {
      e.missing = true;
      this.told.add(e.url);
    }
  }

  /** Over the budget: the least recently drawn go, the small ones last. */
  private evict(): void {
    if (this.total <= BUDGET) return;
    const all: { e: Entry; size: number; h: Held }[] = [];
    for (const e of this.entries.values()) for (const [size, h] of e.held) all.push({ e, size, h });
    const small = (x: { size: number }) => (x.size <= SMALLEST ? 1 : 0);
    all.sort((a, b) => small(a) - small(b) || a.h.used - b.h.used);
    // What was drawn in the last few requests stays, whatever the budget.
    const recent = this.tick - 64;
    for (const { e, size, h } of all) {
      if (this.total <= BUDGET) break;
      if (h.used > recent) continue;
      h.image.delete();
      e.held.delete(size);
      this.total -= h.bytes;
    }
  }
}

// ---- Whole pictures, for the few places that want their bytes ------------------------------------------
const BYTES_KEPT = 128 * 1024 * 1024;

/** Pictures' bytes as they are fetched: `now` gives them if they are here (asking for them if not), `all` waits. */
export class PictureBytes {
  private kept = new Map<string, Uint8Array | null>();
  private asked = new Map<string, Promise<Uint8Array | null>>();
  private listeners = new Set<(url: string) => void>();

  constructor(
    private readonly doc: Y.Doc,
    private readonly fetch: (url: string) => Promise<Uint8Array | null>,
  ) {}

  /** Calls `fn` when a picture asked for through `now` has come. */
  onArrive(fn: (url: string) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private get(url: string): Promise<Uint8Array | null> {
    let p = this.asked.get(url);
    if (!p) {
      p = this.fetch(url).catch(() => null);
      this.asked.set(url, p);
      void p.then((bytes) => {
        this.asked.delete(url);
        this.kept.set(url, bytes);
        // The oldest go over the limit.
        let total = 0;
        for (const b of this.kept.values()) total += b?.length ?? 0;
        for (const [u, b] of this.kept) {
          if (total <= BYTES_KEPT || u === url) break;
          total -= b?.length ?? 0;
          this.kept.delete(u);
        }
      });
    }
    return p;
  }

  now: Assets = (url) => {
    const carried = assetsOf(this.doc).get(url);
    if (carried) return carried;
    if (this.kept.has(url)) return this.kept.get(url) ?? undefined;
    void this.get(url).then((bytes) => bytes && this.listeners.forEach((fn) => fn(url)));
    return undefined;
  };

  /** The bytes of each of `urls` (those there are), once all have come: for drawing something complete. */
  async all(urls: Iterable<string>): Promise<Assets> {
    const got = new Map<string, Uint8Array>();
    await Promise.all(
      [...new Set(urls)].map(async (url) => {
        const bytes = assetsOf(this.doc).get(url) ?? (await this.get(url));
        if (bytes) got.set(url, bytes);
      }),
    );
    return (url) => got.get(url);
  }
}
