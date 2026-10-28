// The live pages of a file's browser nodes. Each browser node with an address gets a page rendered off
// screen at the node's size; its frames go to the file's tab, which draws them inside the node on the
// canvas (so labels, outlines and nodes above it stay on top, as in Pen). While the node is being used
// (a double-click in the tab), the tab forwards the pointer, the wheel and the keys here. Following a
// link changes the node's address, as in Pen.
import { BrowserWindow, type WebContents } from "electron";
import * as Y from "yjs";
import * as docStore from "../doc/store.js";

/** What the tab forwards to a page while it is being used. */
export type PageInput =
  | { type: "mouseDown" | "mouseUp" | "mouseMove"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { type: "mouseWheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "keyDown" | "keyUp" | "char"; keyCode: string; modifiers?: string[] };

/** A changed part of a page's picture: BGRA pixels for (x, y, w, h) of a page `width` × `height`. */
export interface PageFrame {
  width: number;
  height: number;
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8Array;
}

/** Frames a second while a page changes. */
const FRAME_RATE = 30;
/** The origin of address changes the pages make in the document (they are not loaded again). */
export const FROM_PAGE = Symbol("browser page");

/** "example.com" → "https://example.com"; addresses with a scheme stay as they are. */
export const loadable = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);

interface Live {
  win: BrowserWindow;
  url: string;
  width: number;
  height: number;
  zoom: number;
}

export class BrowserPages {
  private readonly pages = new Map<string, Live>();

  constructor(
    private readonly doc: Y.Doc,
    /** The tab the frames and cursor changes go to. */
    private readonly tab: () => WebContents | undefined,
  ) {}

  /** Opens, moves, resizes or closes pages to match the document's browser nodes. */
  sync(): void {
    const wanted = new Map<string, { url: string; width: number; height: number; zoom: number }>();
    for (const [id, rec] of docStore.nodesOf(this.doc)) {
      if (rec.get("type") !== "browser" || rec.get("enabled") === false) continue;
      const url = rec.get("url");
      if (typeof url !== "string" || !url.trim()) continue;
      const size = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? Math.round(v) : d);
      const zoom = rec.get("zoom");
      wanted.set(id, { url: url.trim(), width: size(rec.get("width"), 1200), height: size(rec.get("height"), 1200), zoom: typeof zoom === "number" && zoom > 0 ? zoom : 1 });
    }
    for (const [id, page] of this.pages) if (!wanted.has(id)) this.close(id, page);
    for (const [id, want] of wanted) {
      const page = this.pages.get(id) ?? this.open(id, want);
      if (page.width !== want.width || page.height !== want.height) {
        page.win.setContentSize(want.width, want.height);
        Object.assign(page, { width: want.width, height: want.height });
      }
      if (page.zoom !== want.zoom) {
        page.win.webContents.setZoomFactor(want.zoom);
        page.zoom = want.zoom;
      }
      if (page.url !== want.url) {
        page.url = want.url;
        void page.win.webContents.loadURL(loadable(want.url)).catch(() => {});
      }
    }
  }

  private open(id: string, want: { url: string; width: number; height: number; zoom: number }): Live {
    const win = new BrowserWindow({
      show: false,
      frame: false,
      useContentSize: true,
      width: want.width,
      height: want.height,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "persist:browser-nodes" },
    });
    // A new window is made to fit the screen (1200 × 1200 comes out 1200 × 1032); the page's size is set after.
    win.setContentSize(want.width, want.height);
    const wc = win.webContents;
    wc.setFrameRate(FRAME_RATE);
    wc.setZoomFactor(want.zoom);
    const page: Live = { win, ...want };
    wc.on("paint", (_e, dirty, image) => {
      const tab = this.tab();
      if (!tab || tab.isDestroyed() || dirty.width <= 0 || dirty.height <= 0) return;
      const size = image.getSize();
      const part = dirty.x === 0 && dirty.y === 0 && dirty.width === size.width && dirty.height === size.height ? image : image.crop(dirty);
      const frame: PageFrame = { width: size.width, height: size.height, x: dirty.x, y: dirty.y, w: dirty.width, h: dirty.height, pixels: part.toBitmap() };
      tab.send("browser:frame", id, frame);
    });
    wc.on("cursor-changed", (_e, type) => this.tab()?.send("browser:cursor", id, type));
    // Following a link changes the node's address.
    const went = (_e: unknown, url: string) => {
      if (!this.doc || url === "about:blank") return;
      page.url = url;
      if (docStore.exists(this.doc, id) && docStore.propsOf(this.doc, id).url !== url) {
        this.doc.transact(() => docStore.update(this.doc, id, { url }), FROM_PAGE);
      }
    };
    wc.on("did-navigate", went);
    wc.on("did-navigate-in-page", (e, url, mainFrame) => mainFrame && went(e, url));
    // Links that open a new window open in this page instead.
    wc.setWindowOpenHandler(({ url }) => (void wc.loadURL(url), { action: "deny" }));
    void wc.loadURL(loadable(want.url)).catch(() => {});
    this.pages.set(id, page);
    return page;
  }

  private close(id: string, page: Live): void {
    this.pages.delete(id);
    if (!page.win.isDestroyed()) page.win.destroy();
    this.tab()?.send("browser:closed", id);
  }

  /** The tab forwards input while a node is being used. */
  input(id: string, ev: PageInput): void {
    const wc = this.pages.get(id)?.win.webContents;
    if (!wc || wc.isDestroyed()) return;
    // The page acts on a press or the wheel only where the pointer already is.
    if (ev.type === "mouseDown" || ev.type === "mouseWheel") wc.sendInputEvent({ type: "mouseMove", x: ev.x, y: ev.y });
    if (ev.type === "mouseDown") wc.focus();
    wc.sendInputEvent(ev as Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent);
  }

  /** Reload, back or forward. */
  command(id: string, what: "reload" | "back" | "forward"): void {
    const wc = this.pages.get(id)?.win.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (what === "reload") wc.reload();
    else if (what === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (what === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  /** The tab asks for every page's picture again (it opened, or reloaded). */
  repaint(): void {
    for (const page of this.pages.values()) page.win.webContents.invalidate();
  }

  dispose(): void {
    for (const [id, page] of this.pages) this.close(id, page);
  }
}
