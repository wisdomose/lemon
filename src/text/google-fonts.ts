// Font files from Google Fonts, cached on disk. Node only (the app's main process and scripts).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FontFace, FontSource } from "./fonts.js";

const METADATA_URL = "https://fonts.google.com/metadata/fonts";
// Google serves TrueType (which CanvasKit reads) instead of WOFF2 to clients that don't ask for WOFF2.
const PLAIN_CLIENT = "Mozilla/4.0";

interface Catalogue {
  /** family → styles such as "400", "400i" */
  families: Record<string, string[]>;
  /** family → "Serif" | "Sans Serif" | "Display" | "Handwriting" | "Monospace" */
  categories: Record<string, string>;
}

export class GoogleFonts implements FontSource {
  private constructor(
    private dir: string,
    readonly catalogue: Catalogue,
  ) {}

  /** Opens the cache in `dir`, downloading the catalogue of families the first time. */
  static async open(dir: string): Promise<GoogleFonts> {
    await mkdir(join(dir, "files"), { recursive: true });
    const path = join(dir, "catalogue.json");
    let catalogue: Catalogue;
    if (existsSync(path)) {
      catalogue = JSON.parse(readFileSync(path, "utf8"));
    } else {
      const res = await fetch(METADATA_URL);
      if (!res.ok) throw new Error(`Google Fonts catalogue: HTTP ${res.status}`);
      const raw = (await res.json()) as {
        familyMetadataList: { family: string; fonts: Record<string, unknown>; category: string }[];
      };
      catalogue = { families: {}, categories: {} };
      for (const f of raw.familyMetadataList) {
        catalogue.families[f.family] = Object.keys(f.fonts);
        catalogue.categories[f.family] = f.category;
      }
      await writeFile(path, JSON.stringify(catalogue));
    }
    return new GoogleFonts(dir, catalogue);
  }

  styles(family: string): string[] | undefined {
    return this.catalogue.families[family];
  }

  async load(face: FontFace): Promise<ArrayBuffer> {
    const file = join(this.dir, "files", `${face.family.replace(/[^\w-]/g, "_")}-${face.weight}${face.italic ? "i" : ""}.ttf`);
    if (existsSync(file)) return toArrayBuffer(await readFile(file));
    const axis = `ital,wght@${face.italic ? 1 : 0},${face.weight}`;
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(face.family)}:${axis}`,
      { headers: { "User-Agent": PLAIN_CLIENT } },
    );
    if (!css.ok) throw new Error(`Google Fonts: ${face.family} ${face.weight}: HTTP ${css.status}`);
    const url = /url\((https:[^)]+\.ttf)\)/.exec(await css.text())?.[1];
    if (!url) throw new Error(`Google Fonts: no TrueType file for ${face.family} ${face.weight}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Fonts: ${url}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await writeFile(file, bytes);
    return toArrayBuffer(bytes);
  }
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
