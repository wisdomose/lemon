// "Choose a style" → Design Systems: .pen files of components and variables that come with Lemon. As in
// Pen (3 Nov 2026), opening one opens a copy of it as a new draft, so the original stays as it was.
// The files are made by Lemon's agent (scripts/design-systems.ts) and kept in ./design-systems.
import { writeFileSync } from "node:fs";
import { newDraftPath } from "./files.js";

const FILES = import.meta.glob<string>("./design-systems/*.pen", { eager: true, query: "?raw", import: "default" });

/** The design system `id` (its file's name) copied into a new draft: the draft's path, or null if there is none. */
export function copyDesignSystem(id: string): string | null {
  const text = FILES[`./design-systems/${id}.pen`];
  if (text === undefined) return null;
  const path = newDraftPath(id);
  writeFileSync(path, text);
  return path;
}
