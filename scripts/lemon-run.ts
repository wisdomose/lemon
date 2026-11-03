// Runs Lemon's agent on a prompt in a fresh document, for the scripts that make the gallery's content
// (style-previews.ts, design-systems.ts). Not part of the app; needs a build (pnpm build).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as Y from "yjs";

/**
 * Designs `prompt` in `<work>/<id>.pen` with the app's agent, in an app profile of its own (so no
 * servers the person added join in), and leaves the document as `<work>/<id>.yjs`.
 */
export function runInLemon(work: string, id: string, prompt: string): Promise<void> {
  const electron = resolve("node_modules/electron/dist/electron.exe");
  return new Promise((done) => {
    const file = join(work, `${id}.pen`);
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ version: "2.21", children: [] }));
    const child = spawn(electron, [resolve("."), `--user-data-dir=${join(work, `profile-${id}`)}`], {
      env: { ...process.env, LEMON_OPEN: resolve(file), LEMON_PROMPT: prompt, LEMON_CAPTURE: resolve(join(work, `${id}.png`)), LEMON_LOG: resolve(join(work, `${id}.log`)) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b: Buffer) => process.stdout.write(`[${id}] ${b}`));
    child.on("exit", (code) => (console.log(`[${id}] finished (${code})`), done()));
  });
}

/** Runs `jobs` two at a time. */
export async function twoAtATime(jobs: (() => Promise<void>)[]): Promise<void> {
  const queue = [...jobs];
  await Promise.all([0, 1].map(async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await next();
  }));
}

/** A finished run's document, laid out, with what drawing it needs. */
export async function laidOut(work: string, id: string) {
  const { createEngine } = await import("../src/engine.js");
  const { GoogleFonts } = await import("../src/text/google-fonts.js");
  const { getVars, toTree } = await import("../src/doc/store.js");
  const { facesUsed, layout } = await import("../src/layout/layout.js");
  const { assetLookup } = await import("../src/doc/assets.js");
  const engine = (engineCache ??= await createEngine(await GoogleFonts.open(join(import.meta.dirname, "..", ".cache", "fonts"))));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, readFileSync(join(work, `${id}.yjs`)));
  const page = toTree(doc);
  const vars = getVars(doc);
  await engine.fonts.ensure(facesUsed(page, vars));
  return { doc, engine, page, vars, boxes: layout(page, vars, engine.text), assets: assetLookup(doc) };
}
let engineCache: Awaited<ReturnType<typeof import("../src/engine.js").createEngine>> | undefined;
