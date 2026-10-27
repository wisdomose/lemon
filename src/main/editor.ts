// One file tab and the design file it shows (Pen keeps open files as tabs of one window, shell.ts).
// The tab's page shows the document and sends its changes back as Yjs updates; the agent works on the
// same document here.
// The file is saved about a second after a change (at most once a second while changes keep coming),
// and when the tab closes. A new file goes to the Drafts folder on its first change. The file's
// picture for the Dashboard is redrawn a little after the saves stop, and on close.
import { app, dialog, type BaseWindow, type WebContentsView } from "electron";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { PersonChange, REPAIR, agentClientId, repairTree } from "../doc/live.js";
import { PRODUCT } from "../product.js";
import type { Engine } from "../engine.js";
import type { Sandbox } from "../sandbox/sandbox.js";
import { AGENTS, type Team } from "../agent/models.js";
import { runAgent, type AgentStats } from "../agent/agent.js";
import { runTeam, type TaggedEvent } from "../agent/team.js";
import { thumbnail } from "../render/thumbnail.js";
import { EXT, addRecent, displayName, isDraft, newDraftPath, readPen, withoutExt, writePen, writeThumb } from "./files.js";
import { page, type FileTab, type TabInfo } from "./shell.js";
import { BrowserPages } from "./browser-pages.js";

/** How long after a change the file is written. */
const SAVE_AFTER_MS = 1000;
/** How long after the last save the file's picture is redrawn. */
const THUMB_AFTER_MS = 3000;

/** A prompt to start the agent with once the window is ready (sent from the Dashboard). */
export interface StartPrompt {
  /** What the chat shows. */
  text: string;
  /** What the agent is sent. */
  forAgent: string;
  model?: string;
  /** Codex reasoning effort carried from the Dashboard into the new editor. */
  effort?: string;
  /** Several agents (from the Dashboard's ⚡ choice). */
  team?: Team;
}

export type SaveState = "saved" | "saving" | "error";

/** Something the window tells the person once it opens (what an import brought over). */
export interface Notice {
  title: string;
  details: string[];
}

/** A document made elsewhere (an imported Pen file): it opens as a new draft named `name`. */
export interface Seed {
  state: Uint8Array;
  name: string;
  notice?: Notice;
}
export interface FileInfo {
  name: string;
  state: SaveState;
  /** Why the last save failed. */
  error?: string;
  draft: boolean;
}

export interface Shared {
  engine: Engine;
  sandbox: Sandbox;
  /** The address of one of the window's pages ("index" is the editor, "dashboard" the Dashboard). */
  pageUrl: (page: "index" | "dashboard") => string;
  preload: string;
  log: (msg: string) => void;
  /** Developer runs (captures, scripted prompts) don't write files. */
  noSave: boolean;
  /** Called when a tab closes, or a file is created, moved or redrawn (the menu and Dashboard follow). */
  changed: () => void;
  /** A tab's name or saved state changed (the tab strips follow). */
  tabsChanged: () => void;
  /** The window, for dialogs. */
  window: () => BaseWindow | undefined;
}

export class Editor implements FileTab {
  readonly doc = new Y.Doc();
  readonly view: WebContentsView;
  /** The live pages of the file's browser nodes. */
  readonly pages: BrowserPages;
  /** The origin of the window's changes in this document. */
  readonly fromWindow: PersonChange;
  path: string | null;
  private state: SaveState = "saved";
  private error: string | undefined;
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;
  private running: AbortController | undefined;
  private thumbTimer: NodeJS.Timeout | undefined;
  /** Nothing has been changed since the window opened on a new file. */
  pristine: boolean;

