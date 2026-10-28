// Drawing and layout as Pen does them, checked against Pen itself (Pen 2.21 on Windows, 27 Oct 2026):
// the same .pen opened in both and compared side by side. Each case here is one thing Pen was seen doing.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { PenNode } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";
import { assetLookup } from "../src/doc/assets.js";
import { facesUsed, layout } from "../src/layout/layout.js";
import { screenshot } from "../src/render/screenshot.js";
import { put, setup } from "./helpers.js";

/** Lays out and draws one white 100 × 100 frame holding `children`; the colour at (x, y), 0–255, at 1:1. */
async function drawn(children: PenNode[]) {
  const { engine } = await setup();
  const doc = new Y.Doc();
  put(doc, { type: "frame", id: "f", x: 0, y: 0, width: 100, height: 100, layout: "none", fill: "#ffffff", children });
  const tree = store.toTree(doc);
  const vars = store.getVars(doc);
  await engine.fonts.ensure(facesUsed(tree, vars));
  const boxes = layout(tree, vars, engine.text);
  const pic = screenshot(engine.ck, tree, boxes, vars, engine.text, assetLookup(doc), "f", 100);
  const { ck } = engine;
  const image = ck.MakeImageFromEncoded(pic.png)!;
  const at = (x: number, y: number) => {
    const px = image.readPixels(x, y, { width: 1, height: 1, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB })!;
    return [...px].slice(0, 3);
  };
  return { at, boxes };
}
const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

describe("drawn as Pen draws it", () => {
  it("a stroke without a width draws nothing; with one it is centred on the edge", async () => {
    const { at } = await drawn([
      { type: "rectangle", x: 10, y: 10, width: 20, height: 20, fill: "#cccccc", stroke: "#ff0000" },
      { type: "rectangle", x: 50, y: 50, width: 40, height: 40, fill: "#cccccc", stroke: "#ff0000", strokeWidth: 10 },
    ]);
    expect(at(10, 20)).toEqual([204, 204, 204]);
    expect(at(47, 70)).toEqual(RED); // outside the box, within half the width
    expect(at(53, 70)).toEqual(RED); // inside, within half the width
    expect(at(57, 70)).toEqual([204, 204, 204]);
  });

  it("the last fill in a list is on top", async () => {
    const { at } = await drawn([{ type: "rectangle", x: 0, y: 0, width: 50, height: 50, fill: ["#ff0000", "#0000ff"] }]);
    expect(at(25, 25)).toEqual(BLUE);
  });

  it("flips mirror a node about its top-left corner, and a turn doesn't reach its siblings", async () => {
    const { at } = await drawn([
      { type: "rectangle", x: 10, y: 10, width: 10, height: 10, fill: "#00ff00", rotation: 45 },
      { type: "rectangle", x: 50, y: 50, width: 30, height: 10, fill: "#ff0000", flipX: true },
      { type: "rectangle", x: 60, y: 70, width: 10, height: 20, fill: "#0000ff", flipY: true },
    ]);
    expect(at(35, 55)).toEqual(RED); // mirrored to the left of x = 50
    expect(at(78, 55)).toEqual(WHITE);
    expect(at(65, 60)).toEqual(BLUE); // mirrored above y = 70
    expect(at(65, 80)).toEqual(WHITE);
  });

  it("a polygon without a count draws nothing", async () => {
    const { at } = await drawn([
      { type: "polygon", x: 0, y: 0, width: 50, height: 50, fill: "#ff0000" },
      { type: "polygon", x: 50, y: 50, width: 50, height: 50, fill: "#0000ff", polygonCount: 4 },
    ]);
    expect(at(25, 30)).toEqual(WHITE);
    expect(at(75, 75)).toEqual(BLUE);
  });

  it("a line runs from its box's top-left corner to its bottom-right", async () => {
    const { at } = await drawn([{ type: "line", x: 10, y: 10, width: 80, height: 80, stroke: "#ff0000", strokeWidth: 4 }]);
    expect(at(50, 50)).toEqual(RED);
    expect(at(80, 20)).toEqual(WHITE);
  });

  it("draws Material Symbols and Phosphor icons from their fonts", async () => {
    const { at } = await drawn([
      { type: "icon", x: 0, y: 0, width: 50, height: 50, library: "Material Symbols Sharp", icon: "square", fill: "#ff0000", weight: 700 },
      { type: "icon", x: 50, y: 50, width: 50, height: 50, library: "phosphor", icon: "square", fill: "#0000ff", weight: 700 },
    ]);
    // Both "square" icons are outlines: their edges are in the icon's colour, their middles empty.
    const across = (y: number, from: number) => [...Array(25).keys()].map((i) => at(from + i, y));
    expect(across(25, 0).some((c) => c[0]! > 200 && c[2]! < 60)).toBe(true);
    expect(across(75, 50).some((c) => c[2]! > 200 && c[0]! < 60)).toBe(true);
    expect(at(25, 25)).toEqual(WHITE);
    expect(at(75, 75)).toEqual(WHITE);
  });
});

describe("laid out as Pen lays it out", () => {
  it("a note is at least 250 wide and 219 high, whatever the file says", async () => {
    const { boxes } = await drawn([
      { type: "note", id: "n", x: 0, y: 0, width: 110, height: 90, content: "Small" },
      { type: "note", id: "m", x: 0, y: 0, width: 400, height: 300, content: "Big" },
    ]);
    expect(boxes.get("n")).toMatchObject({ w: 250, h: 219 });
    expect(boxes.get("m")).toMatchObject({ w: 400, h: 219 });
  });
});
