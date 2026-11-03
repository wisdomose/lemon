// "Add from workspace": the files beside the open document that can be attached. Pen lists its cloud
// workspace; Lemon has none, so its workspace is the folder the document is saved in (and the folders
// in it). A draft (never saved) has no folder of its own and lists nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { kindOf, type Attachment } from "../agent/attachments.js";
import { isDraft } from "./files.js";

export interface WorkspaceFile {
  /** Relative to the workspace folder, with "/" between folders. */
  path: string;
  kind: Attachment["kind"];
  size: number;
}

/** Enough for any real folder; past this the list stops. */
const MOST = 500;
const DEEPEST = 4;
/** Folders that hold tools' files, not the person's. */
const SKIPPED = new Set(["node_modules", "dist", "build", "out"]);

export function workspaceFolder(documentPath: string | null): string | null {
  return documentPath && !isDraft(documentPath) ? dirname(documentPath) : null;
}

/**
 * The attachable files in the workspace: each folder's own files (in name order) before its folders'.
 * `document` (the open one) isn't offered.
 */
export function listWorkspace(folder: string | null, document?: string | null): WorkspaceFile[] {
  if (!folder) return [];
  const found: WorkspaceFile[] = [];
  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    const shown = entries.filter((e) => !e.name.startsWith(".") || e.name === ".env");
    for (const entry of shown) {
      const full = join(dir, entry.name);
      const type = entry.isFile() && full !== document ? kindOf(entry.name) : null;
      if (type && found.length < MOST) found.push({ path: relative(folder, full).split(sep).join("/"), kind: type.kind, size: statSync(full).size });
    }
    for (const entry of shown) if (entry.isDirectory() && depth < DEEPEST && !SKIPPED.has(entry.name)) walk(join(dir, entry.name), depth + 1);
  };
  walk(folder, 0);
  return found;
}

/** The chosen files, read for the agent; ones outside the workspace or no longer there are left out. */
export function readWorkspace(folder: string | null, paths: string[]): Attachment[] {
  if (!folder) return [];
  const listed = new Set(listWorkspace(folder).map((f) => f.path));
  return paths.flatMap((path) => {
    const type = listed.has(path) ? kindOf(path) : null;
    if (!type) return [];
    try {
      const bytes = readFileSync(join(folder, ...path.split("/")));
      const name = path.split("/").pop()!;
      return [{ name, ...type, data: type.kind === "text" ? bytes.toString("utf8") : bytes.toString("base64") }];
    } catch {
      return [];
    }
  });
}
