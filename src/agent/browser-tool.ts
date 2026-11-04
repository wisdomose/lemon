// The agent's `browser` tool, as Pen's: it drives the integrated browser (the sidebar beside the canvas)
// or the live page of a browser node — loads an address, reads a page back (a screenshot, or an
// element's DOM and styles), acts inside it through the Chrome DevTools Protocol, and copies a
// screenshot onto the canvas. Its replies are worded as Pen's. The pages themselves live in the main
// process (main/browser-pages.ts).
import type * as Y from "yjs";
import { z } from "zod";
import type { Engine } from "../engine.js";
import { assetsOf, putAsset } from "../doc/assets.js";
import { ROOT_ID } from "../doc/schema.js";
import * as store from "../doc/store.js";
import { ScriptSession } from "./script-api.js";
import type { PenNode } from "../doc/schema.js";

/** A page (or element) ready to put on the canvas as layers, with the pictures it uses. */
export interface Importable {
  node: PenNode;
  /** Pictures fetched from the page, by the url the node's image fills now use. */
  pictures: { url: string; bytes: Uint8Array }[];
}

/** A picture of a page (or of an element on it), at its size on the page. */
export interface PageShot {
  png: Uint8Array;
  jpeg: Uint8Array;
  width: number;
  height: number;
  title: string;
  url: string;
}

/** The integrated browser's page, where a call without a nodeId goes. */
export const SIDEBAR = "sidebar";
/** The element the person picked in the sidebar's page (the picker marks it). */
export const PICKED = "[data-lemon-pick]";

/** What the tool needs from the pages: the browser nodes' (by id) and the sidebar's (SIDEBAR). */
export interface PageDriver {
  /** Whether the document has a browser node with this id. */
  isNode(id: string): boolean;
  /** Whether the person has picked an element in this page (only the sidebar has a picker). */
  picked(id: string): boolean;
  /** For the agent's first message: the sidebar's state and the browser nodes. */
  summary(): string;
  load(id: string, url: string): Promise<{ url: string; title: string }>;
  capture(id: string, selector?: string): Promise<PageShot>;
  element(id: string, selector?: string): Promise<string>;
  cdp(id: string, method: string, params?: Record<string, unknown>): Promise<{ result: unknown; page: string }>;
  /** The page, or the element `selector` matches, as .pen layers (see import-page.ts). */
  importable(id: string, selector?: string): Promise<Importable>;
}

/** The CDP domains the tool may use (as in Pen). */
const DOMAINS = ["DOM", "Input", "Page", "Runtime", "Emulation", "CSS", "Accessibility"];
/** Room left between the canvas's content and a screenshot put beside it (as in Pen). */
const SHOT_GAP = 40;

export const BROWSER_DESCRIPTION = `Use a real web page loaded in the app: the integrated browser (a sidebar beside the canvas) or a browser node on the canvas. Load an address, read the page back, act inside it, or copy a screenshot of it onto the canvas.

Use it to see a live site for yourself: one the person names or links (to learn what it is before designing for it), a site to take inspiration from, or sources to research.

Actions:
- "load-page": load "url" (http, https or file) in the target browser (opening the sidebar if it is closed and no "nodeId" is given; a browser node's address changes to it). Returns when the page has loaded or failed to.
- "return-screenshot": a screenshot of the target, for you to look at.
- "return-element": the target element's DOM and computed styles as text.
- "cdp": one Chrome DevTools Protocol command ("method" and "params") sent to the page; its result comes back as JSON. A command that starts a navigation (a click on a link, say) returns once the page has loaded. Only the DOM, Input, Page, Runtime, Emulation, CSS and Accessibility domains are available.
- "import-to-canvas": reproduce the target as editable layers on the canvas (frames with their layout, text, images, icons as paths). Returns the imported frame's id for execute. Each node's "context" holds the element it came from.
- "screenshot-to-canvas": put a screenshot of the target on the canvas, as an image beside what is there.

"nodeId" is the id of a browser node to drive (type "browser"; make one with execute: Insert(parent, {type: "browser", name, url, width, height})); leave it out to drive the sidebar's page. "target" is "full-page" (the page as it shows; the default), "selection" (the element the person picked in the sidebar with its element picker) or "query" (the element "querySelector" matches; it is scrolled into view).

Prefer a focused "query" over the whole page: an element's DOM can be very large, so read a section ("header", ".pricing") rather than "body", or look with "return-screenshot". To read text and data, Runtime.evaluate with returnByValue: true and an expression that returns just what you need is usually best. To click, find the element with DOM.querySelector and DOM.getBoxModel (or getBoundingClientRect in Runtime.evaluate) and send Input.dispatchMouseEvent at its centre; type with Input.insertText. Check the result with "return-screenshot".`;

