import { join } from "node:path";
import * as Y from "yjs";
import { createEngine, type Engine } from "../src/engine.js";
import { GoogleFonts } from "../src/text/google-fonts.js";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { execute } from "../src/agent/execute.js";

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
