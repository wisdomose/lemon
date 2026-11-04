import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { layout, facesUsed } from "../src/layout/layout.js";
import { check } from "../src/layout/check.js";
import { put, setup } from "./helpers.js";
import type { Engine } from "../src/engine.js";

let engine: Engine;
beforeAll(async () => {
  engine = (await setup()).engine;
});

async function laidOut(doc: Y.Doc) {
  const tree = store.toTree(doc);
  const vars = store.getVars(doc);
  await engine.fonts.ensure(facesUsed(tree, vars));
  return { tree, vars, boxes: layout(tree, vars, engine.text) };
}

describe("layout", () => {
  it("stacks a vertical frame with padding and gap, and hugs its content", async () => {
    const doc = new Y.Doc();
    put(doc, {
      type: "frame", id: "f", x: 100, y: 50, padding: 20, gap: 10, layout: "vertical",
      children: [
        { type: "rectangle", id: "a", width: 200, height: 40 },
        { type: "rectangle", id: "b", width: 120, height: 30 },
      ],
    });
    const { boxes } = await laidOut(doc);
    expect(boxes.get("f")).toEqual({ x: 100, y: 50, w: 240, h: 120 });
    expect(boxes.get("b")).toEqual({ x: 120, y: 120, w: 120, h: 30 });
  });

  it("lays a frame out in a row unless told otherwise (Pen's default)", async () => {
    const doc = new Y.Doc();
    put(doc, { type: "frame", id: "f", gap: 4, children: [{ type: "rectangle", id: "a", width: 10, height: 10 }, { type: "rectangle", id: "b", width: 10, height: 20 }] });
    const { boxes } = await laidOut(doc);
    expect(boxes.get("b")).toMatchObject({ x: 14, y: 0 });
    expect(boxes.get("f")).toMatchObject({ w: 24, h: 20 });
  });

  it("shares a row between fill_container children and wraps fixed-width text", async () => {
    const doc = new Y.Doc();
    put(doc, {
      type: "frame", layout: "horizontal", width: 600, gap: 20,
      children: [
        { type: "rectangle", width: 100, height: 10 },
        { type: "frame", id: "left", width: "fill_container", layout: "vertical", children: [
          { type: "text", id: "t", textGrowth: "fixed-width", width: "fill_container", fontSize: 16, content: "A sentence long enough that it must wrap onto several lines in a narrow column of text." },
        ] },
        { type: "frame", id: "right", width: "fill_container", height: 10 },
      ],
    });
    const { boxes } = await laidOut(doc);
    expect(boxes.get("left")!.w).toBeCloseTo(230, 5);
    expect(boxes.get("right")!.x).toBeCloseTo(370, 5);
    const t = boxes.get("t")!;
    expect(t.w).toBeCloseTo(230, 5);
    expect(t.h).toBeGreaterThan(50); // several lines
  });

  it("sizes text by textGrowth: auto ignores width and never wraps", async () => {
    const doc = new Y.Doc();
    const content = "A sentence long enough that it would wrap in a narrow box";
    put(doc, { type: "frame", layout: "vertical", width: 100, children: [
      { type: "text", id: "auto", content, width: 50, fontSize: 16 },
      { type: "text", id: "box", content, textGrowth: "fixed-width-height", width: 80, height: 30, fontSize: 16 },
    ] });
    const { boxes } = await laidOut(doc);
    expect(boxes.get("auto")!.w).toBeGreaterThan(300);
    expect(boxes.get("box")).toMatchObject({ w: 80, h: 30 });
  });

  it("uses fallbacks, groups, absolute children and switched-off nodes", async () => {
    const doc = new Y.Doc();
    put(doc, { type: "frame", id: "f", layout: "vertical", width: "fit_content(300)", children: [
      { type: "rectangle", id: "gone", width: 50, height: 50, enabled: false },
      { type: "group", id: "g", children: [{ type: "rectangle", x: 10, y: 5, width: 20, height: 30 }] },
      { type: "rectangle", id: "abs", layoutPosition: "absolute", x: 40, y: 40, width: 5, height: 5 },
    ] });
    put(doc, { type: "frame", id: "empty", width: "fit_content(120)", height: "fit_content(80)" });
    const { boxes } = await laidOut(doc);
    // In a column, a group is exactly as big as its children, which start at its slot's corner (as in Pen).
    expect(boxes.get("g")).toMatchObject({ x: 0, y: 0, w: 20, h: 30 });
    expect(boxes.get("abs")).toMatchObject({ x: 40, y: 40 });
    expect(boxes.get("f")).toMatchObject({ w: 20, h: 30 });
    expect(boxes.get("empty")).toMatchObject({ w: 120, h: 80 });
  });

  it("places a free group's children by its x/y plus theirs, even negative, and spans them (as in Pen)", async () => {
    const doc = new Y.Doc();
    put(doc, { type: "frame", id: "p", x: 0, y: 0, width: 400, height: 300, layout: "none", children: [
      { type: "group", id: "neg", x: 100, y: 50, children: [
        { type: "rectangle", id: "n1", x: -80, y: 20, width: 40, height: 40 },
        { type: "rectangle", id: "n2", x: 50, y: 0, width: 40, height: 40 },
      ] },
      { type: "group", id: "pos", x: 100, y: 180, children: [{ type: "rectangle", id: "p1", x: 60, y: 40, width: 40, height: 40 }] },
    ] });
    const { boxes } = await laidOut(doc);
    expect(boxes.get("n1")).toMatchObject({ x: 20, y: 70 });
    expect(boxes.get("n2")).toMatchObject({ x: 150, y: 50 });
    expect(boxes.get("neg")).toEqual({ x: 20, y: 50, w: 170, h: 60 });
    expect(boxes.get("p1")).toMatchObject({ x: 160, y: 220 });
    expect(boxes.get("pos")).toEqual({ x: 160, y: 220, w: 40, h: 40 });
  });

  it("measures text with the font that draws it", async () => {
    const doc = new Y.Doc();
    put(doc, { type: "frame", children: [
      { type: "text", id: "serif", content: "Heading", fontFamily: "Playfair Display", fontSize: 64, fontWeight: "700" },
      { type: "text", id: "sans", content: "Heading", fontFamily: "Inter", fontSize: 64, fontWeight: "bold" },
    ] });
    const { boxes } = await laidOut(doc);
    expect(boxes.get("serif")!.w).not.toBeCloseTo(boxes.get("sans")!.w, 0);
    expect(engine.fonts.isLoaded({ family: "Playfair Display", weight: 700, italic: false })).toBe(true);
  });
});