export const browserSchema = z.object({
  action: z.enum(["load-page", "import-to-canvas", "screenshot-to-canvas", "return-element", "return-screenshot", "cdp"]).describe("What to do."),
  nodeId: z.string().optional().describe("The id of a browser node to drive. Leave out to drive the integrated browser (the sidebar)."),
  target: z.enum(["full-page", "selection", "query"]).optional().describe('What to act on (default "full-page"): "selection" is the element the person picked in the sidebar.'),
  querySelector: z.string().optional().describe('A CSS selector run in the page. Required when target is "query".'),
  url: z.string().optional().describe('An http(s) or file URL. Required (and only used) when action is "load-page".'),
  method: z.string().optional().describe('A CDP method, e.g. "Input.dispatchMouseEvent". Required (and only used) when action is "cdp".'),
  params: z.record(z.string(), z.unknown()).optional().describe('The CDP command\'s parameters, e.g. {"expression": "document.title", "returnByValue": true}. Used when action is "cdp".'),
});
export type BrowserInput = z.infer<typeof browserSchema>;

export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface BrowserResult {
  ok: boolean;
  content: ToolContent[];
  /** Pictures for the step's card in the chat. */
  pictures: { id: string; png: Uint8Array; width: number; height: number }[];
  /** A node it added to the canvas. */
  created?: string;
}

export interface BrowserContext {
  pages: PageDriver;
  doc: Y.Doc;
  engine: Engine;
  /** The origin of the canvas changes it makes (the agent's step). */
  origin: unknown;
}

const text = (t: string): ToolContent => ({ type: "text", text: t });
const image = (bytes: Uint8Array, mimeType: string): ToolContent => ({ type: "image", data: Buffer.from(bytes).toString("base64"), mimeType });

/** JSON with every object's keys in order, as Pen writes a CDP result. */
export function sortedJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

/** Runs one call of the tool; a problem comes back as an error result, never as a throw. */
export async function runBrowser(input: BrowserInput, ctx: BrowserContext): Promise<BrowserResult> {
  try {
    return await act(input, ctx);
  } catch (e) {
    return { ok: false, content: [text(e instanceof Error ? e.message : String(e))], pictures: [] };
  }
}

