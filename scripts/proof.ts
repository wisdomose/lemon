// Proof run: the designer agent builds a design from a prompt on an empty document, headless, and
// everything is recorded in proof-output/<name>/.
//
//   npx tsx scripts/proof.ts --name landing --prompt "A landing page for …" [--effort high] [--model …]
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as Y from "yjs";
import { createEngine } from "../src/engine.js";
import { GoogleFonts } from "../src/text/google-fonts.js";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { AGENT_NAME } from "../src/agent/models.js";
import { runAgent, type AgentEvent } from "../src/agent/agent.js";
import { getVars, toTree } from "../src/doc/store.js";
import { layout } from "../src/layout/layout.js";
import { check } from "../src/layout/check.js";
import { screenshot } from "../src/render/screenshot.js";

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "run" },
    prompt: { type: "string" },
    effort: { type: "string" },
    model: { type: "string" },
  },
});
if (!values.prompt) throw new Error("--prompt is required");

const root = join(import.meta.dirname, "..");
const out = join(root, "proof-output", values.name!);
mkdirSync(join(out, "steps"), { recursive: true });
const events = join(out, "events.jsonl");
writeFileSync(events, "");

const engine = await createEngine(await GoogleFonts.open(join(root, ".cache", "fonts")));
const sandbox = await Sandbox.create();
const doc = new Y.Doc();
const t0 = performance.now();

function snapshot(file: string, maxSide: number): void {
  const tree = toTree(doc);
  const vars = getVars(doc);
  const boxes = layout(tree, vars, engine.text);
  for (const frame of tree.children) {
    const pic = screenshot(engine.ck, tree, boxes, vars, engine.text, frame.id, maxSide);
    writeFileSync(`${file}-${frame.id}.png`, pic.png);
  }
}

const stats = await runAgent({
  doc,
  engine,
  sandbox,
  prompt: values.prompt,
  name: AGENT_NAME,
  ...(values.model ? { model: values.model } : {}),
  ...(values.effort ? { effort: values.effort as "high" } : {}),
  onEvent(e: AgentEvent) {
    const at = ((performance.now() - t0) / 1000).toFixed(1);
    appendFileSync(events, JSON.stringify({ at: Number(at), ...e }) + "\n");
    if (e.type === "step-start") console.log(`[${at}s] step ${e.index}: ${e.title}`);
    if (e.type === "step-end") {
      const s = e.step;
      console.log(
        `[${at}s]   ${s.ok ? "ok" : "FAILED: " + s.error} — ${Math.round(s.timings.totalMs)}ms (script ${Math.round(s.timings.scriptMs)}, layout ${Math.round(s.timings.layoutMs)}, fonts ${Math.round(s.timings.fontsMs)}, pictures ${Math.round(s.timings.picturesMs)}), ${s.issues} issue(s) ${JSON.stringify(s.issueKinds)}`,
      );
      if (s.ok) {
        try {
          snapshot(join(out, "steps", String(s.index).padStart(2, "0")), 900);
        } catch (err) {
          console.log("   (snapshot failed:", (err as Error).message, ")");
        }
      }
    }
    if (e.type === "text") console.log(`[${at}s] says: ${e.text.slice(0, 300)}`);
    if (e.type === "error") console.log(`[${at}s] ERROR ${e.message}`);
  },
});

const tree = toTree(doc);
const vars = getVars(doc);
const boxes = layout(tree, vars, engine.text);
const finalIssues = check(tree, boxes, vars, engine.text);
snapshot(join(out, "final"), 3000);
writeFileSync(join(out, "document.json"), JSON.stringify({ vars, tree }, null, 1));
writeFileSync(join(out, "document.yjs"), Y.encodeStateAsUpdate(doc));
let nodes = 0;
const count = (n: typeof tree) => {
  nodes++;
  n.children.forEach(count);
};
tree.children.forEach(count);
const summary = { ...stats, nodes, finalIssues };
writeFileSync(join(out, "stats.json"), JSON.stringify(summary, null, 1));
console.log("\nREPLY:\n" + stats.reply);
console.log(
  `\n${stats.ok ? "OK" : "NOT OK"} in ${(stats.durationMs / 1000).toFixed(0)}s, ${stats.steps.length} steps, ${nodes} nodes, ${finalIssues.length} issues left, $${stats.costUsd.toFixed(2)} (estimate), tokens ${JSON.stringify(stats.tokens)}`,
);
process.exit(0);
