// Pictures (image fills, stored once per document) and Lucide icons.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { assetId, assetLookup, assetsOf, putAsset } from "../src/doc/assets.js";
import { fileText, fromBase64, readFile, toBase64 } from "../src/doc/file.js";
import { ROOT_ID } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";
import { layout } from "../src/layout/layout.js";
import { hasIcon } from "../src/render/icons.js";
import { screenshot } from "../src/render/screenshot.js";
import { setup } from "./helpers.js";

/** A small PNG of one colour. */
async function png(colour: [number, number, number]) {
  const { engine } = await setup();
  const { ck } = engine;
  const surface = ck.MakeSurface(4, 4)!;
  surface.getCanvas().clear(ck.Color4f(colour[0], colour[1], colour[2], 1));
  const image = surface.makeImageSnapshot();
  const bytes = image.encodeToBytes()!;
  image.delete();
  surface.delete();
  return bytes;
}

/** The colour at (x, y) of a PNG, 0–255. */
async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { engine } = await setup();
  const { ck } = engine;
  const image = ck.MakeImageFromEncoded(bytes)!;
  const px = image.readPixels(x, y, { width: 1, height: 1, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB })!;
  image.delete();
  return [...px].slice(0, 3);
}

describe("pictures and icons", () => {
  it("draws a picture fill and a Lucide icon", async () => {
    const { engine } = await setup();
    const doc = new Y.Doc();
    const red = await png([1, 0, 0]);
    const id = await assetId(red);
    putAsset(doc, id, red);
    const page = store.insert(doc, ROOT_ID, { type: "frame", x: 0, y: 0, width: 200, height: 100, layout: "row", fill: "#ffffff" });
    store.insert(doc, page, { type: "rect", width: 100, height: 100, fill: { type: "image", asset: id } });
    store.insert(doc, page, { type: "icon", icon: "minus", width: 100, height: 100, color: "#0000ff" });
    const tree = store.toTree(doc);
    const vars = store.getVars(doc);
    const boxes = layout(tree, vars, engine.text);
    const pic = screenshot(engine.ck, tree, boxes, vars, engine.text, assetLookup(doc), page, 200);
    expect(await pixel(pic.png, 50, 50)).toEqual([255, 0, 0]);
    // "minus" is one line across the middle of Lucide's grid.
    expect(await pixel(pic.png, 150, 50)).toEqual([0, 0, 255]);
    expect(await pixel(pic.png, 150, 20)).toEqual([255, 255, 255]);
  });

  it("knows Lucide's names", () => {
    expect(hasIcon("arrow-right")).toBe(true);
    expect(hasIcon("circle-check")).toBe(true);
    expect(hasIcon("no-such-icon")).toBe(false);
  });

  it("stores a picture once and saves only pictures in use", async () => {
    const doc = new Y.Doc();
    const [a, b] = [await png([1, 0, 0]), await png([0, 1, 0])];
    const [ia, ib] = [await assetId(a), await assetId(b)];
    putAsset(doc, ia, a);
    putAsset(doc, ia, a);
    putAsset(doc, ib, b);
    expect(assetsOf(doc).size).toBe(2);
    const main = store.insert(doc, ROOT_ID, { type: "frame", component: true, children: [{ type: "rect", ref: "r" }] });
    const r = store.toTree(doc, main).children[0]!.id;
    // Used only through a copy's change.
    store.insert(doc, ROOT_ID, { type: "instance", of: main, overrides: { [r]: { fill: { type: "image", asset: ia } } } });
    const text = fileText(doc);
    expect(Object.keys(JSON.parse(text).assets)).toEqual([ia]);
    const back = new Y.Doc();
    readFile(text, back);
    expect(assetsOf(back).get(ia)).toEqual(a);
  });

  it("base64 round-trips any length", () => {
    for (let n = 0; n < 12; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 73 + n) & 255);
      expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    }
    expect(toBase64(new TextEncoder().encode("Lemon"))).toBe("TGVtb24=");
  });
});
