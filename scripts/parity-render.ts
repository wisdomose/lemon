// Renders each top-level frame of a .pen file to PNG (for comparing with Pen). Not part of the app.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { createEngine } from "../src/engine.js";
import { GoogleFonts } from "../src/text/google-fonts.js";
import { readFile } from "../src/doc/file.js";
import { getVars, toTree } from "../src/doc/store.js";
import { facesUsed, layout } from "../src/layout/layout.js";
import { screenshot } from "../src/render/screenshot.js";
import { assetLookup } from "../src/doc/assets.js";

const [file, out] = process.argv.slice(2);
mkdirSync(out!, { recursive: true });
const engine = await createEngine(await GoogleFonts.open(join(import.meta.dirname, "..", ".cache", "fonts")));
const doc = new Y.Doc();
readFile(readFileSync(file!, "utf8"), doc);
const page = toTree(doc);
const vars = getVars(doc);
await engine.fonts.ensure(facesUsed(page, vars));
const boxes = layout(page, vars, engine.text);
for (const f of page.children) writeFileSync(join(out!, `${f.id}-${String(f.props.name ?? "").replace(/\W+/g, "-")}.png`), screenshot(engine.ck, page, boxes, vars, engine.text, assetLookup(doc), f.id, 520).png);
console.log("rendered", page.children.length);
