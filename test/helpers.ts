import { join } from "node:path";
import * as Y from "yjs";
import { createEngine, type Engine } from "../src/engine.js";
import { GoogleFonts } from "../src/text/google-fonts.js";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { execute } from "../src/agent/execute.js";
import { generateKeyBetween } from "fractional-indexing";
import { ROOT_ID, type PenNode } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";

let shared: Promise<{ engine: Engine; sandbox: Sandbox }> | undefined;

/** One engine and sandbox for all tests; fonts are cached in .cache/fonts. */
export function setup() {
  shared ??= (async () => {
    const fonts = await GoogleFonts.open(join(import.meta.dirname, "..", ".cache", "fonts"));
    return { engine: await createEngine(fonts), sandbox: await Sandbox.create() };
  })();
  return shared;
}

export async function run(doc: Y.Doc, script: string) {
  const { engine, sandbox } = await setup();
  return execute(doc, engine, sandbox, script, "test");
}

/** Puts a node tree into `doc` as given, keeping its ids (so a test can name nodes), last under `parent`. */
export function put(doc: Y.Doc, spec: PenNode, parent: string = ROOT_ID): string {
  const siblings = store.childIds(doc, parent);
  const last = siblings.length ? (store.nodesOf(doc).get(siblings.at(-1)!)!.get("order") as string) : null;
  return store.insertAsIs(doc, parent, spec, generateKeyBetween(last, null));
}
