import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { layout, facesUsed } from "../src/layout/layout.js";
import { htmlFor } from "../src/renderer/codegen.js";
import { put, setup } from "./helpers.js";
import type { Engine } from "../src/engine.js";

let engine: Engine;
beforeAll(async () => {
  engine = (await setup()).engine;
});

async function gen(style: "css" | "tailwind") {
  const doc = new Y.Doc();
  put(doc, {
    type: "frame", id: "Card", name: "Card", x: 50, y: 50, width: 200, height: 120, fill: "#ffffff", cornerRadius: 8, layout: "vertical", gap: 10, padding: 12,
    effect: { type: "shadow", offset: { x: 0, y: 2 }, blur: 4, color: "#00000033" },
    children: [
      { type: "text", id: "T", name: "Title", content: "Hello <b>", fontSize: 20, fontWeight: "700", fill: "#111111", fontFamily: "Inter" },
      { type: "text", id: "T2", name: "Plain", content: "No weight" },
      { type: "frame", id: "Row", name: "Row", children: [{ type: "rectangle", id: "R1", name: "Dot", width: 8, height: 8, fill: "#000000" }] },
      { type: "rectangle", id: "R", name: "Bar", width: 80, height: 20, fill: [{ type: "gradient", rotation: 180, colors: [{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }] }] },
    ],
  });
  const tree = store.toTree(doc);
  const vars = store.getVars(doc);
  await engine.fonts.ensure(facesUsed(tree, vars));
  return htmlFor(tree.children, vars, layout(tree, vars, engine.text), style);
}

describe("copy as HTML", () => {
  it("writes HTML + CSS", async () => {
    const out = await gen("css");
    expect(out).toContain('class="card"');
    expect(out).toContain("display: flex");
    expect(out).toContain("border-radius: 8px");
    expect(out).toContain("box-shadow: 0px 2px 4px 0px rgba(0, 0, 0, 0.2)");
    expect(out).toContain("Hello &lt;b&gt;");
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("undefined");
    // A frame without \`layout\` is a row, as the layout engine places it.
    expect(out).toMatch(/\.row \{[^}]*display: flex;[^}]*flex-direction: row;/);
    expect(out).toContain("linear-gradient(180deg");
  });
  it("writes HTML + Tailwind", async () => {
    const out = await gen("tailwind");
    expect(out).toContain("[display:flex]");
    expect(out).not.toContain("<style>");
    // Every class attribute closes where it should: no double quote inside a class.
    for (const m of out.matchAll(/class="([^"]*)"/g)) expect(m[1]).not.toMatch(/\[[^\]]*$/);
    expect(out).toContain("[font-family:'Inter',_sans-serif]");
  });
});

describe("copy as HTML + Tailwind on a real design system", () => {
  it("writes only classes Tailwind can compile", async () => {
    const { readFileSync, writeFileSync } = await import("node:fs");
    const { readFile } = await import("../src/doc/file.js");
    const { compile } = await import("tailwindcss");
    const doc = new Y.Doc();
    readFile(readFileSync("src/main/design-systems/citrus.pen", "utf8"), doc);
    const tree = store.toTree(doc);
    const vars = store.getVars(doc);
    await engine.fonts.ensure(facesUsed(tree, vars));
    const boxes = layout(tree, vars, engine.text);
    const html = htmlFor(tree.children, vars, boxes, "tailwind");
    const classes = [...new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(" ")))];
    const tw = await compile("@tailwind utilities;", {});
    const css = tw.build(classes);
    // Each class is a rule in the compiled stylesheet (Tailwind skips what it can't read).
    const missing = classes.filter((c) => !css.includes(c.replace(/[[\]:'(),.#%/]/g, (ch) => `\\${ch}`)));
    expect(missing).toEqual([]);
    if (process.env.DUMP_TW) writeFileSync(process.env.DUMP_TW, `<style>${css}</style>\n${html}`);
  });
});

describe("copy as HTML: shapes CSS can't draw", () => {
  async function one(spec: Record<string, unknown>) {
    const doc = new Y.Doc();
    put(doc, { type: "frame", id: "F", name: "F", x: 0, y: 0, width: 200, height: 200, layout: "none", children: [{ id: "N", name: "N", x: 0, y: 0, ...spec } as never] });
    const tree = store.toTree(doc);
    const vars = store.getVars(doc);
    await engine.fonts.ensure(facesUsed(tree, vars));
    return htmlFor([tree.children[0]!.children[0]!], vars, layout(tree, vars, engine.text), "css");
  }
  it("draws a Lucide icon from its shape data", async () => {
    const out = await one({ type: "icon", width: 24, height: 24, library: "lucide", icon: "arrow-right", fill: "#ff0000" });
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('stroke="#ff0000"');
    expect(out).toMatch(/<path d="[^"]*M5 12h14/);
  });
  it("writes a font icon as its ligature in the icon font", async () => {
    const out = await one({ type: "icon", width: 24, height: 24, library: "Material Symbols Rounded", icon: "home", weight: 600 });
    expect(out).toContain('font-family: "Material Symbols Rounded"');
    expect(out).toContain(">home<");
    const bold = await one({ type: "icon", width: 24, height: 24, library: "phosphor", icon: "house", weight: 700 });
    expect(bold).toContain('font-family: "Phosphor-Bold"');
    expect(bold).toContain(">house-bold<");
  });
  it("draws lines, polygons and arcs as SVG", async () => {
    expect(await one({ type: "line", width: 60, height: 40, stroke: "#000000", strokeWidth: 3 })).toContain('<line x1="0" y1="0" x2="60" y2="40"');
    expect(await one({ type: "polygon", width: 60, height: 60, polygonCount: 3, fill: "#00ff00" })).toContain('<polygon points="30,0 ');
    expect(await one({ type: "ellipse", width: 60, height: 60, sweepAngle: 90, fill: "#0000ff" })).toContain("<path d=\"M60 30A30 30 0 0 0 30 0L30 30Z\"");
    // A whole ellipse is still a div with a radius.
    expect(await one({ type: "ellipse", width: 60, height: 60, fill: "#0000ff" })).toContain("border-radius: 50%");
  });
});
