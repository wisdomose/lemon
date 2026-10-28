// The native menu bar, as Pen's (File, Edit, View, Window, Help), item for item. File and Window
// actions run here; editing actions go to the tab shown, which already handles their keys (so those
// shortcuts are shown but not registered twice). Items Lemon can't do yet are there but greyed out;
// Help keeps only what Lemon has (Pen's other Help items open Pen's own sites).
import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { basename } from "node:path";
import { PRODUCT } from "../product.js";
import { recents } from "./files.js";

/** Commands the tab shown carries out (renderer/App.tsx). */
export type WindowCommand =
  | "undo"
  | "redo"
  | "delete"
  | "select-all"
  | "settings"
  | "toggle-ui"
  | "toggle-theme"
  | "chat-small"
  | "chat-medium"
  | "chat-large"
  | "export-png"
  | "export-jpeg"
  | "export-webp";

/** File commands a tab can ask for (the command palette), as the menu runs them. */
export type AppCommand = "home" | "new-file" | "open" | "save" | "save-as" | "close-tab";

/** What the menu shows checked: the window tells it (its settings live there). */
export interface MenuState {
  chatTextSize: "small" | "medium" | "large";
}

export interface MenuActions {
  newFile(): void;
  home(): void;
  open(): void;
  openPath(path: string): void;
  clearRecents(): void;
  save(): void;
  saveAs(): void;
  closeTab(): void;
  /** Show the tab before (-1) or after (1) the one shown; Home counts as the first. */
  stepTab(by: -1 | 1): void;
  /** Move the file tab shown one place left (-1) or right (1). */
  moveTab(by: -1 | 1): void;
  toWindow(command: WindowCommand): void;
}

export function buildMenu(a: MenuActions, state: MenuState): void {
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  const notYet = { enabled: false } as const;
  const recent = recents();
  const size = (s: MenuState["chatTextSize"], label: string, command: WindowCommand): MenuItemConstructorOptions => ({
    label,
    type: "radio",
    checked: state.chatTextSize === s,
    click: () => a.toWindow(command),
  });
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
            { label: "Clear Recent Files", enabled: recent.length > 0, click: a.clearRecents },
          ],
        },
        { label: "Home", accelerator: "CmdOrCtrl+N", click: a.home },
        { type: "separator" },
        { label: "Import Image/SVG/Figma…", ...notYet },
        {
          label: "Export Selection to…",
          submenu: [
            { label: "PDF", ...notYet },
            { label: "PNG", click: () => a.toWindow("export-png") },
            { label: "JPEG", click: () => a.toWindow("export-jpeg") },
            { label: "WebP", click: () => a.toWindow("export-webp") },
          ],
        },
        { label: "Export Snapshot…", ...notYet },
        { type: "separator" },
        { label: "Guide: How to Export Design to Code…", ...notYet },
        { label: "Guide: How to Import from Figma…", ...notYet },
        { type: "separator" },
        { label: `Install '${PRODUCT.slug}' CLI…`, ...notYet },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: a.save },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: a.saveAs },
        { type: "separator" },
        { label: "Settings…", ...shown("CmdOrCtrl+,"), click: () => a.toWindow("settings") },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: a.closeTab },
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
        // Pen shows no key for Delete.
        { label: "Delete", click: () => a.toWindow("delete") },
        { type: "separator" },
        { label: "Select All", ...shown("CmdOrCtrl+A"), click: () => a.toWindow("select-all") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Show/Hide UI", ...shown("CmdOrCtrl+\\"), click: () => a.toWindow("toggle-ui") },
        {
          label: "Agent Chat Text Size",
          submenu: [size("small", "Small", "chat-small"), size("medium", "Medium", "chat-medium"), size("large", "Large", "chat-large")],
        },
        { type: "separator" },
        { role: "togglefullscreen", label: "Toggle Full Screen", accelerator: "F11" },
        ...(app.isPackaged ? [] : [{ type: "separator" as const }, { role: "toggleDevTools" as const }]),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize", accelerator: "CmdOrCtrl+M" },
        { role: "zoom" },
        { type: "separator" },
        { label: "Toggle Light/Dark Mode", click: () => a.toWindow("toggle-theme") },
        { type: "separator" },
        { label: "Show Previous Tab", accelerator: "CmdOrCtrl+PageUp", click: () => a.stepTab(-1) },
        { label: "Show Next Tab", accelerator: "CmdOrCtrl+PageDown", click: () => a.stepTab(1) },
        { label: "Move Tab Left", accelerator: "CmdOrCtrl+Shift+PageUp", click: () => a.moveTab(-1) },
        { label: "Move Tab Right", accelerator: "CmdOrCtrl+Shift+PageDown", click: () => a.moveTab(1) },
      ],
    },
    { label: "Help", submenu: [{ label: `About ${PRODUCT.name}`, click: () => app.showAboutPanel() }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
