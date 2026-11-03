// Makes the design systems "Choose a style" → Design Systems offers: Lemon's agent builds each as a .pen
// file of variables and reusable components, with an example screen made from them (its card's picture).
// Not part of the app. Build first (pnpm build), then:
//   npx tsx scripts/design-systems.ts run <work folder> <id>...
//   npx tsx scripts/design-systems.ts save <work folder> <id>...
// "save" writes <id>.pen into src/main/design-systems and the example screen to <work folder>/<id>-overview.png
// (for src/renderer/agent/design-systems/<id>.webp once made smaller).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_SYSTEMS } from "../src/agent/design-systems.js";
import { laidOut, runInLemon, twoAtATime } from "./lemon-run.js";

const [mode, work, ...ids] = process.argv.slice(2);
if (!work || !ids.length || (mode !== "run" && mode !== "save")) throw new Error("usage: design-systems.ts run|save <work folder> <id>...");
mkdirSync(work, { recursive: true });
const systems = ids.map((id) => {
  const s = DESIGN_SYSTEMS.find((d) => d.id === id);
  if (!s) throw new Error(`No design system "${id}"`);
  return s;
});

const EXAMPLE = "Overview";
const prompt = (name: string, brief: string) =>
  [
    `Make "${name}", a design system for product interfaces: ${brief}`,
    "",
    "- Variables for its colours, type, corner radii and spacing, used everywhere instead of fixed values.",
    "- Reusable components, each its own top-level frame named after it: Button (primary, secondary, ghost), Icon Button, Input, Select, Checkbox, Switch, Badge, Avatar (initials), Tabs, Sidebar Item, Card, Stat, Table Row, Alert, Dialog.",
    `- One more top-level frame, "${EXAMPLE}", 1440 × 900: a dashboard screen built only from instances of those components (for a made-up product; real, specific content).`,
    "No photographs anywhere. Lay the frames out tidily, the components in a grid and the screen beside them.",
  ].join("\n");

if (mode === "run") {
  await twoAtATime(systems.map((s) => () => runInLemon(work, s.id, prompt(s.name, s.brief))));
} else {
  const { screenshot } = await import("../src/render/screenshot.js");
  const { fileText } = await import("../src/doc/file.js");
  for (const s of systems) {
    const { doc, engine, page, vars, boxes, assets } = await laidOut(work, s.id);
    writeFileSync(join(import.meta.dirname, "..", "src", "main", "design-systems", `${s.id}.pen`), fileText(doc));
    const frame = page.children.find((f) => f.props.name === EXAMPLE);
    if (frame) writeFileSync(join(work, `${s.id}-overview.png`), screenshot(engine.ck, page, boxes, vars, engine.text, assets, frame.id, 1440).png);
    console.log(`[${s.id}] saved${frame ? "" : ` (no "${EXAMPLE}" frame)`}`);
  }
}
