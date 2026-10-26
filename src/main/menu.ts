// The native menu bar (PRD "Native menu bar"; items not built yet are left out). File actions run here;
// editing actions go to the focused window, which already handles their keys (so those shortcuts are
// shown but not registered twice).
import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { basename } from "node:path";
import { PRODUCT } from "../product.js";
import { recents } from "./files.js";

/** Commands a window carries out (renderer/menu-commands). */
export type WindowCommand = "undo" | "redo" | "delete" | "select-all" | "settings" | "toggle-ui";

export interface MenuActions {
  newFile(): void;
  dashboard(): void;
  open(): void;
  openPath(path: string): void;
  clearRecents(): void;
  save(): void;
  saveAs(): void;
  toWindow(command: WindowCommand): void;
}

export function buildMenu(a: MenuActions): void {
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  const recent = recents();
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "New File", accelerator: "CmdOrCtrl+Shift+N", click: a.newFile },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: a.open },
        {
          label: "Open Recent",
          submenu: [
            ...recent.map((r) => ({ label: basename(r.path), sublabel: r.path, click: () => a.openPath(r.path) })),
            ...(recent.length ? [{ type: "separator" as const }] : []),
            { label: "Clear Recently Opened", enabled: recent.length > 0, click: a.clearRecents },
          ],
        },
        { label: "Dashboard", accelerator: "CmdOrCtrl+N", click: a.dashboard },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: a.save },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: a.saveAs },
        { type: "separator" },
        { label: "Settings…", ...shown("CmdOrCtrl+,"), click: () => a.toWindow("settings") },
        { type: "separator" },
        { label: "Close", role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", ...shown("CmdOrCtrl+Z"), click: () => a.toWindow("undo") },
        { label: "Redo", ...shown("CmdOrCtrl+Shift+Z"), click: () => a.toWindow("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { label: "Delete", ...shown("Delete"), click: () => a.toWindow("delete") },
        { label: "Select All", ...shown("CmdOrCtrl+A"), click: () => a.toWindow("select-all") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Show/Hide UI", ...shown("CmdOrCtrl+\\"), click: () => a.toWindow("toggle-ui") },
        { role: "togglefullscreen", label: "Toggle Full Screen" },
        ...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "toggleDevTools" as const }]),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize", accelerator: "CmdOrCtrl+M" }, { role: "zoom" }, { type: "separator" }, { role: "close" }],
    },
    { label: "Help", submenu: [{ label: `About ${PRODUCT.name}`, click: () => app.showAboutPanel() }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
