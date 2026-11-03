// Draws the pictures "Choose a style" → Scripts shows: each library script run as Lemon runs a script node
// (main/scripts.ts), at its own size, in the middle of a 5:3 white card. Not part of the app.
//   npx tsx scripts/script-previews.ts <work folder>
// Writes <work folder>/<id>.png, for src/renderer/agent/scripts/<id>.webp once made smaller.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { SCRIPTS } from "../src/agent/script-library.js";
import { runScript } from "../src/main/scripts.js";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { createEngine } from "../src/engine.js";
import { GoogleFonts } from "../src/text/google-fonts.js";
import { readFile } from "../src/doc/file.js";
import { getVars, toTree } from "../src/doc/store.js";
import { facesUsed, layout } from "../src/layout/layout.js";
import { screenshot } from "../src/render/screenshot.js";
import { assetLookup } from "../src/doc/assets.js";

const work = process.argv[2];
if (!work) throw new Error("usage: script-previews.ts <work folder>");
mkdirSync(work, { recursive: true });
const sandbox = await Sandbox.create();
const engine = await createEngine(await GoogleFonts.open(join(import.meta.dirname, "..", ".cache", "fonts")));
const CARD = { width: 600, height: 360 };

let n = 0;
const withIds = (nodes: Record<string, unknown>[]): Record<string, unknown>[] =>
  nodes.map((node) => ({ ...node, id: `n${++n}`, ...(Array.isArray(node.children) ? { children: withIds(node.children as Record<string, unknown>[]) } : {}) }));

for (const s of SCRIPTS) {
  const out = runScript(sandbox, join(import.meta.dirname, "..", "src", "main", "script-library", `${s.id}.js`), s.width, s.height, {});
  if (!out.ok) throw new Error(`${s.id}: ${out.kind === "error" ? out.message : "missing"}`);
  // Every library script fits the card at its own size.
  const art = { type: "frame", id: "art", x: (CARD.width - s.width) / 2, y: (CARD.height - s.height) / 2, width: s.width, height: s.height, layout: "none", children: withIds(out.nodes) };
  const card = { type: "frame", id: "card", x: 0, y: 0, width: CARD.width, height: CARD.height, layout: "none", fill: "#FFFFFF", children: [art] };
  const doc = new Y.Doc();
  readFile(JSON.stringify({ version: "2.21", children: [card] }), doc);
  const page = toTree(doc);
  const vars = getVars(doc);
  await engine.fonts.ensure(facesUsed(page, vars));
  const boxes = layout(page, vars, engine.text);
  writeFileSync(join(work, `${s.id}.png`), screenshot(engine.ck, page, boxes, vars, engine.text, assetLookup(doc), "card", 1200).png);
  console.log(s.id, out.nodes.length, "nodes");
}
