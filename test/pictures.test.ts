// Pictures (image fills: files beside the .pen, kept in the document by url) and Lucide icons.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { PICTURES_SAVED, assetLookup, assetsOf, hasPicture, pictureUrl, putAsset, releaseAssets, setPictureReader } from "../src/doc/assets.js";
import { picture } from "../src/render/draw.js";
import { shrunk, sizeFor } from "../src/renderer/picture-sizes.js";
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
    // The file names it; reading the file only looks for it by that url, and reads it when it is drawn.
    const looked: string[] = [];
    const read: string[] = [];
    const back = new Y.Doc();
    const report = readFile(fileText(doc), back, { has: (url) => (looked.push(url), url === ua), read: (url) => (read.push(url), url === ua ? a : undefined) });
    expect(report.missingPictures).toEqual([]);
    expect(looked).toEqual([ua]);
    expect(read).toEqual([]);
    expect(assetsOf(back).size).toBe(0);
    expect(assetLookup(back)(ua)).toEqual(a);
    expect(read).toEqual([ua]);
  });

  it("keeps a picture at the smallest size that covers how big it shows, never bigger than itself", () => {
    expect(sizeFor(40, 4000)).toBe(128);
    expect(sizeFor(129, 4000)).toBe(512);
    expect(sizeFor(1500, 4000)).toBe(2048);
    expect(sizeFor(9000, 6000)).toBe(4096);
    // A small picture is kept as it is; one not read yet is asked for at the size it shows.
    expect(sizeFor(1500, 300)).toBe(300);
    expect(sizeFor(600, 0)).toBe(2048);
    expect(shrunk(4000, 3000, 512)).toEqual({ width: 512, height: 384 });
    expect(shrunk(300, 200, 512)).toEqual({ width: 300, height: 200 });
  });

  it("lets go of a saved picture, and still finds it", async () => {
    const doc = new Y.Doc();
    const a = await png([1, 0, 0]);
    const url = await pictureUrl(a);
    const disk = new Map<string, Uint8Array>();
    setPictureReader(doc, { read: (u) => disk.get(u), has: (u) => disk.has(u) });
    putAsset(doc, url, a);
    store.insert(doc, ROOT_ID, { type: "rectangle", fill: { type: "image", url } });
    expect(hasPicture(doc, url)).toBe(true);
    // Saved: written beside the file, then no longer carried.
    for (const p of picturesOf(doc)) disk.set(p.url, p.bytes);
    const origins: unknown[] = [];
    doc.on("update", (_u: Uint8Array, origin: unknown) => origins.push(origin));
    releaseAssets(doc, [url]);
    expect(origins).toEqual([PICTURES_SAVED]);
    expect(assetsOf(doc).size).toBe(0);
    expect(picturesOf(doc)).toEqual([]);
    expect(assetLookup(doc)(url)).toEqual(a);
    expect(hasPicture(doc, url)).toBe(true);
  });

  it("draws a big picture from a small copy where it shows small, and from all of it where it shows big", async () => {
    const { engine } = await setup();
    const { ck } = engine;
    const surface = ck.MakeSurface(2000, 1000)!;
    surface.getCanvas().clear(ck.Color4f(0, 0, 1, 1));
    const snap = surface.makeImageSnapshot();
    const big = snap.encodeToBytes()!.slice();
    snap.delete();
    surface.delete();
    const url = "./images/big-for-sizes.png";
    const small = picture(ck, () => big, url, 100)!;
    expect([small.width, small.height]).toEqual([2000, 1000]);
    expect([small.image.width(), small.image.height()]).toEqual([512, 256]);
    const whole = picture(ck, () => big, url, 1500)!;
    expect([whole.image.width(), whole.image.height()]).toEqual([2000, 1000]);
    // Small again: the copy it kept.
    expect(picture(ck, () => undefined, url, 100)!.image.width()).toBe(512);
  });
});
