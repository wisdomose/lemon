// Electron's main process: owns the document, the fonts and the agent. Windows show the document and
// receive every change as a Yjs update.
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { newFile } from "../doc/store.js";
import { PersonChange, REPAIR, agentClientId, repairTree } from "../doc/live.js";
import { PRODUCT } from "../product.js";
import { createEngine } from "../engine.js";
import { GoogleFonts } from "../text/google-fonts.js";
import { Sandbox } from "../sandbox/sandbox.js";
import { AGENT_NAME } from "../agent/models.js";
import { runAgent } from "../agent/agent.js";
import type { FontFace } from "../text/fonts.js";

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

const log = (msg: string) => env.LEMON_LOG && appendFileSync(env.LEMON_LOG, `${new Date().toISOString().slice(11, 23)} ${msg}\n`);
const doc = new Y.Doc();
// Agents write to this copy directly, statement by statement: it loses same-moment ties to people (doc/live.ts).
doc.clientID = agentClientId();
if (env.LEMON_OPEN) Y.applyUpdate(doc, readFileSync(env.LEMON_OPEN));
else if (!env.LEMON_PROMPT) newFile(doc);

async function main() {
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

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: PRODUCT.name,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: join(import.meta.dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  log("window created");
  if (env.LEMON_LOG) {
    win.webContents.on("did-start-loading", () => log("window loading"));
    win.webContents.on("dom-ready", () => log("window dom ready"));
    win.webContents.on("console-message", (e) => log(`[window] ${e.level}: ${e.message}`));
    win.webContents.on("did-fail-load", (_e, code, desc) => log(`[window] failed to load: ${code} ${desc}`));
    win.webContents.on("render-process-gone", (_e, d) => log(`[window] gone: ${d.reason}`));
  }

  // The window's changes carry its own origin, so they are not echoed back and agents can tell
  // them apart (see doc/live.ts).
  const FROM_WINDOW = new PersonChange(win.id);
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== FROM_WINDOW && !win.isDestroyed()) win.webContents.send("doc:update", update);
    // Concurrent edits can leave nodes inside a deleted frame, or two frames inside each other.
    if (origin !== REPAIR) repairTree(doc);
  });
  ipcMain.on("doc:push", (_e, update: Uint8Array) => Y.applyUpdate(doc, update, FROM_WINDOW));

  ipcMain.handle("doc:state", () => Y.encodeStateAsUpdate(doc));
  ipcMain.handle("fonts:catalogue", () => fonts.catalogue.families);
  ipcMain.handle("fonts:load", (_e, face: FontFace) => fonts.load(face));

  let running: AbortController | undefined;
  const run = async (prompt: string, model?: string) => {
    running?.abort();
    running = new AbortController();
    const stats = await runAgent({
      doc,
      engine,
      sandbox,
      prompt,
      ...(model ? { model } : {}),
      name: AGENT_NAME,
      signal: running.signal,
      onEvent: (e) => {
        if (win.isDestroyed()) return;
        win.webContents.send("agent:event", e);
        if (e.type !== "step-target" && e.type !== "step-progress") log(`agent ${e.type}${"step" in e ? ` ${e.step.index} ${e.step.title}` : "title" in e ? ` ${e.index} ${e.title}` : ""}`);
        if (env.LEMON_FILM && e.type === "step-end") {
          const n = String(e.step.index).padStart(2, "0");
          setTimeout(() => win.webContents.capturePage().then((img) => writeFileSync(join(env.LEMON_FILM!, `step-${n}.png`), img.toPNG())), 600);
        }
      },
    });
    running = undefined;
    return stats;
  };
  ipcMain.handle("agent:run", (_e, prompt: string, model?: string) => run(prompt, model));
  ipcMain.handle("agent:stop", () => running?.abort());
  ipcMain.handle("claude:status", () => claudeStatus());

  const capture = async () => {
    if (!env.LEMON_CAPTURE) return;
    // Wait until the window has drawn (it marks <body data-ready>), then a moment for the last change.
    for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript("!!document.body.dataset.ready")); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const image = await win.webContents.capturePage();
    writeFileSync(env.LEMON_CAPTURE, image.toPNG());
    if (env.LEMON_OPEN) writeFileSync(env.LEMON_CAPTURE.replace(/\.png$/, ".yjs"), Y.encodeStateAsUpdate(doc));
    app.quit();
  };

  win.webContents.once("did-finish-load", async () => {
    log("window loaded");
    if (env.LEMON_PROMPT) {
      const stats = await run(env.LEMON_PROMPT);
      console.log(JSON.stringify({ ok: stats.ok, seconds: Math.round(stats.durationMs / 1000), steps: stats.steps.length, reply: stats.reply }));
      if (env.LEMON_CAPTURE) writeFileSync(env.LEMON_CAPTURE.replace(/\.png$/, ".yjs"), Y.encodeStateAsUpdate(doc));
    }
    await capture();
  });

  // `pnpm dev` (electron-vite) serves the window live and passes its address.
  const devUrl = !app.isPackaged ? env.ELECTRON_RENDERER_URL : undefined;
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadURL(`${UI_SCHEME}://ui/index.html`);
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
