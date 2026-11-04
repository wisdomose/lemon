// The agent's browser tool answers as Pen's does (wording checked against Pen's own tool, 2 Nov 2026),
// and puts screenshots on the canvas where and as Pen does.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { runBrowser, sortedJson, type PageDriver, type PageShot } from "../src/agent/browser-tool.js";
import { assetsOf } from "../src/doc/assets.js";
import { toTree } from "../src/doc/store.js";
import { put, setup } from "./helpers.js";

const shot = (over: Partial<PageShot> = {}): PageShot => ({
  png: new Uint8Array([0x89, 0x50, 1]),
  jpeg: new Uint8Array([0xff, 0xd8, 1]),
  width: 900,
  height: 800,
  title: "Chart buddy",
  url: "https://chat-buddy.xyz/chart",
  ...over,
});

function driver(over: Partial<PageDriver> = {}): PageDriver & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    isNode: (id) => id !== "nope1",
    picked: () => false,
    importable: async () => ({ node: { type: "frame", name: "header" } as never, pictures: [] }),
    summary: () => "",
    load: async (...a) => (calls.push(["load", ...a]), { url: "https://chat-buddy.xyz/chart", title: "Chart buddy" }),
    capture: async (...a) => (calls.push(["capture", ...a]), a[1] ? shot({ width: 900, height: 44 }) : shot()),
    element: async (...a) => (calls.push(["element", ...a]), "DOM Path: body > header"),
    cdp: async (...a) => (calls.push(["cdp", ...a]), { result: { result: { value: { b: 1, a: 2 }, type: "object" } }, page: 'https://chat-buddy.xyz/chart ("Chart buddy")' }),
    ...over,
  };
}

const textOf = (r: Awaited<ReturnType<typeof runBrowser>>) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

async function ctx(pages: PageDriver, doc = new Y.Doc()) {
  return { pages, doc, engine: (await setup()).engine, origin: "test" };
}

