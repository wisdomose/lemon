// Pictures (image fills: files beside the .pen, kept in the document by url) and Lucide icons.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { assetLookup, assetsOf, pictureUrl, putAsset } from "../src/doc/assets.js";
import { fileText, picturesOf, readFile } from "../src/doc/file.js";
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
  it("draws a picture fill and a Lucide icon in its fill colour", async () => {
    const { engine } = await setup();
    const doc = new Y.Doc();
    const red = await png([1, 0, 0]);
    const url = await pictureUrl(red);
    putAsset(doc, url, red);
    const page = store.insert(doc, ROOT_ID, { type: "frame", x: 0, y: 0, width: 200, height: 100, layout: "horizontal", fill: "#ffffff" });
    store.insert(doc, page, { type: "rectangle", width: 100, height: 100, fill: { type: "image", url } });
    store.insert(doc, page, { type: "icon", library: "lucide", icon: "minus", width: 100, height: 100, fill: "#0000ff" });
    const tree = store.toTree(doc);
    const vars = store.getVars(doc);
    const boxes = layout(tree, vars, engine.text);
    const pic = screenshot(engine.ck, tree, boxes, vars, engine.text, assetLookup(doc), page, 200);
    expect(await pixel(pic.png, 50, 50)).toEqual([255, 0, 0]);
    // "minus" is one line across the middle of Lucide's grid.
    expect(await pixel(pic.png, 150, 50)).toEqual([0, 0, 255]);
    expect(await pixel(pic.png, 150, 20)).toEqual([255, 255, 255]);
  });

  it("draws every shape of an icon from its own start", async () => {
    // Lucide's "x" is two paths, the second starting with a relative move.
    const { engine } = await setup();
    const doc = new Y.Doc();
    const page = store.insert(doc, ROOT_ID, { type: "frame", x: 0, y: 0, width: 96, height: 96, fill: "#ffffff" });
    store.insert(doc, page, { type: "icon", icon: "x", width: 96, height: 96, fill: "#000000" });
    const tree = store.toTree(doc);
    const boxes = layout(tree, {}, engine.text);
    const pic = screenshot(engine.ck, tree, boxes, {}, engine.text, assetLookup(doc), page, 96);
    // Both diagonals cross the four quarter points.
    for (const [x, y] of [[36, 36], [60, 60], [60, 36], [36, 60]]) expect(await pixel(pic.png, x!, y!)).toEqual([0, 0, 0]);
  });

  it("knows Lucide's names", () => {
    expect(hasIcon("arrow-right")).toBe(true);
    expect(hasIcon("circle-check")).toBe(true);
    expect(hasIcon("no-such-icon")).toBe(false);
  });

  it("names a picture by its bytes, stores it once, and saves only pictures in use", async () => {
    const doc = new Y.Doc();
    const [a, b] = [await png([1, 0, 0]), await png([0, 1, 0])];
    const [ua, ub] = [await pictureUrl(a), await pictureUrl(b)];
    expect(ua).toMatch(/^\.\/images\/[0-9a-f]{24}\.png$/);
    putAsset(doc, ua, a);
    putAsset(doc, ua, a);
    putAsset(doc, ub, b);
    expect(assetsOf(doc).size).toBe(2);
    const main = store.insert(doc, ROOT_ID, { type: "frame", reusable: true, children: [{ type: "rectangle" }] });
    const r = store.toTree(doc, main).children[0]!.id;
    // Used only through an instance's change.
    store.insert(doc, ROOT_ID, { type: "ref", ref: main, descendants: { [r]: { fill: { type: "image", url: ua } } } });
    expect(picturesOf(doc)).toEqual([{ url: ua, bytes: a }]);
    // The file names it; reading the file asks for its bytes by that url.
    const asked: string[] = [];
    const back = new Y.Doc();
    readFile(fileText(doc), back, (url) => (asked.push(url), url === ua ? a : undefined));
    expect(asked).toEqual([ua]);
    expect(assetsOf(back).get(ua)).toEqual(a);
  });
});
