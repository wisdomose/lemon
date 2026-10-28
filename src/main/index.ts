// Electron's main process: owns the window (shell.ts: Home and a tab per open file), the documents (one
// per file tab, editor.ts), the fonts and the agents. Tabs show their document and receive every change
// as a Yjs update.
import { app, dialog, ipcMain, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import * as Y from "yjs";
import { nodesOf } from "../doc/store.js";
import { PRODUCT } from "../product.js";
import { createEngine } from "../engine.js";
import { GoogleFonts } from "../text/google-fonts.js";
import { Sandbox } from "../sandbox/sandbox.js";
import type { FontFace } from "../text/fonts.js";
import { Editor, logTo, type Shared, type StartPrompt } from "./editor.js";
import { EXT, clearRecents, dashboardFiles, deleteDraft, forgetRecent, renameDesign } from "./files.js";
import { Shell } from "./shell.js";
import type { PageInput } from "./browser-pages.js";
import { buildMenu } from "./menu.js";
import { codexModels, codexSignIn, codexStatus } from "../agent/codex.js";
import type { Team } from "../agent/models.js";

// Developer switches are environment variables, all off in normal use; .env.example lists them.
// While developing (not in the installed app), a .env file in the project folder is read first; values
// already set in the real environment win.
if (!app.isPackaged) {
  try {
    process.loadEnvFile(join(app.getAppPath(), ".env"));
  } catch {
    // No .env file: nothing to load.
  }
}
const env = process.env;

app.setName(PRODUCT.name);

// The window is served from app://ui/… rather than file://, so it can fetch its own WebAssembly files.
const UI_SCHEME = "app";
protocol.registerSchemesAsPrivileged([
  { scheme: UI_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const UI_ROOT = join(import.meta.dirname, "..", "renderer");
if (process.platform === "win32") app.setAppUserModelId(PRODUCT.appId);

const log = logTo(env.LEMON_LOG);

/** File tabs, by the id of their page (each page's messages are routed to its editor). */
const editors = new Map<number, Editor>();
let shared: Shared | undefined;
/** The window; it opens with the first file or with Home, and the app quits when it closes. */
let window: Shell | undefined;

function theWindow(): Shell {
  window ??= new Shell({ homeUrl: shared!.pageUrl("dashboard"), preload: shared!.preload, onClosed: () => app.quit() });
  return window;
}
/** Files asked for before the app was ready (double-clicked, or passed on the command line). */
const pending: string[] = [];

const designFiles = (args: string[]) => args.filter((a) => a.toLowerCase().endsWith(EXT) && existsSync(a));

/** Opens a tab on `path` (or a new file); an already open file's tab is shown. */
function openEditor(path?: string, start?: StartPrompt): Editor | undefined {
  if (!shared) {
    if (path) pending.push(path);
    return undefined;
  }
  const open = path && [...editors.values()].find((e) => e.path === path);
  if (open) {
    theWindow().show(open);
    return open;
  }
  let editor: Editor;
  try {
    editor = new Editor(shared, path, start);
  } catch (e) {
    dialog.showErrorBox(`Couldn't open ${path ? basename(path) : "the file"}`, e instanceof Error ? e.message : String(e));
    if (path) forgetRecent(path);
    refreshMenu();
    return undefined;
  }
  const id = editor.page.id;
  editors.set(id, editor);
  editor.page.once("destroyed", () => editors.delete(id));
  theWindow().add(editor);
  refreshMenu();
  return editor;
}

/** The file tab shown. */
const focused = () => {
  const tab = window?.shown();
  return tab ? editors.get(tab.view.webContents.id) : undefined;
};

/** Closes a file tab. */
function closeTab(editor: Editor) {
  window?.close(editor);
  editors.delete(editor.page.id);
  refreshMenu();
}

/** Open…: files chosen open in their own tabs; a new file nobody has touched gives way to them. */
async function openDialog(): Promise<number> {
  const before = focused();
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Pen design", extensions: [PRODUCT.fileExtension] }],
  };
  const r = await (window ? dialog.showOpenDialog(window.win, options) : dialog.showOpenDialog(options));
  if (r.canceled) return 0;
  return openPaths(r.filePaths, before);
}

async function openPaths(paths: string[], replacing?: Editor): Promise<number> {
  const opened: Editor[] = [];
  for (const p of paths) {
    const e = openEditor(p);
    if (e) opened.push(e);
  }
  if (opened.length && replacing?.pristine && !opened.includes(replacing)) closeTab(replacing);
  return opened.length;
}

/** Shows the Home tab (the Dashboard). */
function showDashboard() {
  if (shared) theWindow().show(null);
}

function refreshMenu() {
  buildMenu({
    newFile: () => openEditor(),
    dashboard: showDashboard,
    open: () => void openDialog(),
    openPath: (path) => void openPaths([path], focused()),
    clearRecents: () => (clearRecents(), refreshMenu()),
    save: () => void focused()?.save(),
    saveAs: () => void focused()?.saveAs(),
    // The tab shown: editors take every command, Home takes Settings.
    toWindow: (command) => {
      const page = window?.shown()?.view.webContents ?? window?.pages()[0];
      page?.send("menu:command", command);
    },
  });
}

// One app, one window: opening a file while the app runs (a double-click in Explorer, say) reaches
// the running app and opens a tab instead of starting another.
// Developer runs (captures, scripted prompts) stand alone, so they can run beside the app.
const developer = !!(env.LEMON_CAPTURE || env.LEMON_PROMPT);
const alone = developer || app.requestSingleInstanceLock();
if (!alone) app.quit();
app.on("second-instance", (_e, argv) => {
  const files = designFiles(argv);
  if (files.length) files.forEach((f) => openEditor(f));
  else showDashboard();
});
app.on("open-file", (e, path) => {
  e.preventDefault();
  openEditor(path);
});

async function main() {
  if (!alone) return;
  await app.whenReady();
  log("ready");
  protocol.handle(UI_SCHEME, (req) => {
    const path = join(UI_ROOT, decodeURIComponent(new URL(req.url).pathname));
    if (!path.startsWith(UI_ROOT)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(path).toString());
  });
  const fonts = await GoogleFonts.open(join(app.getPath("userData"), "fonts"));
  const [engine, sandbox] = await Promise.all([createEngine(fonts), Sandbox.create()]);
  log("engine and sandbox ready");

  // Messages come from a window; each goes to that window's editor.
  const editorOf = (e: IpcMainEvent | IpcMainInvokeEvent) => editors.get(e.sender.id);
  ipcMain.on("doc:push", (e, update: Uint8Array) => editorOf(e)?.push(update));
  ipcMain.handle("doc:state", (e) => {
    const editor = editorOf(e);
    return editor ? Y.encodeStateAsUpdate(editor.doc) : new Uint8Array();
  });
  ipcMain.handle("file:info", (e) => editorOf(e)?.info());
  ipcMain.handle("fonts:catalogue", () => fonts.catalogue.families);
  ipcMain.handle("fonts:load", (_e, face: FontFace) => fonts.load(face));
  ipcMain.handle("agent:run", (e, prompt: string, model?: string, team?: Team, effort?: string) => editorOf(e)?.runAgent(prompt, model, team, effort));
  ipcMain.handle("agent:stop", (e) => editorOf(e)?.stopAgent());
  ipcMain.handle("claude:status", () => claudeStatus());
  // Ask the local Codex server for public account metadata only.
  ipcMain.handle("codex:status", () => codexStatus());
  ipcMain.handle("codex:sign-in", () => codexSignIn((url) => void shell.openExternal(url)));
  ipcMain.handle("codex:models", (_e, fresh?: boolean) => codexModels(!!fresh));
  ipcMain.handle("agent:start-prompt", (e) => editorOf(e)?.takeStartPrompt());
  ipcMain.handle("editor:notice", (e) => editorOf(e)?.takeNotice());
  ipcMain.handle("dashboard:show", () => showDashboard());
  // The tab strip in every page's top bar.
  ipcMain.handle("tabs:get", () => window?.tabs() ?? { tabs: [], active: "home" });
  ipcMain.handle("tabs:show", (_e, id: number | "home") => {
    const editor = id === "home" ? undefined : editors.get(id);
    if (id === "home" || editor) theWindow().show(editor ?? null);
  });
  ipcMain.handle("tabs:close", (_e, id: number) => {
    const editor = editors.get(id);
    if (editor) closeTab(editor);
  });
  ipcMain.handle("tabs:new", () => void openEditor());
  // A tab's live browser pages.
  ipcMain.on("browser:input", (e, id: string, ev: PageInput) => editorOf(e)?.pages.input(id, ev));
  ipcMain.handle("browser:command", (e, id: string, what: "reload" | "back" | "forward") => editorOf(e)?.pages.command(id, what));
  ipcMain.on("browser:repaint", (e) => editorOf(e)?.pages.repaint());
  // A tab's script nodes.
  ipcMain.handle("script:choose", (e) => editorOf(e)?.chooseScript());
  ipcMain.handle("script:reveal", (e, uri: string) => {
    const path = editorOf(e)?.scriptPath(uri);
    if (path && existsSync(path)) shell.showItemInFolder(path);
  });
  // The Dashboard's own requests.
  ipcMain.handle("dashboard:files", () => dashboardFiles());
  ipcMain.handle("dashboard:open", (_e, path: string) => void openEditor(path));
  ipcMain.handle("dashboard:new", (_e, start?: StartPrompt) => void openEditor(undefined, start));
  ipcMain.handle("dashboard:open-dialog", async () => void (await openDialog()));
  ipcMain.handle("dashboard:reveal", (_e, path: string) => shell.showItemInFolder(path));
  ipcMain.handle("dashboard:forget", (_e, path: string) => (forgetRecent(path), fileListChanged()));
  // Rename renames the file on disk; an open tab follows it. Returns why it couldn't, if it couldn't.
  ipcMain.handle("dashboard:rename", (_e, path: string, name: string) => {
    try {
      const to = renameDesign(path, name);
      [...editors.values()].find((ed) => ed.path === path)?.renamed(to);
      fileListChanged();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
  ipcMain.handle("dashboard:delete", async (_e, path: string) => {
    const win = window?.win;
    const ask = (o: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
    if ([...editors.values()].some((ed) => ed.path === path)) {
      await ask({ type: "info", message: `${basename(path)} is open.`, detail: "Close its tab first." });
      return;
    }
    const r = await ask({
      type: "warning",
      message: `Delete ${basename(path)}?`,
      detail: "The draft is deleted for good.",
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    deleteDraft(path);
    fileListChanged();
  });

  // `pnpm dev` (electron-vite) serves the window live and passes its address.
  const devUrl = !app.isPackaged ? env.ELECTRON_RENDERER_URL : undefined;
  shared = {
    engine,
    sandbox,
    pageUrl: (page) => (devUrl ? `${devUrl.replace(/\/$/, "")}/${page}.html` : `${UI_SCHEME}://ui/${page}.html`),
    preload: join(import.meta.dirname, "..", "preload", "index.cjs"),
    log,
    noSave: developer,
    changed: fileListChanged,
    tabsChanged: () => window?.tell(),
    window: () => window?.win,
  };
  // The menu bar before any window opens (the app may start on the Dashboard alone).
  refreshMenu();

  // Developer runs: a scripted prompt on an empty document, or a capture of a saved one.
  if (developer) return developerRun(env.LEMON_OPEN);
  const files = [...pending, ...designFiles(process.argv.slice(1))];
  if (env.LEMON_OPEN) files.push(env.LEMON_OPEN);
  if (files.length) await openPaths(files);
  if (!editors.size) showDashboard();
}

function fileListChanged() {
  refreshMenu();
  window?.pages()[0]?.send("dashboard:files", dashboardFiles());
  window?.tell();
}

/** LEMON_PROMPT runs the agent on an empty document; LEMON_CAPTURE saves a picture of the window. */
async function developerRun(open: string | undefined) {
  const editor = openEditor(open)!;
  const win = { webContents: editor.page };
  if (env.LEMON_PROMPT) editor.doc.transact(() => nodesOf(editor.doc).clear());
  win.webContents.once("did-finish-load", async () => {
    log("window loaded");
    if (env.LEMON_PROMPT) {
      // LEMON_TEAM="3 split" (or "2 side") sends the prompt to several agents.
      const [count, mode] = (env.LEMON_TEAM ?? "").split(/\s+/);
      const team = count ? { count: Number(count), mode: mode === "side" ? ("side" as const) : ("split" as const) } : undefined;
      const all = await editor.runAgent(env.LEMON_PROMPT, undefined, team);
      for (const stats of all) {
        console.log(JSON.stringify({ ok: stats.ok, seconds: Math.round(stats.durationMs / 1000), steps: stats.steps.length, costUsd: stats.costUsd, reply: stats.reply }));
      }
      if (env.LEMON_CAPTURE) writeFileSync(env.LEMON_CAPTURE.replace(/\.png$/, ".yjs"), Y.encodeStateAsUpdate(editor.doc));
    }
    if (!env.LEMON_CAPTURE) return;
    // Wait until the window has drawn (it marks <body data-ready>), then a moment for the last change.
    for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript("!!document.body.dataset.ready")); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const image = await win.webContents.capturePage();
    writeFileSync(env.LEMON_CAPTURE, image.toPNG());
    if (open) writeFileSync(env.LEMON_CAPTURE.replace(/\.png$/, ".yjs"), Y.encodeStateAsUpdate(editor.doc));
    app.quit();
  });
}

/** `claude auth status`: whether Claude Code is signed in, and as whom. Lemon never sees credentials. */
function claudeStatus(): Promise<{ loggedIn: boolean; email?: string; plan?: string }> {
  return new Promise((resolve) => {
    execFile("claude", ["auth", "status"], { timeout: 10_000 }, (err, stdout) => {
      try {
        const s = JSON.parse(stdout) as { loggedIn?: boolean; email?: string; subscriptionType?: string };
        resolve({ loggedIn: !!s.loggedIn, ...(s.email ? { email: s.email } : {}), ...(s.subscriptionType ? { plan: s.subscriptionType } : {}) });
      } catch {
        resolve({ loggedIn: false });
      }
      void err;
    });
  });
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