  /** Opens `path` (a design file, or a raw .yjs state for developer captures), or a new file. */
  constructor(
    private readonly shared: Shared,
    path?: string,
    private startPrompt?: StartPrompt,
    seed?: Seed,
  ) {
    // Agents write to this copy directly, statement by statement: it loses same-moment ties to people (doc/live.ts).
    this.doc.clientID = agentClientId();
    this.notice = seed?.notice;
    if (seed) {
      Y.applyUpdate(this.doc, seed.state);
      path = shared.noSave ? undefined : newDraftPath(seed.name);
    } else if (path?.endsWith(".yjs")) {
      Y.applyUpdate(this.doc, readFileSync(path));
      path = undefined;
    } else if (path) {
      const report = readPen(path, this.doc);
      if (report.missingPictures.length) {
        this.notice = { title: `${report.missingPictures.length} picture${report.missingPictures.length > 1 ? "s" : ""} not found`, details: report.missingPictures.map((u) => `${u} isn't beside the file.`) };
      }
    }
    // A new file starts empty (decided 26 Oct 2026; Pen starts with an 800 × 600 frame).
    this.path = path ?? null;
    this.pristine = !path;
    if (path) addRecent(path);

    this.view = page(shared.preload);
    const { log } = shared;
    if (process.env.LEMON_LOG) {
      const wc = this.view.webContents;
      wc.on("dom-ready", () => log("window dom ready"));
      wc.on("console-message", (e) => log(`[window] ${e.level}: ${e.message}`));
      wc.on("did-fail-load", (_e, code, desc) => log(`[window] failed to load: ${code} ${desc}`));
      wc.on("render-process-gone", (_e, d) => log(`[window] gone: ${d.reason}`));
    }

    // The window's changes carry its own origin, so they are not echoed back and agents can tell
    // them apart (see doc/live.ts).
    const fromWindow = new PersonChange(this.view.webContents.id);
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== fromWindow && !this.page.isDestroyed()) this.page.send("doc:update", update);
      // Concurrent edits can leave nodes inside a deleted frame, or two frames inside each other.
      if (origin !== REPAIR) repairTree(this.doc);
      this.pages.sync();
      this.changed();
    });
    this.fromWindow = fromWindow;
    this.pages = new BrowserPages(this.doc, () => (this.page.isDestroyed() ? undefined : this.page));
    void this.page.loadURL(shared.pageUrl("index"));
    // The tab draws the pages once it has loaded.
    this.page.on("did-finish-load", () => (this.pages.sync(), this.pages.repaint()));
    // An imported document is written to its draft now.
    if (seed && this.path) {
      this.dirty = true;
      this.flush();
    }
  }

  /** The tab's page. */
  get page() {
    return this.view.webContents;
  }

  tab(): TabInfo {
    return { id: this.page.id, name: displayName(this.path), path: this.path, edited: this.dirty || this.state !== "saved" };
  }

  /** The tab is closing (or the window): stop the agent, write the file and its picture. */
  closing(): void {
    this.running?.abort();
    this.pages.dispose();
    this.flush();
    if (this.thumbTimer) void this.redrawThumb();
    this.shared.changed();
  }

  private notice: Notice | undefined;
  /** What to tell the person when the window opens, once (the window asks when it is ready). */
  takeNotice(): Notice | undefined {
    const n = this.notice;
    this.notice = undefined;
    return n;
  }

  /** Applies a change made in the window. */
  push(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, this.fromWindow);
  }

  info(): FileInfo {
    return {
      name: displayName(this.path),
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      draft: !this.path || isDraft(this.path),
    };
  }

  private tell(): void {
    if (this.page.isDestroyed()) return;
    this.page.send("file:info", this.info());
    this.shared.tabsChanged();
  }

  /** The document changed: save soon (a new file gets its place in Drafts now). */
  private changed(): void {
    this.pristine = false;
    if (this.shared.noSave) return;
    if (!this.path) {
      this.path = newDraftPath();
      addRecent(this.path);
      this.shared.changed();
    }
    this.dirty = true;
    if (this.state !== "saving") ((this.state = "saving"), this.tell());
    this.timer ??= setTimeout(() => this.flush(), SAVE_AFTER_MS);
  }

  /** Writes the file now if anything changed since the last write. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty || !this.path) return;
    try {
      writePen(this.path, this.doc);
      this.dirty = false;
      this.state = "saved";
      this.error = undefined;
      clearTimeout(this.thumbTimer);
      this.thumbTimer = setTimeout(() => void this.redrawThumb(), THUMB_AFTER_MS);
    } catch (e) {
      // Keep trying on the next change; the window shows the problem.
      this.state = "error";
      this.error = e instanceof Error ? e.message : String(e);
      this.shared.log(`save failed: ${this.error}`);
    }
    this.tell();
  }

  /** Redraws the file's picture for the Dashboard. */
  private async redrawThumb(): Promise<void> {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = undefined;
    const path = this.path;
    if (!path) return;
    try {
      writeThumb(path, await thumbnail(this.shared.engine, this.doc));
      this.shared.changed();
    } catch (e) {
      this.shared.log(`picture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** The prompt to start with, once (the window asks when it is ready). */
  takeStartPrompt(): StartPrompt | undefined {
    const p = this.startPrompt;
    this.startPrompt = undefined;
    return p;
  }

  /** Ctrl+S: a file somewhere of the person's choosing is written now; a draft asks where to keep it. */
  async save(): Promise<void> {
    if (!this.path || isDraft(this.path)) return this.saveAs();
    this.dirty = true;
    this.flush();
  }

  /** Save As: writes the file where the person chooses; a draft moves there (it leaves Drafts). */
  async saveAs(): Promise<void> {
    const name = this.path ? withoutExt(this.path) : "Untitled";
    const win = this.shared.window();
    const options = {
      defaultPath: join(app.getPath("documents"), `${name}${EXT}`),
      filters: [{ name: "Pen design", extensions: [PRODUCT.fileExtension] }],
    };
    const r = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (r.canceled || !r.filePath) return;
    const target = r.filePath.endsWith(EXT) ? r.filePath : `${r.filePath}${EXT}`;
    try {
      writePen(target, this.doc);
    } catch (e) {
      dialog.showErrorBox("Couldn't save", e instanceof Error ? e.message : String(e));
      return;
    }
    const old = this.path;
    this.path = target;
    this.dirty = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.state = "saved";
    this.error = undefined;
    if (old && old !== target && isDraft(old)) {
      if (existsSync(old)) unlinkSync(old);
      writeThumb(old, undefined);
    }
    void this.redrawThumb();
    addRecent(target);
    this.shared.changed();
    this.tell();
  }

  // ---- The agent -----------------------------------------------------------------------------------
  /** Runs one agent, or a team of them (`team.count` > 1), on this tab's document. */
  async runAgent(prompt: string, model?: string, team?: Team, effort?: string): Promise<AgentStats[]> {
    this.running?.abort();
    const running = (this.running = new AbortController());
    const { engine, sandbox, log } = this.shared;
    const film = process.env.LEMON_FILM;
    const onEvent = (e: TaggedEvent) => {
      if (this.page.isDestroyed()) return;
      this.page.send("agent:event", e);
      const who = "agent" in e && e.agent !== undefined ? ` [${AGENTS[e.agent]?.name}]` : "";
      if (e.type !== "step-target" && e.type !== "step-progress") log(`agent${who} ${e.type}${"step" in e ? ` ${e.step.index} ${e.step.title}` : "title" in e ? ` ${e.index} ${e.title}` : ""}`);
      if (film && e.type === "step-end") {
        const n = String(e.step.index).padStart(2, "0");
        setTimeout(() => this.page.capturePage().then((img) => writeFileSync(join(film, `step-${n}${who ? `-${e.agent}` : ""}.png`), img.toPNG())), 600);
      }
    };
    const base = { doc: this.doc, engine, sandbox, prompt, ...(model ? { model } : {}), ...(effort ? { effort } : {}), signal: running.signal };
    const stats =
      team && team.count > 1 ? await runTeam({ ...base, team, onEvent }) : [await runAgent({ ...base, name: AGENTS[0].name, onEvent })];
    if (this.running === running) this.running = undefined;
    return stats;
  }

  stopAgent(): void {
    this.running?.abort();
  }
}

export const logTo = (file: string | undefined) => (msg: string) => file && appendFileSync(file, `${new Date().toISOString().slice(11, 23)} ${msg}\n`);
