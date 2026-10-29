// The one window, as in Pen: a Home tab (the Dashboard page) and a tab per open file, each tab its own
// page. Only the chosen tab is shown; each page draws the tab strip in its own top bar from the list
// this sends it.
import { app, BaseWindow, WebContentsView, type WebContents } from "electron";
import { join } from "node:path";
import { PRODUCT } from "../product.js";

/** A tab as the top bar shows it. */
export interface TabInfo {
  id: number;
  name: string;
  path: string | null;
  /** Changes not written to the file yet (Pen's dot). */
  edited: boolean;
}

/** What every page is told: the file tabs, and which tab is shown ("home" or a file tab's id). */
export interface Tabs {
  tabs: TabInfo[];
  active: number | "home";
}

/** A file tab's page and what the strip shows for it. */
export interface FileTab {
  readonly view: WebContentsView;
  tab(): TabInfo;
  /** The tab is closing: stop work and write the file. */
  closing(): void;
}

export class Shell {
  readonly win: BaseWindow;
  private readonly home: WebContentsView;
  private readonly files: FileTab[] = [];
  private active: FileTab | null = null;

  constructor(opts: { homeUrl: string; preload: string; onClosed: () => void }) {
    // app.getAppPath resolves the bundled asset inside packaged apps too.
    this.win = new BaseWindow({ icon: join(app.getAppPath(), "assets", "icon.png"), width: 1600, height: 1000, title: PRODUCT.name, backgroundColor: "#141414" });
    this.home = page(opts.preload);
    this.win.contentView.addChildView(this.home);
    void this.home.webContents.loadURL(opts.homeUrl);
    this.win.on("resize", () => this.fit());
    this.win.on("close", () => this.files.forEach((f) => f.closing()));
    this.win.on("closed", opts.onClosed);
    this.fit();
    this.show();
  }

  /** The page of each tab, Home first. */
  pages(): WebContents[] {
    return [this.home.webContents, ...this.files.map((f) => f.view.webContents)];
  }

  /** The file tab shown, if a file is shown. */
  shown(): FileTab | null {
    return this.active;
  }

  /** The file tab whose page is `contents`. */
  tabOf(contents: WebContents): FileTab | undefined {
    return this.files.find((f) => f.view.webContents === contents);
  }

  isHome(contents: WebContents): boolean {
    return contents === this.home.webContents;
  }

  /** Adds a file tab and shows it. */
  add(file: FileTab): void {
    this.files.push(file);
    this.win.contentView.addChildView(file.view);
    this.fit();
    this.show(file);
  }

  /** Shows a file tab, or Home with null. */
  show(file: FileTab | null = null): void {
    this.active = file;
    const page = file?.view ?? this.home;
    for (const v of [this.home, ...this.files.map((f) => f.view)]) v.setVisible(v === page);
    this.win.setTitle(file ? file.tab().name : PRODUCT.name);
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
    page.webContents.focus();
    this.tell();
  }

  /** Closes a file tab (its file is written first); the tab before it, or Home, is shown. */
  close(file: FileTab): void {
    const i = this.files.indexOf(file);
    if (i < 0) return;
    file.closing();
    this.files.splice(i, 1);
    this.win.contentView.removeChildView(file.view);
    file.view.webContents.close();
    if (this.active === file) this.show(this.files[i - 1] ?? this.files[i] ?? null);
    else this.tell();
  }

  /** Shows the tab `by` places before or after the one shown, Home first, wrapping round (Ctrl+Page Up/Down). */
  step(by: -1 | 1): void {
    const all: (FileTab | null)[] = [null, ...this.files];
    const i = all.indexOf(this.active);
    this.show(all[(i + by + all.length) % all.length] ?? null);
  }

  /** Moves the file tab shown one place left or right (Ctrl+Shift+Page Up/Down). */
  shift(by: -1 | 1): void {
    if (!this.active) return;
    const i = this.files.indexOf(this.active);
    const j = i + by;
    if (j < 0 || j >= this.files.length) return;
    [this.files[i], this.files[j]] = [this.files[j]!, this.files[i]!];
    this.tell();
  }

  /** Every page learns the tabs again (a name or a saved state changed). */
  tell(): void {
    const state: Tabs = { tabs: this.files.map((f) => f.tab()), active: this.active ? this.active.tab().id : "home" };
    if (this.active) this.win.setTitle(this.active.tab().name);
    for (const wc of this.pages()) if (!wc.isDestroyed()) wc.send("tabs:state", state);
  }

  tabs(): Tabs {
    return { tabs: this.files.map((f) => f.tab()), active: this.active ? this.active.tab().id : "home" };
  }

  /** Every page fills the window. */
  private fit(): void {
    const { width, height } = this.win.getContentBounds();
    for (const v of [this.home, ...this.files.map((f) => f.view)]) v.setBounds({ x: 0, y: 0, width, height });
  }
}

/** A tab's page: the app's preload, sandboxed. */
export function page(preload: string): WebContentsView {
  const view = new WebContentsView({ webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  view.setBackgroundColor("#141414");
  return view;
}
