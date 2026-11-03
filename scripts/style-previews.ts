// Makes the pictures "Choose a style" shows for a style: Lemon's agent designs one made-up brand in the
// style three ways (a landing page, a web app screen, a phone screen), as Pen's gallery shows its styles.
// Not part of the app. Build first (pnpm build), then:
//   npx tsx scripts/style-previews.ts run <work folder> <style id>...
//   npx tsx scripts/style-previews.ts render <work folder> <style id>...
// "run" designs each style (two at a time); "render" draws the frames to <work folder>/<id>-<view>.png,
// for src/renderer/agent/styles/ once made smaller (webp).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIRECTIONS, styleText } from "../src/agent/directions.js";
import { laidOut, runInLemon, twoAtATime } from "./lemon-run.js";

const [mode, work, ...ids] = process.argv.slice(2);
if (!work || !ids.length || (mode !== "run" && mode !== "render")) throw new Error("usage: style-previews.ts run|render <work folder> <style id>...");
mkdirSync(work, { recursive: true });
const styles = ids.map((id) => {
  const d = DIRECTIONS.find((s) => s.id === id);
  if (!d) throw new Error(`No style "${id}"`);
  return d;
});

/** The frames each style gets, by name; the gallery shows them in these views. */
const VIEWS = { landing: "Landing page", web: "Web app", mobile: "Mobile app" } as const;

const prompt = (style: string) =>
  [
    style,
    "",
    "Make three top-level frames for one made-up brand that suits this style (invent its name and what it does; real, specific copy, never lorem ipsum):",
    `1. "${VIEWS.landing}": its landing page, 1440 wide, at least four sections tall.`,
    `2. "${VIEWS.web}": the main screen of its web app, 1440 × 900.`,
    `3. "${VIEWS.mobile}": the main screen of its phone app, 390 × 844.`,
    "Name the frames exactly as above and put them side by side.",
  ].join("\n");

if (mode === "run") {
  await twoAtATime(styles.map((d) => () => runInLemon(work, d.id, prompt(styleText(d)))));
} else {
  const { screenshot } = await import("../src/render/screenshot.js");
  for (const d of styles) {
    const { engine, page, vars, boxes, assets } = await laidOut(work, d.id);
    for (const [view, name] of Object.entries(VIEWS)) {
      const frame = page.children.find((f) => f.props.name === name);
      if (!frame) {
        console.log(`[${d.id}] no "${name}" frame`);
        continue;
      }
      // At least twice the gallery's card width, for sharp pictures on high-density screens.
      const side = view === "mobile" ? 1700 : view === "web" ? 1440 : 3200;
      writeFileSync(join(work, `${d.id}-${view}.png`), screenshot(engine.ck, page, boxes, vars, engine.text, assets, frame.id, side).png);
      console.log(`[${d.id}] ${view}`);
    }
  }
}
