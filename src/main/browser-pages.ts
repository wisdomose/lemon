// The live pages of a file's browser nodes. Each browser node with an address gets a page rendered off
// screen at the node's size; its frames go to the file's tab, which draws them inside the node on the
// canvas (so labels, outlines and nodes above it stay on top, as in Pen). While the node is being used
// (a double-click in the tab), the tab forwards the pointer, the wheel and the keys here. Following a
// link changes the node's address, as in Pen.
//
// The integrated browser (the sidebar beside the canvas, as in Pen) is one more page here, under the id
// SIDEBAR: not in the document, sized by the sidebar and its device, and drawn by the sidebar.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, nativeImage, shell, type WebContents } from "electron";
import * as Y from "yjs";
import * as docStore from "../doc/store.js";
import { PICKED, SIDEBAR, type Importable, type PageShot, type PageDriver } from "../agent/browser-tool.js";
import { imageUrls, relinkImages, snapshotInPage, toPen, type Snap } from "../agent/import-page.js";
import { pictureUrl } from "../doc/assets.js";

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

export { PICKED, SIDEBAR };

/** What the sidebar's page is laid out for (Pen's device button): laptop fits the sidebar at half size. */
export type Device = "laptop" | "phone" | "tablet";
const DEVICES: Record<Exclude<Device, "laptop">, { width: number; height: number; agent: string }> = {
  phone: { width: 390, height: 844, agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
  tablet: { width: 1180, height: 820, agent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
};
const NEXT_DEVICE: Record<Device, Device> = { laptop: "phone", phone: "tablet", tablet: "laptop" };
/** The sidebar's page zoom steps (Chrome's). */
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** What the tab asks of the sidebar (see BrowserPages.sidebar). */
export type SidebarAction =
  | "state" | "show" | "hide" | "area" | "open" | "device" | "close-page" | "zoom-in" | "zoom-out" | "zoom-reset"
  | "empty-cache" | "external" | "open-external" | "clear-recent" | "reload" | "back" | "forward" | "pick" | "expand";

/** The element picked in the sidebar's page (Pen's element picker): its ancestry, box and look. */
export interface PickInfo {
  /** body … the element first picked; `index` is the one picked now (an ancestor after a breadcrumb click). */
  crumbs: { tag: string; classes: string[] }[];
  index: number;
  /** Where it is in the page's viewport, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Its CSS flex, as Tailwind names it ("flex-1", "flex-initial") or as written. */
  flex: string;
  /** For an element with text of its own: its font, colour, size and weight. */
  text: { font: string; color: string; size: string; weight: string } | null;
}

/** What the sidebar shows; sent to the tab whenever it changes. */
export interface SidebarState {
  open: boolean;
  /** The page's address, or null for none (the "Import from the web" start). */
  url: string | null;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  device: Device;
  /** The page's size, which the sidebar scales to fit. */
  width: number;
  height: number;
  zoom: number;
  /** Addresses opened in the sidebar, newest first (all files share them). */
  recent: string[];
  /** The element picked in the page, if any. */
  pick: PickInfo | null;
  /** The sidebar is widened over the canvas (Pen's expand button). */
  expanded: boolean;
}

/** Whether the sidebar is shown: one setting for all files, as in Pen. */
let sidebarOpen = false;
const allPages = new Set<BrowserPages>();

const RECENT_MAX = 20;
const recentFile = () => join(app.getPath("userData"), "browser-recent.json");
let recentList: string[] | undefined;
function recent(): string[] {
  if (!recentList) {
    try {
      recentList = existsSync(recentFile()) ? (JSON.parse(readFileSync(recentFile(), "utf8")) as string[]) : [];
    } catch {
      recentList = [];
    }
  }
  return recentList;
}
function keepRecent(list: string[]): void {
  recentList = list.slice(0, RECENT_MAX);
  try {
    writeFileSync(recentFile(), JSON.stringify(recentList, null, 2));
  } catch {}
}

export class BrowserPages implements PageDriver {
  private readonly pages = new Map<string, Live>();
  /** The sidebar: whether it is shown, its device, and the size of its page area (from the tab). */
  private readonly side = { device: "laptop" as Device, area: { width: 478, height: 858 }, pick: null as PickInfo | null, expanded: false };

  constructor(
    private readonly doc: Y.Doc,
    /** The tab the frames and cursor changes go to. */
    private readonly tab: () => WebContents | undefined,
  ) {
    allPages.add(this);
  }

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
    for (const [id, page] of this.pages) if (id !== SIDEBAR && !wanted.has(id)) this.close(id, page);
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
      if (id === SIDEBAR) return ((this.side.pick = null), this.remember(url), this.tellSidebar());
      if (docStore.exists(this.doc, id) && docStore.propsOf(this.doc, id).url !== url) {
        this.doc.transact(() => docStore.update(this.doc, id, { url }), FROM_PAGE);
      }
    };
    wc.on("did-navigate", went);
    wc.on("did-navigate-in-page", (e, url, mainFrame) => mainFrame && went(e, url));
    // Links that open a new window open in this page instead.
    wc.setWindowOpenHandler(({ url }) => (void wc.loadURL(url), { action: "deny" }));
    if (id === SIDEBAR) {
      const tell = () => this.tellSidebar();
      wc.on("did-start-loading", tell);
      wc.on("did-stop-loading", tell);
      wc.on("page-title-updated", tell);
      this.emulate(wc);
    }
    void wc.loadURL(loadable(want.url)).catch(() => {});
    this.pages.set(id, page);
    return page;
  }

  private close(id: string, page: Live): void {
    this.pages.delete(id);
    if (!page.win.isDestroyed()) page.win.destroy();
    this.tab()?.send("browser:closed", id);
    if (id === SIDEBAR) this.tellSidebar();
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

  // ---- The sidebar (the integrated browser) -------------------------------------------------------------

  /** The size the sidebar's page is laid out at for its device. */
  private sidebarSize(): { width: number; height: number } {
    const { device, area } = this.side;
    if (device === "laptop") return { width: area.width * 2, height: area.height * 2 };
    return { width: DEVICES[device].width, height: DEVICES[device].height };
  }

  /** A phone or tablet page gets that device's browser name and touch, as in Pen; a laptop page the app's own. */
  private emulate(wc: WebContents): void {
    const device = this.side.device;
    wc.setUserAgent(device === "laptop" ? wc.session.getUserAgent() : DEVICES[device].agent);
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      void wc.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: device !== "laptop", maxTouchPoints: 10 }).catch(() => {});
    } catch {}
  }

  state(): SidebarState {
    const page = this.pages.get(SIDEBAR);
    const wc = page && !page.win.isDestroyed() ? page.win.webContents : undefined;
    const size = this.sidebarSize();
    return {
      open: sidebarOpen,
      url: page?.url ?? null,
      title: wc?.getTitle() ?? "",
      loading: wc?.isLoading() ?? false,
      canBack: wc?.navigationHistory.canGoBack() ?? false,
      canForward: wc?.navigationHistory.canGoForward() ?? false,
      device: this.side.device,
      width: size.width,
      height: size.height,
      zoom: page?.zoom ?? 1,
      recent: recent(),
      pick: this.side.pick,
      expanded: this.side.expanded,
    };
  }

  /**
   * Pen's element picker: picks the element at a point of the page (CSS pixels), the ancestor at
   * `index` of the current pick's breadcrumbs, or nothing (null); "refresh" measures it again.
   */
  async pick(op: { x: number; y: number } | { index: number } | "refresh" | null): Promise<void> {
    const wc = this.pages.get(SIDEBAR)?.win.webContents;
    if (!wc || wc.isDestroyed()) return;
    this.side.pick = ((await wc.executeJavaScript(`(${pickInPage.toString()})(${JSON.stringify(op)})`).catch(() => null)) as PickInfo | null) ?? null;
    this.tellSidebar();
  }

  /** Whether an element is picked in this page (the sidebar's only). */
  picked(id: string): boolean {
    return id === SIDEBAR && this.side.pick !== null;
  }

  private tellSidebar(): void {
    const tab = this.tab();
    if (tab && !tab.isDestroyed()) tab.send("browser:sidebar", this.state());
  }

  private remember(url: string): void {
    keepRecent([url, ...recent().filter((u) => u !== url)]);
  }

  /** Shows or hides the sidebar; its page stays as it was. */
  showSidebar(open: boolean): void {
    sidebarOpen = open;
    // Every file's tab shows it the same way (as in Pen; each keeps its own page).
    for (const pages of allPages) pages.tellSidebar();
  }

  /** The tab measured the sidebar's page area. */
  sidebarArea(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.side.area.width && h === this.side.area.height) return;
    this.side.area = { width: w, height: h };
    this.resizeSidebar();
  }

  private resizeSidebar(): void {
    const page = this.pages.get(SIDEBAR);
    if (page) {
      const size = this.sidebarSize();
      if (page.width !== size.width || page.height !== size.height) {
        page.win.setContentSize(size.width, size.height);
        Object.assign(page, size);
        // The picked element moves with the page's new layout.
        if (this.side.pick) setTimeout(() => void this.pick("refresh"), 200);
      }
    }
    this.tellSidebar();
  }

  /** Opens an address in the sidebar (showing it), as typed or picked there or from the chat. */
  openInSidebar(url: string): void {
    void this.load(SIDEBAR, url).catch(() => {});
  }

  /** Pen's device button: laptop → phone → tablet → laptop. The page loads again for its new browser. */
  nextDevice(): void {
    this.side.device = NEXT_DEVICE[this.side.device];
    const page = this.pages.get(SIDEBAR);
    if (page) {
      this.emulate(page.win.webContents);
      this.resizeSidebar();
      page.win.webContents.reload();
    } else this.tellSidebar();
  }

  /** The × in the address: no page, back to the start. */
  closeSidebarPage(): void {
    const page = this.pages.get(SIDEBAR);
    this.side.pick = null;
    if (page) this.close(SIDEBAR, page);
  }

  /** Zoom in (1), out (-1) or back to 100% (0). */
  sidebarZoom(step: 1 | -1 | 0): void {
    const page = this.pages.get(SIDEBAR);
    if (!page) return;
    const z = page.zoom;
    page.zoom = step === 0 ? 1 : step > 0 ? (ZOOMS.find((v) => v > z + 1e-6) ?? z) : ([...ZOOMS].reverse().find((v) => v < z - 1e-6) ?? z);
    page.win.webContents.setZoomFactor(page.zoom);
    this.tellSidebar();
  }

  async sidebarEmptyCache(): Promise<void> {
    const wc = this.pages.get(SIDEBAR)?.win.webContents;
    if (!wc) return;
    await wc.session.clearCache();
    wc.reloadIgnoringCache();
  }

  sidebarExternal(): void {
    const url = this.pages.get(SIDEBAR)?.win.webContents.getURL();
    if (url && /^https?:/i.test(url)) void shell.openExternal(url);
  }

  clearRecent(): void {
    keepRecent([]);
    this.tellSidebar();
  }

  isNode(id: string): boolean {
    return docStore.exists(this.doc, id) && docStore.nodesOf(this.doc).get(id)?.get("type") === "browser";
  }

  /** What the agent is told of the browsers as it starts: the sidebar's state, and the browser nodes. */
  summary(): string {
    const page = this.pages.get(SIDEBAR);
    const wc = page && !page.win.isDestroyed() ? page.win.webContents : undefined;
    const nodes = [...docStore.nodesOf(this.doc)].filter(([, r]) => r.get("type") === "browser");
    return [
      wc && sidebarOpen
        ? `The integrated browser (a sidebar beside the canvas) shows ${wc.getURL()} ("${wc.getTitle()}"). Use the browser tool without a nodeId to work with it.`
        : `The integrated browser (a sidebar beside the canvas) is ${sidebarOpen ? "open with no page" : "closed"}. To look at a live website, open it there with the browser tool (load-page, no nodeId).`,
      nodes.length
        ? `Browser nodes on the canvas (drive one by passing its id as nodeId): ${nodes.map(([id, r]) => `"${r.get("name") ?? "Browser"}" (${id}) at ${r.get("url") || "no address"}`).join(", ")}.`
        : "Browser nodes on the canvas (type \"browser\") are driven by passing their id as nodeId.",
    ].join("\n");
  }

  /** What the tab asks of the sidebar; every action answers with what it shows then. */
  async sidebar(action: SidebarAction, arg?: unknown): Promise<SidebarState> {
    const url = typeof arg === "string" ? arg.trim() : "";
    switch (action) {
      case "show":
      case "hide":
        this.showSidebar(action === "show");
        break;
      case "area": {
        const a = arg as { width?: unknown; height?: unknown } | undefined;
        if (typeof a?.width === "number" && typeof a.height === "number") this.sidebarArea(a.width, a.height);
        break;
      }
      case "open":
        if (url) this.openInSidebar(url);
        break;
      case "device":
        this.nextDevice();
        break;
      case "close-page":
        this.closeSidebarPage();
        break;
      case "zoom-in":
      case "zoom-out":
      case "zoom-reset":
        this.sidebarZoom(action === "zoom-in" ? 1 : action === "zoom-out" ? -1 : 0);
        break;
      case "empty-cache":
        await this.sidebarEmptyCache();
        break;
      case "external":
        this.sidebarExternal();
        break;
      // An address from the chat, opened in the person's own browser.
      case "open-external": {
        const href = url ? new URL(loadable(url)).href : "";
        if (/^https?:/i.test(href)) void shell.openExternal(href);
        break;
      }
      case "clear-recent":
        this.clearRecent();
        break;
      case "reload":
      case "back":
      case "forward":
        this.command(SIDEBAR, action);
        break;
      case "pick":
        await this.pick(arg as Parameters<BrowserPages["pick"]>[0]);
        break;
      case "expand":
        this.side.expanded = !!arg;
        this.tellSidebar();
        break;
    }
    return this.state();
  }

  // ---- Driven by an agent (agent/browser-tool.ts) ------------------------------------------------------

  /** A browser node's open page, once it has finished loading. */
  async page(id: string): Promise<WebContents> {
    if (id === SIDEBAR) {
      const wc = this.pages.get(SIDEBAR)?.win.webContents;
      if (!wc || wc.isDestroyed()) throw new Error("The integrated browser has no page open: open one with load-page.");
      if (wc.isLoading()) await settled(wc);
      return wc;
    }
    const rec = docStore.exists(this.doc, id) ? docStore.nodesOf(this.doc).get(id) : undefined;
    if (rec?.get("type") !== "browser") throw new Error(`No browser node with id "${id}" in this document.`);
    this.sync();
    const wc = this.pages.get(id)?.win.webContents;
    if (!wc || wc.isDestroyed()) throw new Error(`Browser node "${id}" has no page yet: open one with load-page.`);
    if (wc.isLoading()) await settled(wc);
    return wc;
  }

  /** Loads `url` in a browser node (its address changes to it) and waits until it has loaded. */
  async load(id: string, url: string): Promise<{ url: string; title: string }> {
    const target = new URL(loadable(url.trim())).href;
    if (id === SIDEBAR) {
      if (!sidebarOpen) this.showSidebar(true);
      let page = this.pages.get(SIDEBAR);
      if (page) page.url = url.trim();
      else page = this.open(SIDEBAR, { url: url.trim(), zoom: 1, ...this.sidebarSize() });
      this.tellSidebar();
      return this.finishLoad(page, target);
    }
    const rec = docStore.exists(this.doc, id) ? docStore.nodesOf(this.doc).get(id) : undefined;
    if (rec?.get("type") !== "browser") throw new Error(`No browser node with id "${id}" in this document.`);
    // An open page is loaded below, not again by sync.
    const open = this.pages.get(id);
    if (open) open.url = url.trim();
    if (docStore.propsOf(this.doc, id).url !== url) this.doc.transact(() => docStore.update(this.doc, id, { url }), FROM_PAGE);
    this.sync();
    return this.finishLoad(this.pages.get(id)!, target);
  }

  private async finishLoad(page: Live, target: string): Promise<{ url: string; title: string }> {
    try {
      await page.win.webContents.loadURL(target);
    } catch (e) {
      // A load replaced by a redirect or the page's own navigation still ends with a page.
      const code = (e as { code?: string }).code;
      if (code !== "ERR_ABORTED") throw new Error(`Could not load ${target} (${code ?? (e as Error).message}).`);
      await settled(page.win.webContents);
    }
    const wc = page.win.webContents;
    return { url: wc.getURL(), title: wc.getTitle() };
  }

  /** The node's page through the Chrome DevTools Protocol; a command that navigates returns once it has loaded. */
  async cdp(id: string, method: string, params?: Record<string, unknown>): Promise<{ result: unknown; page: string }> {
    const wc = await this.page(id);
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    let navigated = false;
    const started = (e: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (e.isMainFrame && !e.isSameDocument) navigated = true;
    };
    wc.on("did-start-navigation", started);
    try {
      const result: unknown = await wc.debugger.sendCommand(method, params ?? {});
      // A click on a link starts its navigation a moment after the click itself.
      await new Promise((r) => setTimeout(r, 100));
      if (navigated || wc.isLoading()) await settled(wc);
      return { result, page: `${wc.getURL()} ("${wc.getTitle()}")` };
    } finally {
      wc.off("did-start-navigation", started);
    }
  }

  /**
   * A picture of the page as the node shows it, or of the element `selector` matches (scrolled into
   * view first, and cut to what of it is on the page).
   */
  async capture(id: string, selector?: string, full = false): Promise<PageShot> {
    const wc = await this.page(id);
    const page = this.pages.get(id)!;
    if (full && selector === undefined) {
      // The whole length of the page, beyond what the node shows.
      if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
      const m = (await wc.debugger.sendCommand("Page.getLayoutMetrics")) as { cssContentSize: { width: number; height: number } };
      const width = Math.ceil(m.cssContentSize.width);
      const height = Math.min(Math.ceil(m.cssContentSize.height), 16384);
      const shot = (await wc.debugger.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } })) as { data: string };
      const png = new Uint8Array(Buffer.from(shot.data, "base64"));
      const image = nativeImage.createFromBuffer(Buffer.from(png));
      return { png, jpeg: image.toJPEG(85), width, height, title: wc.getTitle(), url: wc.getURL() };
    }
    let rect: Electron.Rectangle | undefined;
    if (selector !== undefined) {
      const box = (await wc.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
          el.scrollIntoView({ block: "nearest", inline: "nearest" }); const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      )) as Electron.Rectangle | null;
      if (!box) throw new Error(`No element matched the CSS selector "${selector}".`);
      const z = page.zoom;
      const x0 = Math.max(0, Math.floor(box.x * z));
      const y0 = Math.max(0, Math.floor(box.y * z));
      const x1 = Math.min(page.width, Math.ceil((box.x + box.width) * z));
      const y1 = Math.min(page.height, Math.ceil((box.y + box.height) * z));
      if (x1 <= x0 || y1 <= y0) throw new Error(`The element matching "${selector}" has no visible area.`);
      rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      // Scrolling it into view is drawn on the next frame.
      await new Promise((r) => setTimeout(r, 150));
    }
    const shot = await wc.capturePage();
    const image = rect ? shot.crop(scaled(rect, shot.getSize().width / page.width)) : shot;
    // Its size on the canvas is the page's own (CSS pixels at the node's zoom), whatever the picture's.
    const size = rect ?? { width: page.width, height: page.height };
    return { png: image.toPNG(), jpeg: image.toJPEG(85), width: size.width, height: size.height, title: wc.getTitle(), url: wc.getURL() };
  }

  /**
   * The page, or the element `selector` matches, as .pen layers (Pen's Import): measured in the page,
   * turned into nodes, and its pictures fetched (with the page's own session) to keep beside the file.
   */
  async importable(id: string, selector?: string): Promise<Importable> {
    const wc = await this.page(id);
    const snap = (await wc.executeJavaScript(`(${snapshotInPage.toString()})(${JSON.stringify(selector ?? null)})`)) as Snap | null;
    if (!snap) throw new Error(`No element matched the CSS selector "${selector}".`);
    const node = toPen(snap, selector === undefined ? wc.getTitle() || snap.tag : undefined);
    const pictures: Importable["pictures"] = [];
    const moved = new Map<string, string>();
    const zoom = this.pages.get(id)!.zoom;
    let shot: Electron.NativeImage | undefined;
    for (const url of imageUrls(node)) {
      try {
        let bytes: Uint8Array;
        if (url.startsWith("capture:")) {
          // A canvas: cut from a screenshot of the page.
          shot ??= await wc.capturePage();
          const [x, y, w, h] = url.slice(8).split(",").map((v) => Math.round(Number(v) * zoom)) as [number, number, number, number];
          const size = shot.getSize();
          const cut = { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(w, size.width - Math.max(0, x)), height: Math.min(h, size.height - Math.max(0, y)) };
          if (cut.width <= 0 || cut.height <= 0) continue;
          bytes = new Uint8Array(shot.crop(cut).toPNG());
        } else if (url.startsWith("data:")) bytes = new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
        else {
          const res = await wc.session.fetch(url);
          if (!res.ok) continue;
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        const local = await pictureUrl(bytes);
        moved.set(url, local);
        pictures.push({ url: local, bytes });
      } catch {}
    }
    relinkImages(node, moved);
    return { node, pictures };
  }

  /** The element `selector` matches (or the body) as text: where it is, its tag, and its tree with computed styles. */
  async element(id: string, selector?: string): Promise<string> {
    const wc = await this.page(id);
    const text = (await wc.executeJavaScript(`(${describeElement.toString()})(${JSON.stringify(selector ?? null)})`)) as string | null;
    if (text === null) throw new Error(`No element matched the CSS selector "${selector}".`);
    return text;
  }

  /** The tab asks for every page's picture again (it opened, or reloaded). */
  repaint(): void {
    for (const page of this.pages.values()) page.win.webContents.invalidate();
  }

  dispose(): void {
    allPages.delete(this);
    for (const [id, page] of this.pages) this.close(id, page);
  }
}

