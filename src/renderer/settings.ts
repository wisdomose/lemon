// App settings. Defaults follow the reference install as captured; stored in the window's local storage
// (STOPGAP: the PRD's stack keeps settings in the main process with electron-store, so all windows
// share them; move there when there is more than one window).
import { useSyncExternalStore } from "react";

export interface Settings {
  theme: "light" | "dark";
  animations: boolean;
  pixelGrid: boolean;
  snapToPixels: boolean;
  snapToObjects: boolean;
  wheelZooms: boolean;
  invertZoom: boolean;
  nudgeSmall: number;
  nudgeBig: number;
  htmlMetadata: boolean;
  chatTextSize: "small" | "medium" | "large";
  cursorSize: "small" | "medium" | "large";
  cursorLabel: boolean;
  notifyWhenDone: boolean;
  /** The prompt starter at the top of the Dashboard. */
  dashboardPrompt: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  animations: true,
  pixelGrid: true,
  snapToPixels: true,
  snapToObjects: true,
  wheelZooms: false,
  invertZoom: false,
  nudgeSmall: 1,
  nudgeBig: 10,
  htmlMetadata: true,
  chatTextSize: "small",
  cursorSize: "medium",
  cursorLabel: true,
  notifyWhenDone: true,
  dashboardPrompt: true,
};

const KEY = "settings";
let current: Settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>) };
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  current = { ...current, [key]: value };
  localStorage.setItem(KEY, JSON.stringify(current));
  applyTheme();
  listeners.forEach((l) => l());
}

// Another window (the Dashboard, or another file) changed a setting.
addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  current = { ...DEFAULT_SETTINGS, ...(JSON.parse(e.newValue ?? "{}") as Partial<Settings>) };
  applyTheme();
  listeners.forEach((l) => l());
});

/**
 * View › Agent Chat Text Size scales the agent's panel: Medium and Large are a point and two points up
 * from Small (12px), as Pen's appear.
 */
export const CHAT_ZOOM: Record<Settings["chatTextSize"], number> = { small: 1, medium: 13 / 12, large: 14 / 12 };

/** Menu commands every page carries out the same way (settings it shares); whether `command` was one. */
export function sharedCommand(command: string): boolean {
  if (command === "toggle-theme") setSetting("theme", current.theme === "dark" ? "light" : "dark");
  else if (command === "chat-small" || command === "chat-medium" || command === "chat-large") setSetting("chatTextSize", command.slice(5) as Settings["chatTextSize"]);
  else return false;
  return true;
}

/** The menu bar shows the chat text size checked: it is told whenever it changes. */
function tellMenu(): void {
  window.lemon?.menuState({ chatTextSize: current.chatTextSize });
}
listeners.add(tellMenu);
tellMenu();

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

/**
 * Puts the chosen theme on the document root (the tokens in theme.css switch on `.dark`). A page marked
 * `data-always-dark` (the Dashboard) stays dark.
 */
export function applyTheme(): void {
  const root = document.documentElement;
  root.classList.toggle("dark", current.theme === "dark" || "alwaysDark" in root.dataset);
}
