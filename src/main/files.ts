// Where design files live on disk: the Drafts folder for files never saved anywhere else, the list of
// recently opened files, and writing a file so a crash mid-write never leaves it half written.
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { PRODUCT } from "../product.js";

export const EXT = `.${PRODUCT.fileExtension}`;
/** How many files Open Recent remembers. */
const MAX_RECENTS = 20;

/** New files are auto-saved here until Save As puts them somewhere else (as in Pen). */
export function draftsFolder(): string {
  const dir = join(app.getPath("userData"), "Drafts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const isDraft = (path: string) => path.startsWith(draftsFolder());

/** A free name in the Drafts folder: "Untitled", then "Untitled 2", … */
export function newDraftPath(): string {
  const dir = draftsFolder();
  for (let n = 1; ; n++) {
    const path = join(dir, `Untitled${n > 1 ? ` ${n}` : ""}${EXT}`);
    if (!existsSync(path)) return path;
  }
}

/** The name a window shows for a file: its file name. */
export const displayName = (path: string | null) => (path ? basename(path) : `untitled${EXT}`);
export const withoutExt = (path: string) => basename(path, extname(path));

/** Writes beside the file first and then swaps it in, so the file is always whole. */
export function writeWhole(path: string, text: string): void {
  const temp = `${path}.saving`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

// ---- Recent files ----------------------------------------------------------------------------------
export interface Recent {
  path: string;
  openedAt: number;
}

const recentsFile = () => join(app.getPath("userData"), "recents.json");

export function recents(): Recent[] {
  try {
    const list = JSON.parse(readFileSync(recentsFile(), "utf8")) as Recent[];
    return list.filter((r) => existsSync(r.path));
  } catch {
    return [];
  }
}

export function addRecent(path: string): void {
  const list = [{ path, openedAt: Date.now() }, ...recents().filter((r) => r.path !== path)].slice(0, MAX_RECENTS);
  writeFileSync(recentsFile(), JSON.stringify(list, null, 2));
  app.addRecentDocument(path);
}

export function forgetRecent(path: string): void {
  writeFileSync(recentsFile(), JSON.stringify(recents().filter((r) => r.path !== path), null, 2));
}

export function clearRecents(): void {
  writeFileSync(recentsFile(), "[]");
  app.clearRecentDocuments();
}