/** Resolves once a page has stopped loading (or after 30 seconds, for pages that never do). */
function settled(wc: WebContents): Promise<void> {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => (clearTimeout(timer), wc.off("did-stop-loading", done), resolve());
    const timer = setTimeout(done, 30_000);
    wc.on("did-stop-loading", done);
  });
}

const scaled = (r: Electron.Rectangle, k: number): Electron.Rectangle =>
  k === 1 ? r : { x: Math.round(r.x * k), y: Math.round(r.y * k), width: Math.round(r.width * k), height: Math.round(r.height * k) };

/**
 * Runs in the page (it is sent as source, so it uses nothing from outside): the element `selector`
 * matches, or the body, as Pen's browser tool describes one — its path from the body, where it is on
 * the page, its own tag, and its tree with the computed styles that aren't the defaults. Null when
 * nothing matches.
 */
function describeElement(selector: string | null): string | null {
  const el = selector === null ? document.body : document.querySelector(selector);
  if (!el) return null;
  const LIMIT = 40_000;
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const label = (e: Element) => cut(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + [...e.classList].slice(0, 2).map((c) => `.${c}`).join(""), 50);
  const path: string[] = [];
  for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) path.unshift(label(e));
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const attrs = (e: Element, skip: string[]) =>
    [...e.attributes].filter((a) => a.name !== "style" && !skip.includes(a.name)).map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
  // Left out where the value is this one: the layout properties (written first), then the look.
  const LAYOUT: Record<string, string> = {
    "flex-direction": "row", "flex-wrap": "nowrap", "flex-grow": "0", "flex-shrink": "1", gap: "normal",
    "justify-content": "normal", "align-items": "normal", "grid-template-columns": "none", "grid-template-rows": "none",
  };
  const LOOK: Record<string, string> = {
    "border-top-left-radius": "0px", "border-top-right-radius": "0px", "border-bottom-right-radius": "0px", "border-bottom-left-radius": "0px",
    "background-color": "rgba(0, 0, 0, 0)", "background-image": "none",
    "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px",
    "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px",
    "text-align": "start", "white-space": "normal", "overflow-x": "visible", "overflow-y": "visible", opacity: "1",
    "box-shadow": "none", "letter-spacing": "normal", "text-transform": "none", "text-decoration-line": "none", "z-index": "auto",
  };
  const SKIP = ["script", "style", "noscript", "template", "link", "meta"];
  const styleOf = (e: Element, parent: CSSStyleDeclaration | undefined) => {
    const s = getComputedStyle(e);
    const out: string[] = [];
    const add = (k: string, v: string) => v && out.push(`${k}: ${v}`);
    if (s.display !== "block") add("display", s.display);
    for (const [k, d] of Object.entries(LAYOUT)) if (s.getPropertyValue(k) !== d) add(k, s.getPropertyValue(k));
    add("position", s.position);
    if (s.position !== "static") for (const k of ["top", "right", "bottom", "left"]) if (s.getPropertyValue(k) !== "auto") add(k, s.getPropertyValue(k));
    for (const [k, d] of Object.entries(LOOK)) if (s.getPropertyValue(k) !== d) add(k, s.getPropertyValue(k));
    for (const side of ["top", "right", "bottom", "left"]) {
      const w = s.getPropertyValue(`border-${side}-width`);
      if (w !== "0px" && s.getPropertyValue(`border-${side}-style`) !== "none") add(`border-${side}`, `${w} ${s.getPropertyValue(`border-${side}-style`)} ${s.getPropertyValue(`border-${side}-color`)}`);
    }
    if (!parent || s.fontFamily !== parent.fontFamily) add("font-family", s.fontFamily);
    add("color", s.color);
    add("font-size", s.fontSize);
    add("font-weight", s.fontWeight);
    add("line-height", s.lineHeight);
    if (s.display !== "inline" && s.display !== "contents") {
      if (s.width !== "auto") add("width", s.width);
      if (s.height !== "auto") add("height", s.height);
    }
    return { style: s, text: out.join("; ") };
  };
  let size = 0;
  const tree = (e: Element, parent: CSSStyleDeclaration | undefined): string => {
    const tag = e.tagName.toLowerCase();
    if (SKIP.includes(tag) || size > LIMIT) return "";
    // A drawing's geometry is long and says little about the design.
    const inSvg = e instanceof SVGElement && tag !== "svg";
    const { style, text } = styleOf(e, parent);
    const open = `<${tag}${attrs(e, inSvg ? ["d", "points"] : [])}${text ? ` style="${text.replace(/"/g, "'")}"` : ""}>`;
    size += open.length;
    let inner = "";
    for (const child of e.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent?.replace(/\s+/g, " ").trim();
        if (t) (inner += escape(t)), (size += t.length);
      } else if (child.nodeType === Node.ELEMENT_NODE) inner += tree(child as Element, style);
    }
    return `${open}${inner}</${tag}>`;
  };
  const r = el.getBoundingClientRect();
  const px = (v: number) => `${Math.round(v)}px`;
  const tag = el.tagName.toLowerCase();
  const styled = tree(el, el.parentElement ? getComputedStyle(el.parentElement) : undefined);
  return [
    `DOM Path: ${path.join(" > ")}`,
    `Position: top=${px(r.top)}, left=${px(r.left)}, width=${px(r.width)}, height=${px(r.height)}`,
    `HTML Element: <${tag}${attrs(el, [])}></${tag}>`,
    "",
    `Styled tree for ${label(el)}:`,
    size > LIMIT ? `${styled.slice(0, LIMIT)}\n…(cut: the element is too big to read whole; query a smaller part of it)` : styled,
  ].join("\n");
}

