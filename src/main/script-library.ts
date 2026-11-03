// "Choose a style" → Scripts → Insert to Canvas: the library script goes beside the open file, in its
// "scripts" folder, as Pen does it (3 Nov 2026): scripts/<id>.js, kept as it is if already there.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const FILES = import.meta.glob<string>("./script-library/*.js", { eager: true, query: "?raw", import: "default" });

/** Puts library script `id` beside `documentPath`: the script node's uri, or why it couldn't. */
export function placeLibraryScript(documentPath: string | null, id: string): { uri: string } | { error: string } {
  const source = FILES[`./script-library/${id}.js`];
  if (source === undefined) return { error: `There is no script "${id}".` };
  if (!documentPath) return { error: "Save the file first: scripts are kept beside it." };
  const folder = join(dirname(documentPath), "scripts");
  const file = join(folder, `${id}.js`);
  if (!existsSync(file)) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, source);
  }
  return { uri: `scripts/${id}.js` };
}
