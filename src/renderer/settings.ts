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
  chatTextSize: "medium",
  cursorSize: "medium",
  cursorLabel: true,
  notifyWhenDone: true,
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

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

/** Puts the chosen theme on the document root (the tokens in theme.css switch on `.dark`). */
export function applyTheme(): void {
  document.documentElement.classList.toggle("dark", current.theme === "dark");
}