describe("automatic check", () => {
  it("finds overflow, clipping, cut-off text, collapse, poor contrast and text without a fill", async () => {
    const doc = new Y.Doc();
    put(doc, {
      type: "frame", width: 300, height: 400, fill: "#ffffff", name: "Page", layout: "vertical",
      children: [
        { type: "rectangle", id: "wide", width: 500, height: 20 },
        { type: "frame", width: 100, height: 50, clip: true, name: "Clipper", children: [
          { type: "rectangle", id: "clipped", width: 150, height: 20 },
        ] },
        { type: "text", id: "cut", content: "Too much text for this tiny fixed box", textGrowth: "fixed-width-height", width: 120, height: 20, fill: "#000000" },
        { type: "frame", id: "empty", children: [{ type: "rectangle", width: 0, height: 0 }] },
        { type: "text", id: "pale", content: "Pale", fill: "#dddddd" },
        { type: "text", id: "ghost", content: "No fill" },
      ],
    });
    const { tree, boxes, vars } = await laidOut(doc);
    const issues = check(tree, boxes, vars, engine.text);
    const kinds = (id: string) => issues.filter((i) => i.id === id).map((i) => i.kind);
    expect(kinds("wide")).toContain("overflow");
    expect(kinds("clipped")).toContain("clipped");
    expect(kinds("cut")).toContain("text-cut");
    expect(kinds("empty")).toContain("collapsed");
    expect(kinds("pale")).toContain("contrast");
    expect(kinds("ghost")).toContain("invisible-text");
  });

  it("flags hard-coded colours once variables exist", async () => {
    const doc = new Y.Doc();
    store.setVariables(doc, { ink: { type: "color", value: "#111111" }, paper: { type: "color", value: "#ffffff" } });
    put(doc, { type: "frame", fill: "$paper", children: [
      { type: "text", id: "good", content: "ok", fill: "$ink" },
      { type: "text", id: "bad", content: "bad", fill: "#222222" },
    ] });
    const { tree, boxes, vars } = await laidOut(doc);
    const issues = check(tree, boxes, vars, engine.text);
    expect(issues.some((i) => i.id === "bad" && i.kind === "hard-coded-colour")).toBe(true);
    expect(issues.some((i) => i.id === "good")).toBe(false);
  });
});
