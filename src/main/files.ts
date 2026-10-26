// Where design files live on disk: the Drafts folder for files never saved anywhere else, the list of
// recently opened files, each file's picture for the Dashboard, and writing a file so a crash mid-write
// never leaves it half written.
import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** A free name in the Drafts folder: "Untitled" (or `name`), then "Untitled 2", … */
export function newDraftPath(name = "Untitled"): string {
  const dir = draftsFolder();
  for (let n = 1; ; n++) {
    const path = join(dir, `${name}${n > 1 ? ` ${n}` : ""}${EXT}`);
    if (!existsSync(path)) return path;
  }
}

/** The name a window shows for a file: its file name. */
export const displayName = (path: string | null) => (path ? basename(path) : `untitled${EXT}`);
export const withoutExt = (path: string) => basename(path, extname(path));

/** Writes beside the file first and then swaps it in, so the file is always whole. */
export function writeWhole(path: string, text: string | Uint8Array): void {
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

// ---- Pictures for the Dashboard ---------------------------------------------------------------------
/** A file's picture, kept with the app's data (by the file's path) rather than inside the file. */
export function thumbPath(path: string): string {
  const dir = join(app.getPath("userData"), "Thumbnails");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${createHash("sha1").update(path).digest("hex").slice(0, 20)}.png`);
}

export function writeThumb(path: string, png: Uint8Array | undefined): void {
  if (png) writeWhole(thumbPath(path), png);
  else rmSync(thumbPath(path), { force: true });
}

// ---- The Dashboard's lists ---------------------------------------------------------------------------
export interface FileCard {
  path: string;
  name: string;
  /** When the person last opened it (Recents only). */
  openedAt?: number;
  editedAt: number;
  createdAt: number;
  /** Its picture as a data URL; none until it has been saved with something on the page. */
  thumb?: string;
}

function card(path: string, openedAt?: number): FileCard | undefined {
  try {
    const st = statSync(path);
    const thumb = thumbPath(path);
    return {
      path,
      name: basename(path),
      ...(openedAt ? { openedAt } : {}),
      editedAt: st.mtimeMs,
      createdAt: st.birthtimeMs || st.ctimeMs,
      ...(existsSync(thumb) ? { thumb: `data:image/png;base64,${readFileSync(thumb).toString("base64")}` } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Recently opened files, and every draft, newest first. */
export function dashboardFiles(): { recents: FileCard[]; drafts: FileCard[] } {
  const dir = draftsFolder();
  const drafts = readdirSync(dir)
    .filter((f) => f.endsWith(EXT))
    .map((f) => card(join(dir, f)))
    .filter((c) => !!c)
    .sort((a, b) => b.editedAt - a.editedAt);
  const recent = recents()
    .map((r) => card(r.path, r.openedAt))
    .filter((c) => !!c)
    .sort((a, b) => Math.max(b.openedAt!, b.editedAt) - Math.max(a.openedAt!, a.editedAt));
  return { recents: recent, drafts };
}

/** Deletes a draft for good, with its picture. */
export function deleteDraft(path: string): void {
  if (!isDraft(path)) throw new Error("Only drafts can be deleted here.");
  rmSync(path, { force: true });
  rmSync(thumbPath(path), { force: true });
  forgetRecent(path);
}
