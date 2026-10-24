import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ROOT_ID } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";
import { layout, facesUsed } from "../src/layout/layout.js";
import { check } from "../src/layout/check.js";
import { setup } from "./helpers.js";
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
  it("stacks a column with padding and gap, and hugs its content", async () => {
    const doc = new Y.Doc();
    const refs: Record<string, string> = {};
    const f = store.insert(doc, ROOT_ID, {
      type: "frame", x: 100, y: 50, padding: 20, gap: 10,
      children: [
        { type: "rect", width: 200, height: 40, ref: "a" },
        { type: "rect", width: 120, height: 30, ref: "b" },
      ],
    }, undefined, refs);
    const { boxes } = await laidOut(doc);
    expect(boxes.get(f)).toEqual({ x: 100, y: 50, w: 240, h: 120 });
    expect(boxes.get(refs.b!)).toEqual({ x: 120, y: 120, w: 120, h: 30 });
  });

  it("shares a row between fill children and wraps fill-width text", async () => {
    const doc = new Y.Doc();
    const refs: Record<string, string> = {};
    store.insert(doc, ROOT_ID, {
      type: "frame", layout: "row", width: 600, gap: 20,
      children: [
        { type: "rect", width: 100, height: 10 },
        { type: "frame", width: "fill", ref: "left", children: [
          { type: "text", width: "fill", ref: "t", size: 16, text: "A sentence long enough that it must wrap onto several lines in a narrow column of text." },
        ] },
        { type: "frame", width: "fill", ref: "right", height: 10 },
      ],
    }, undefined, refs);
    const { boxes } = await laidOut(doc);
    expect(boxes.get(refs.left!)!.w).toBeCloseTo(230, 5);
    expect(boxes.get(refs.right!)!.x).toBeCloseTo(370, 5);
    const t = boxes.get(refs.t!)!;
    expect(t.w).toBeCloseTo(230, 5);
    expect(t.h).toBeGreaterThan(50); // several lines
  });

  it("measures text with the font that draws it", async () => {
    const doc = new Y.Doc();
    const refs: Record<string, string> = {};
    store.insert(doc, ROOT_ID, { type: "frame", children: [
      { type: "text", text: "Heading", font: "Playfair Display", size: 64, weight: 700, ref: "serif" },
      { type: "text", text: "Heading", font: "Inter", size: 64, weight: 700, ref: "sans" },
    ] }, undefined, refs);
    const { boxes } = await laidOut(doc);
    expect(boxes.get(refs.serif!)!.w).not.toBeCloseTo(boxes.get(refs.sans!)!.w, 0);
    expect(engine.fonts.isLoaded({ family: "Playfair Display", weight: 700, italic: false })).toBe(true);
  });
});

describe("automatic check", () => {
  it("finds overflow, clipping, cut-off text, collapse and poor contrast", async () => {
    const doc = new Y.Doc();
    const refs: Record<string, string> = {};
    store.insert(doc, ROOT_ID, {
      type: "frame", width: 300, height: 400, fill: "#ffffff", name: "Page",
      children: [
        { type: "rect", width: 500, height: 20, ref: "wide" },
        { type: "frame", width: 100, height: 50, clip: true, name: "Clipper", children: [
          { type: "rect", width: 150, height: 20, ref: "clipped" },
        ] },
        { type: "text", text: "Too much text for this tiny fixed box", width: 120, height: 20, ref: "cut" },
        { type: "frame", ref: "empty", children: [{ type: "rect", width: 0, height: 0 }] },
        { type: "text", text: "Pale", color: "#dddddd", ref: "pale" },
      ],
    }, undefined, refs);
    const { tree, boxes, vars } = await laidOut(doc);
    const issues = check(tree, boxes, vars, engine.text);
    const kinds = (id: string) => issues.filter((i) => i.id === id).map((i) => i.kind);
    expect(kinds(refs.wide!)).toContain("overflow");
    expect(kinds(refs.clipped!)).toContain("clipped");
    expect(kinds(refs.cut!)).toContain("text-cut");
    expect(kinds(refs.empty!)).toContain("collapsed");
    expect(kinds(refs.pale!)).toContain("contrast");
  });

  it("flags hard-coded colours once variables exist", async () => {
    const doc = new Y.Doc();
    store.setVars(doc, { ink: "#111111", paper: "#ffffff" });
    const refs: Record<string, string> = {};
    store.insert(doc, ROOT_ID, { type: "frame", fill: "$paper", children: [
      { type: "text", text: "ok", color: "$ink", ref: "good" },
      { type: "text", text: "bad", color: "#222222", ref: "bad" },
    ] }, undefined, refs);
    const { tree, boxes, vars } = await laidOut(doc);
    const issues = check(tree, boxes, vars, engine.text);
    expect(issues.some((i) => i.id === refs.bad && i.kind === "hard-coded-colour")).toBe(true);
    expect(issues.some((i) => i.id === refs.good)).toBe(false);
  });
});
