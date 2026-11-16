// Generate("ai", …): a script marks the node's fill with a pending url, the picture is made after the
// script returns, and lands in place of the pending url (or, when it can't be made, the fill goes).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { assetsOf } from "../src/doc/assets.js";
import * as store from "../src/doc/store.js";
import { ROOT_ID } from "../src/doc/schema.js";
import { isPendingImage, landPicture, makePictures, pictureSize, requestPicture } from "../src/agent/image-gen.js";
import { setImagesReady } from "../src/agent/script-api.js";
import { run } from "./helpers.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const fillOf = (doc: Y.Doc, id: string) => store.propsOf(doc, id)?.fill as { type: string; url: string; mode?: string };

afterEach(() => {
  setImagesReady(false);
  vi.unstubAllGlobals();
});

describe("Generate", () => {
  it("refuses when no image model is set up", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `const id = Insert(document, { type: "rectangle", width: 400, height: 300 }); Generate("ai", id, "a fern")`);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Settings → Images/);
  });

  it("only knows the ai type", async () => {
    setImagesReady(true);
    const r = await run(new Y.Doc(), `const id = Insert(document, { type: "rectangle", width: 400, height: 300 }); Generate("stock", id, "fern")`);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/only Generate\("ai"/);
  });

  it("marks the fill pending and reports the picture to make, at the node's size", async () => {
    setImagesReady(true);
    const doc = new Y.Doc();
    const r = await run(doc, `heroId = Insert(document, { type: "rectangle", name: "Hero", width: 1200, height: 600 }); Generate("ai", heroId, "  a fern frond, macro  ")`);
    expect(r.ok).toBe(true);
    const id = r.created[0]!.id;
    const fill = fillOf(doc, id);
    expect(fill.type).toBe("image");
    expect(isPendingImage(fill.url)).toBe(true);
    expect(r.generations).toEqual([{ url: fill.url, prompt: "a fern frond, macro", width: 1200, height: 600 }]);
  });

  it("leaves nothing pending when the script fails", async () => {
    setImagesReady(true);
    const doc = new Y.Doc();
    const r = await run(doc, `const id = Insert(document, { type: "rectangle", width: 100, height: 100 }); Generate("ai", id, "a fern"); throw new Error("no")`);
    expect(r.ok).toBe(false);
    expect(r.generations).toBeUndefined();
    expect([...store.nodesOf(doc).keys()]).toEqual([]);
  });
});

describe("landing a picture", () => {
  it("swaps the pending url for the picture's own, and carries the picture", async () => {
    const doc = new Y.Doc();
    const pending = "lemon:pending-image-1";
    const id = store.insert(doc, ROOT_ID, { type: "rectangle", width: 10, height: 10, fill: ["#ffffff", { type: "image", url: pending, mode: "cover" }] } as never);
    expect(await landPicture(doc, pending, PNG, "test")).toBe(true);
    const fill = store.propsOf(doc, id)?.fill as [string, { url: string; mode: string }];
    expect(fill[0]).toBe("#ffffff");
    expect(fill[1].url).toMatch(/^\.\/images\/[0-9a-f]{24}\.png$/);
    expect(fill[1].mode).toBe("cover");
    expect(assetsOf(doc).get(fill[1].url)).toEqual(PNG);
  });

  it("takes the image fill off when the picture couldn't be made", async () => {
    const doc = new Y.Doc();
    const pending = "lemon:pending-image-2";
    const id = store.insert(doc, ROOT_ID, { type: "rectangle", width: 10, height: 10, fill: { type: "image", url: pending } } as never);
    await landPicture(doc, pending, undefined, "test");
    expect(store.propsOf(doc, id)?.fill).toBeUndefined();
  });

  it("asks the model at the node's shape and lands its answer", async () => {
    setImagesReady(true);
    const doc = new Y.Doc();
    const r = await run(doc, `id = Insert(document, { type: "rectangle", width: 900, height: 300 }); Generate("ai", id, "a fern")`);
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG).toString("base64") }] }), { status: 200 });
    });
    await makePictures(doc, r.generations!, "test", () => ({ baseUrl: "https://img.example/v1/", apiKey: "k" }), () => {});
    expect(calls[0]!.url).toBe("https://img.example/v1/images/generations");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ prompt: "a fern", size: "768x256" });
    expect(fillOf(doc, r.created[0]!.id).url).toMatch(/^\.\/images\//);
  });

  it("reports the server's error", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Missing or wrong API key" } }), { status: 401 }));
    await expect(requestPicture({ baseUrl: "https://img.example", apiKey: "x" }, { prompt: "p", width: 1, height: 1 })).rejects.toThrow("Missing or wrong API key");
  });
});

describe("pictureSize", () => {
  it("keeps the node's shape in steps of 64, longest side 768", () => {
    expect(pictureSize(1440, 800)).toEqual({ width: 768, height: 448 });
    expect(pictureSize(300, 600)).toEqual({ width: 384, height: 768 });
    expect(pictureSize(500, 500)).toEqual({ width: 768, height: 768 });
    expect(pictureSize(3000, 100)).toEqual({ width: 768, height: 256 });
  });
});
