// Fonts for layout and drawing. Both measure and draw text with the same CanvasKit font collection,
// so what the layout measures is exactly what gets drawn.
import type { CanvasKit, FontCollection, TypefaceFontProvider } from "canvaskit-wasm";

/** One font file: a family at a weight, upright or italic. */
export interface FontFace {
  family: string;
  weight: number;
  italic: boolean;
}

/** Where font files come from: Google Fonts in Node, the host app in a browser window. */
export interface FontSource {
  /** Styles a family offers, as "400" / "400i" keys; undefined if the family is unknown. */
  styles(family: string): string[] | undefined;
  load(face: FontFace): Promise<ArrayBuffer>;
}

/** The family used when a node names none, and the fallback for missing glyphs. */
export const DEFAULT_FONT = "Inter";

const key = (f: FontFace) => `${f.family}|${f.weight}|${f.italic ? "i" : ""}`;

/** Thrown during layout when text needs font files that are not loaded yet. */
export class FontsNeeded extends Error {
  constructor(readonly faces: FontFace[]) {
    super(`Fonts not loaded yet: ${faces.map(key).join(", ")}`);
  }
}

export class FontLibrary {
  readonly provider: TypefaceFontProvider;
  readonly collection: FontCollection;
  private loaded = new Set<string>();
  private unavailable = new Set<string>();

  constructor(
    readonly ck: CanvasKit,
    private source: FontSource,
  ) {
    this.provider = ck.TypefaceFontProvider.Make();
    this.collection = ck.FontCollection.Make();
    this.collection.setDefaultFontManager(this.provider);
    this.collection.enableFontFallback();
  }

  /** Families registered from bytes the host already has (e.g. the window's own UI font). */
  private local = new Map<string, string[]>();

  /** Whether the family exists at all. */
  known(family: string): boolean {
    return this.styles(family) !== undefined;
  }

  /** Styles the family offers ("400", "700i", …), or undefined for an unknown family. */
  styles(family: string): string[] | undefined {
    return this.local.get(family) ?? this.source.styles(family);
  }

  /** Registers a font file that doesn't come from the font source. */
  addLocal(face: FontFace, bytes: ArrayBuffer): void {
    const styles = this.local.get(face.family) ?? [];
    styles.push(`${face.weight}${face.italic ? "i" : ""}`);
    this.local.set(face.family, styles);
    this.add(face, bytes);
  }

  /** The face that will actually be used for a request: the nearest style the family has. */
  resolve(face: FontFace): FontFace {
    const family = this.known(face.family) ? face.family : DEFAULT_FONT;
    const styles = this.styles(family) ?? ["400"];
    const want = face.italic ? styles.filter((s) => s.endsWith("i")) : styles.filter((s) => !s.endsWith("i"));
    const pool = (want.length ? want : styles).map((s) => ({ w: parseInt(s, 10), i: s.endsWith("i") }));
    pool.sort((a, b) => Math.abs(a.w - face.weight) - Math.abs(b.w - face.weight) || a.w - b.w);
    const best = pool[0]!;
    return { family, weight: best.w, italic: best.i };
  }

  isLoaded(face: FontFace): boolean {
    const k = key(this.resolve(face));
    return this.loaded.has(k) || this.unavailable.has(k);
  }

  /** Faces among `faces` that still need loading. */
  missing(faces: FontFace[]): FontFace[] {
    const out = new Map<string, FontFace>();
    for (const f of faces) {
      const r = this.resolve(f);
      const k = key(r);
      if (!this.loaded.has(k) && !this.unavailable.has(k)) out.set(k, r);
    }
    return [...out.values()];
  }

  async ensure(faces: FontFace[]): Promise<void> {
    await Promise.all(
      this.missing([...faces, { family: DEFAULT_FONT, weight: 400, italic: false }]).map(async (f) => {
        try {
          this.add(f, await this.source.load(f));
        } catch {
          this.unavailable.add(key(f));
        }
      }),
    );
  }

  /** Registers font bytes directly (used by windows that receive fonts from the host). */
  add(face: FontFace, bytes: ArrayBuffer): void {
    const k = key(face);
    if (this.loaded.has(k)) return;
    this.provider.registerFont(bytes, face.family);
    this.loaded.add(k);
  }

  loadedFaces(): FontFace[] {
    return [...this.loaded].map((k) => {
      const [family, w, i] = k.split("|");
      return { family: family!, weight: Number(w), italic: i === "i" };
    });
  }
}
