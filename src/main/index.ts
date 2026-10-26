// Electron's main process: owns the documents (one per editor window, editor.ts), the fonts and the
// agents. Windows show their document and receive every change as a Yjs update.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as Y from "yjs";
import { nodesOf } from "../doc/store.js";
import { PRODUCT } from "../product.js";
import { createEngine } from "../engine.js";
import { GoogleFonts } from "../text/google-fonts.js";
import { Sandbox } from "../sandbox/sandbox.js";
import type { FontFace } from "../text/fonts.js";
import { Editor, logTo, type Shared, type StartPrompt } from "./editor.js";
import { EXT, clearRecents, dashboardFiles, deleteDraft, forgetRecent } from "./files.js";
import { dashboardWindow, openDashboard, refreshDashboard } from "./dashboard.js";
import { buildMenu } from "./menu.js";

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

/** Windows, by the id of their web contents (each window's messages are routed to its editor). */
const editors = new Map<number, Editor>();
let shared: Shared | undefined;
/** Files asked for before the app was ready (double-clicked, or passed on the command line). */
const pending: string[] = [];

const designFiles = (args: string[]) => args.filter((a) => a.endsWith(EXT) && existsSync(a));

/** Opens a window on `path` (or a new file); an already open file just comes to the front. */
function openEditor(path?: string, start?: StartPrompt): Editor | undefined {
  if (!shared) {
    if (path) pending.push(path);
    return undefined;
  }
  const open = path && [...editors.values()].find((e) => e.path === path);
  if (open) {
    if (open.win.isMinimized()) open.win.restore();
    open.win.focus();
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
  const id = editor.win.webContents.id;
  editors.set(id, editor);
  editor.win.on("closed", () => editors.delete(id));
  refreshMenu();
  return editor;
}

const focused = () => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? editors.get(win.webContents.id) : undefined;
};

/** Open…: files chosen open in their own windows; a new file nobody has touched gives way to them. */
async function openDialog(): Promise<number> {
  const before = focused();
  const r = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: `${PRODUCT.name} design`, extensions: [PRODUCT.fileExtension] }],
  });
  if (r.canceled) return 0;
  return openPaths(r.filePaths, before);
}

function openPaths(paths: string[], replacing?: Editor): number {
  const opened = paths.map((p) => openEditor(p)).filter((e) => !!e);
  if (opened.length && replacing?.pristine && !opened.includes(replacing)) replacing.win.close();
  return opened.length;
}

/** The Dashboard gives way to the file it opens (it comes back with Ctrl+N). */
function leaveDashboard(opened: unknown) {
  if (opened) dashboardWindow()?.close();
}

function showDashboard() {
  if (shared) openDashboard({ url: shared.pageUrl("dashboard"), preload: shared.preload });
}

function refreshMenu() {
  buildMenu({
    newFile: () => openEditor(),
    dashboard: showDashboard,
    open: () => void openDialog(),
    openPath: (path) => openPaths([path], focused()),
    clearRecents: () => (clearRecents(), refreshMenu()),
    save: () => void focused()?.save(),
    saveAs: () => void focused()?.saveAs(),
    toWindow: (command) => focused()?.win.webContents.send("menu:command", command),
  });
}

// One app, many windows: opening a file while the app runs (a double-click in Explorer, say) reaches
// the running app instead of starting another.
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
  ipcMain.handle("agent:run", (e, prompt: string, model?: string) => editorOf(e)?.runAgent(prompt, model));
  ipcMain.handle("agent:stop", (e) => editorOf(e)?.stopAgent());
  ipcMain.handle("claude:status", () => claudeStatus());
  ipcMain.handle("agent:start-prompt", (e) => editorOf(e)?.takeStartPrompt());
  ipcMain.handle("dashboard:show", () => showDashboard());
  // The Dashboard's own requests.
  ipcMain.handle("dashboard:files", () => dashboardFiles());
  ipcMain.handle("dashboard:open", (_e, path: string) => leaveDashboard(openEditor(path)));
  ipcMain.handle("dashboard:new", (_e, start?: StartPrompt) => leaveDashboard(openEditor(undefined, start)));
  ipcMain.handle("dashboard:open-dialog", async () => leaveDashboard(await openDialog()));
  ipcMain.handle("dashboard:reveal", (_e, path: string) => shell.showItemInFolder(path));
  ipcMain.handle("dashboard:forget", (_e, path: string) => (forgetRecent(path), fileListChanged()));
  ipcMain.handle("dashboard:delete", async (_e, path: string) => {
    const win = dashboardWindow();
    const ask = (o: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o));
    if ([...editors.values()].some((ed) => ed.path === path)) {
      await ask({ type: "info", message: `${basename(path)} is open.`, detail: "Close its window first." });
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
  };
  // The menu bar before any window opens (the app may start on the Dashboard alone).
  refreshMenu();

  // Developer runs: a scripted prompt on an empty document, or a capture of a saved one.
  if (developer) return developerRun(env.LEMON_OPEN);
  const files = [...pending, ...designFiles(process.argv.slice(1))];
  if (env.LEMON_OPEN) files.push(env.LEMON_OPEN);
  if (files.length) files.forEach((f) => openEditor(f));
  if (!editors.size) showDashboard();
}

function fileListChanged() {
  refreshMenu();
  refreshDashboard();
}

/** LEMON_PROMPT runs the agent on an empty document; LEMON_CAPTURE saves a picture of the window. */
async function developerRun(open: string | undefined) {
  const editor = openEditor(open)!;
  const { win } = editor;
  if (env.LEMON_PROMPT) editor.doc.transact(() => nodesOf(editor.doc).clear());
  win.webContents.once("did-finish-load", async () => {
    log("window loaded");
    if (env.LEMON_PROMPT) {
      const stats = await editor.runAgent(env.LEMON_PROMPT);
      console.log(JSON.stringify({ ok: stats.ok, seconds: Math.round(stats.durationMs / 1000), steps: stats.steps.length, reply: stats.reply }));
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

app.on("window-all-closed", () => app.quit());
main().catch((e) => {
  console.error(e);
  app.exit(1);
});