async function act(input: BrowserInput, ctx: BrowserContext): Promise<BrowserResult> {
  const { pages } = ctx;
  if (input.nodeId !== undefined && !pages.isNode(input.nodeId)) {
    throw new Error(`No browser node with id "${input.nodeId}" in this document. Omit "id" to drive the browser sidebar instead.`);
  }
  const id = input.nodeId ?? SIDEBAR;
  const where = input.nodeId === undefined ? "the integrated browser" : `browser node "${id}"`;
  const query = input.target === "query";
  if (query && !input.querySelector) throw new Error('target "query" needs a querySelector.');
  if (input.target === "selection" && !pages.picked(id)) {
    throw new Error("No element is selected in the browser. Ask the user to pick one with the element picker, or use target 'query' with a CSS selector.");
  }
  const selector = query ? input.querySelector : input.target === "selection" ? PICKED : undefined;
  const what = query ? `the element matching \`${selector}\`` : input.target === "selection" ? "the selected element" : "the full page";
  switch (input.action) {
    case "load-page": {
      if (!input.url?.trim()) throw new Error('"load-page" needs a url.');
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input.url.trim())?.[1]?.toLowerCase();
      if (scheme && !["http", "https", "file"].includes(scheme)) throw new Error(`Only http(s) and file URLs can be loaded, not "${scheme}:".`);
      const r = await pages.load(id, input.url);
      return { ok: true, content: [text(`Loaded ${r.url} ("${r.title}") in ${where}.`)], pictures: [] };
    }
    case "return-screenshot": {
      const shot = await pages.capture(id, selector);
      const label = `Screenshot of ${what} (1 image).`;
      return { ok: true, content: [text(label), image(shot.jpeg, "image/jpeg")], pictures: [{ id, png: shot.png, width: shot.width, height: shot.height }] };
    }
    case "return-element":
      return { ok: true, content: [text(await pages.element(id, selector))], pictures: [] };
    case "cdp": {
      if (!input.method) throw new Error('"cdp" needs a method.');
      const domain = input.method.split(".")[0]!;
      if (!DOMAINS.includes(domain)) throw new Error(`The ${domain} CDP domain is not available to the browser tool. Available: ${DOMAINS.join(", ")}.`);
      const { result, page } = await pages.cdp(id, input.method, input.params);
      const data = input.method === "Page.captureScreenshot" ? (result as { data?: string }).data : undefined;
      if (data) {
        const format = input.params?.format === "jpeg" || input.params?.format === "webp" ? input.params.format : "png";
        return { ok: true, content: [text(`Page.captureScreenshot returned a screenshot. Page: ${page}`), { type: "image", data, mimeType: `image/${format}` }], pictures: [] };
      }
      return { ok: true, content: [text(`${sortedJson(result ?? {})}\nPage: ${page}`)], pictures: [] };
    }
    case "import-to-canvas": {
      const imported = await pages.importable(id, selector);
      const node = importToCanvas(ctx, imported);
      return {
        ok: true,
        content: [text(`Imported ${what} onto the canvas as editable layers. The imported frame's id is "${node}".`)],
        pictures: [],
        created: node,
      };
    }
    case "screenshot-to-canvas": {
      const shot = await pages.capture(id, selector);
      const node = toCanvas(ctx, shot);
      return { ok: true, content: [text(`Added a screenshot of ${what} to the canvas.`)], pictures: [{ id: node, png: shot.png, width: shot.width, height: shot.height }], created: node };
    }
  }
}

/** Puts imported layers on the canvas beside what is there (40 apart, as Pen does), with their pictures. */
function importToCanvas(ctx: BrowserContext, imported: Importable): string {
  const { doc } = ctx;
  const node = imported.node as PenNode & { width?: unknown; height?: unknown };
  let at = { x: 0, y: 0 };
  try {
    at = new ScriptSession(doc, ctx.engine).findEmptySpace({ width: Number(node.width) || 0, height: Number(node.height) || 0, padding: SHOT_GAP });
  } catch {}
  let id = "";
  doc.transact(() => {
    for (const p of imported.pictures) putAsset(doc, p.url, new Uint8Array(p.bytes));
    id = store.insert(doc, ROOT_ID, { ...node, x: at.x, y: at.y } as PenNode);
  }, ctx.origin);
  return id;
}

/**
 * Puts a screenshot on the canvas as Pen does: a rectangle named after the page's title, at the
 * picture's size on the page, beside what is there, filled white under the picture. The picture is
 * kept beside the file as images/screenshot-<host>.png (then -1, -2… for later ones).
 */
function toCanvas(ctx: BrowserContext, shot: PageShot): string {
  const { doc } = ctx;
  let host = "page";
  try {
    host = new URL(shot.url).hostname || host;
  } catch {}
  const taken = assetsOf(doc);
  let url = `images/screenshot-${host}.png`;
  for (let n = 1; taken.has(url); n++) url = `images/screenshot-${host}-${n}.png`;
  let at = { x: 0, y: 0 };
  try {
    at = new ScriptSession(doc, ctx.engine).findEmptySpace({ width: shot.width, height: shot.height, padding: SHOT_GAP });
  } catch {
    // The layout needs fonts that haven't loaded: the screenshot goes at the origin.
  }
  let id = "";
  doc.transact(() => {
    // A plain Uint8Array: the document refuses a Node Buffer ("Unexpected content type"), which is what Electron gives.
    putAsset(doc, url, new Uint8Array(shot.png));
    id = store.insert(doc, ROOT_ID, {
      type: "rectangle",
      name: shot.title || host,
      x: at.x,
      y: at.y,
      width: shot.width,
      height: shot.height,
      fill: ["#ffffff", { type: "image", enabled: true, url, mode: "cover" }],
    } as never);
  }, ctx.origin);
  return id;
}