/**
 * Runs in the page (sent as source): Pen's element picker. Marks the picked element with an attribute
 * (so the agent's `target: "selection"` finds it) and describes it; null when nothing is picked.
 */
function pickInPage(op: { x: number; y: number } | { index: number } | "refresh" | null): unknown {
  const PICK = "data-lemon-pick";
  const LEAF = "data-lemon-pick-leaf";
  const leafNow = document.querySelector(`[${LEAF}]`);
  const pickNow = document.querySelector(`[${PICK}]`);
  const unmark = () => (leafNow?.removeAttribute(LEAF), pickNow?.removeAttribute(PICK));
  let leaf: Element | null = leafNow;
  let pick: Element | null = pickNow;
  if (op === null) return (unmark(), null);
  if (op !== "refresh" && "x" in op) {
    const at = document.elementFromPoint(op.x, op.y);
    if (!at) return (unmark(), null);
    unmark();
    leaf = pick = at;
  }
  if (!leaf || !pick) return null;
  const chain: Element[] = [];
  for (let e: Element | null = leaf; e && e !== document.documentElement; e = e.parentElement) chain.unshift(e);
  if (op !== "refresh" && "index" in op) {
    const to = chain[op.index];
    if (to) (pick.removeAttribute(PICK), (pick = to));
  }
  leaf.setAttribute(LEAF, "");
  pick.setAttribute(PICK, "");
  const r = pick.getBoundingClientRect();
  const s = getComputedStyle(pick);
  const FLEX: Record<string, string> = { "0 1 auto": "flex-initial", "1 1 0%": "flex-1", "1 1 auto": "flex-auto", "0 0 auto": "flex-none" };
  const ownText = [...pick.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim());
  const hex = (c: string) => {
    const m = c.match(/\d+(\.\d+)?/g);
    return m && m.length >= 3 ? "#" + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("") : c;
  };
  return {
    crumbs: chain.map((e) => ({ tag: e.tagName.toLowerCase(), classes: [...e.classList].slice(0, 2) })),
    index: chain.indexOf(pick),
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
    flex: FLEX[s.flex] ?? s.flex,
    text: ownText ? { font: s.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, ""), color: hex(s.color), size: s.fontSize, weight: s.fontWeight } : null,
  };
}
