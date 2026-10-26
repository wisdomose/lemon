// The Dashboard window (PRD "Dashboard window"): the start window with the prompt starter and the
// Recents and Drafts. There is one; it has a fixed size and can't be maximised, and it is always dark.
import { BrowserWindow } from "electron";
import { dashboardFiles } from "./files.js";

/** The window's outer size, as Pen's (capture 01). */
const SIZE = { width: 1426, height: 953 };

let win: BrowserWindow | null = null;

export const dashboardWindow = () => win;

/** Opens the Dashboard, or brings it to the front. */
export function openDashboard(opts: { url: string; preload: string }): BrowserWindow {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    return win;
  }
  const w = new BrowserWindow({
    ...SIZE,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Dashboard",
    backgroundColor: "#141414",
    webPreferences: { preload: opts.preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // The page's own title would replace "Dashboard" with the product's name.
  w.on("page-title-updated", (e) => e.preventDefault());
  w.on("closed", () => (win = null));
  void w.loadURL(opts.url);
  win = w;
  return w;
}

/** Tells the Dashboard its lists changed. */
export function refreshDashboard(): void {
  if (win && !win.isDestroyed()) win.webContents.send("dashboard:files", dashboardFiles());
}
