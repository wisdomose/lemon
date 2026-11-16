// A document's pictures as files beside its .pen file (Node only: the main process, the scripts'
// process, tests and scripts). See doc/assets.ts for how a document finds its pictures.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PictureReader } from "./assets.js";

/** Where a picture url in a .pen file points: relative to the file's folder. */
export const pictureFile = (penPath: string, url: string) => resolve(dirname(penPath), decodeURIComponent(url.replace(/^file:\/\//, "")));

/** Reads the pictures beside the .pen file at `path()` (wherever the file is now), one at a time, when asked. */
export function picturesBeside(path: () => string | null | undefined): PictureReader {
  const file = (url: string) => {
    const pen = path();
    return pen ? pictureFile(pen, url) : undefined;
  };
  return {
    read(url) {
      const f = file(url);
      try {
        return f ? new Uint8Array(readFileSync(f)) : undefined;
      } catch {
        return undefined;
      }
    },
    has(url) {
      const f = file(url);
      return !!f && existsSync(f);
    },
  };
}