describe("the browser tool", () => {
  it("reports a loaded page as Pen does", async () => {
    const pages = driver();
    const r = await runBrowser({ action: "load-page", nodeId: "M4Ot8Q", url: "https://chat-buddy.xyz" }, await ctx(pages));
    expect(r.ok).toBe(true);
    expect(textOf(r)).toBe('Loaded https://chat-buddy.xyz/chart ("Chart buddy") in browser node "M4Ot8Q".');
    expect(pages.calls).toEqual([["load", "M4Ot8Q", "https://chat-buddy.xyz"]]);
  });

  it("loads into the integrated browser without a nodeId, as Pen words it", async () => {
    const pages = driver();
    const r = await runBrowser({ action: "load-page", url: "https://chat-buddy.xyz" }, await ctx(pages));
    expect(textOf(r)).toBe('Loaded https://chat-buddy.xyz/chart ("Chart buddy") in the integrated browser.');
    expect(pages.calls).toEqual([["load", "sidebar", "https://chat-buddy.xyz"]]);
  });

  it("names a missing browser node as Pen does", async () => {
    const r = await runBrowser({ action: "return-screenshot", nodeId: "nope1" }, await ctx(driver()));
    expect(r.ok).toBe(false);
    expect(textOf(r)).toBe('No browser node with id "nope1" in this document. Omit "id" to drive the browser sidebar instead.');
  });

  it("returns Page.captureScreenshot as an image with Pen's line", async () => {
    const pages = driver({ cdp: async () => ({ result: { data: "cG5n" }, page: 'https://chat-buddy.xyz/chart ("Chart buddy")' }) });
    const r = await runBrowser({ action: "cdp", method: "Page.captureScreenshot", params: { format: "png" } }, await ctx(pages));
    expect(textOf(r)).toBe('Page.captureScreenshot returned a screenshot. Page: https://chat-buddy.xyz/chart ("Chart buddy")');
    expect(r.content[1]).toEqual({ type: "image", data: "cG5n", mimeType: "image/png" });
  });

  it("refuses addresses that aren't http(s) or file", async () => {
    const r = await runBrowser({ action: "load-page", nodeId: "a", url: "javascript:alert(1)" }, await ctx(driver()));
    expect(r.ok).toBe(false);
  });

  it("returns screenshots with Pen's wording", async () => {
    const c = await ctx(driver());
    const full = await runBrowser({ action: "return-screenshot", nodeId: "a" }, c);
    expect(textOf(full)).toBe("Screenshot of the full page (1 image).");
    expect(full.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    const part = await runBrowser({ action: "return-screenshot", nodeId: "a", target: "query", querySelector: "header" }, c);
    expect(textOf(part)).toBe("Screenshot of the element matching `header` (1 image).");
  });

  it("needs a selector for a query", async () => {
    const r = await runBrowser({ action: "return-element", nodeId: "a", target: "query" }, await ctx(driver()));
    expect(r.ok).toBe(false);
  });

  it("returns a CDP result as sorted JSON with the page, and keeps to Pen's domains", async () => {
    const c = await ctx(driver());
    const r = await runBrowser({ action: "cdp", nodeId: "a", method: "Runtime.evaluate", params: { expression: "1" } }, c);
    expect(textOf(r)).toBe('{"result":{"type":"object","value":{"a":2,"b":1}}}\nPage: https://chat-buddy.xyz/chart ("Chart buddy")');
    const refused = await runBrowser({ action: "cdp", nodeId: "a", method: "Network.enable" }, c);
    expect(refused.ok).toBe(false);
    expect(textOf(refused)).toBe("The Network CDP domain is not available to the browser tool. Available: DOM, Input, Page, Runtime, Emulation, CSS, Accessibility.");
  });

  it("passes a page's errors back as the result", async () => {
    const pages = driver({ capture: async () => { throw new Error('No element matched the CSS selector ".nope".'); } });
    const r = await runBrowser({ action: "return-screenshot", nodeId: "a", target: "query", querySelector: ".nope" }, await ctx(pages));
    expect(r).toMatchObject({ ok: false });
    expect(textOf(r)).toBe('No element matched the CSS selector ".nope".');
  });

  it("puts screenshots on the canvas as Pen does: beside what's there, named after the page", async () => {
    const doc = new Y.Doc();
    put(doc, { id: "board", type: "frame", name: "Board", x: 0, y: 0, width: 1796, height: 1378 } as never);
    const c = await ctx(driver(), doc);
    const first = await runBrowser({ action: "screenshot-to-canvas", nodeId: "a", target: "query", querySelector: "header" }, c);
    expect(textOf(first)).toBe("Added a screenshot of the element matching `header` to the canvas.");
    const second = await runBrowser({ action: "screenshot-to-canvas", nodeId: "a" }, c);
    expect(textOf(second)).toBe("Added a screenshot of the full page to the canvas.");
    const [, a, b] = toTree(doc).children;
    expect(a!.props).toMatchObject({
      name: "Chart buddy", x: 1836, y: 0, width: 900, height: 44,
      fill: ["#ffffff", { type: "image", enabled: true, url: "images/screenshot-chat-buddy.xyz.png", mode: "cover" }],
    });
    expect(b!.props).toMatchObject({ x: 2776, y: 0, width: 900, height: 800 });
    expect((b!.props.fill as unknown[])[1]).toMatchObject({ url: "images/screenshot-chat-buddy.xyz-1.png" });
    expect([...assetsOf(doc).keys()].sort()).toEqual(["images/screenshot-chat-buddy.xyz-1.png", "images/screenshot-chat-buddy.xyz.png"]);
  });

  it("stores a screenshot given as a Node Buffer (as Electron gives it)", async () => {
    const doc = new Y.Doc();
    const c = await ctx(driver({ capture: async () => shot({ png: Buffer.from([0x89, 0x50, 7]) }) }), doc);
    const r = await runBrowser({ action: "screenshot-to-canvas", nodeId: "a" }, c);
    expect(r.ok).toBe(true);
    expect(assetsOf(doc).get("images/screenshot-chat-buddy.xyz.png")).toEqual(new Uint8Array([0x89, 0x50, 7]));
  });

  it("sorts keys at every depth", () => {
    expect(sortedJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });
});
