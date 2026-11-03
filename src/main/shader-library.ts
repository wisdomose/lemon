// Shader files: read for the canvas from beside the document, and Lemon's own shaders ("Choose a style"
// → Shaders) put there when used, in its "shaders" folder (as scripts go in "scripts").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const FILES = import.meta.glob<string>("./shader-library/*.glsl", { eager: true, query: "?raw", import: "default" });

/** A shader file's text: `url` as a fill or effect names it, relative to the document. Null if there is none. */
export function shaderSource(documentPath: string | null, url: string): string | null {
  if (!url || /^[a-z]+:/i.test(url.replace(/^[A-Za-z]:[\\/]/, ""))) return null;
  const file = isAbsolute(url) ? url : documentPath ? resolve(dirname(documentPath), url) : null;
  if (!file || !existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Puts library shader `id` beside `documentPath` (kept if already there): the url for fills and effects. */
export function placeLibraryShader(documentPath: string | null, id: string): { url: string } | { error: string } {
  const source = FILES[`./shader-library/${id}.glsl`];
  if (source === undefined) return { error: `There is no shader "${id}".` };
  if (!documentPath) return { error: "Save the file first: shaders are kept beside it." };
  const folder = join(dirname(documentPath), "shaders");
  const file = join(folder, `${id}.glsl`);
  if (!existsSync(file)) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, source);
  }
  return { url: `shaders/${id}.glsl` };
}
