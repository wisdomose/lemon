// The pictures of this file's live browser pages (main/browser-pages.ts), kept from the changed parts
// the host sends, for drawing inside their browser nodes.
import type { Image } from "canvaskit-wasm";
import { bridge, engine } from "../scene.js";

interface Held {
  width: number;
  height: number;
  /** BGRA, premultiplied, as the host renders them. */
  pixels: Uint8Array;
  image?: Image;
  stale: boolean;
}

const held = new Map<string, Held>();
/** The page cursors, by browser node (Electron's names). */
const cursors = new Map<string, string>();

/** Bumped whenever a page's picture changes, so the recorded document is drawn again. */
export let pagesVersion = 0;

/** Starts taking the host's frames; `changed` redraws the canvas. */
export function startLivePages(changed: () => void): void {
  bridge.browser.onFrame((id, f) => {
    let h = held.get(id);
    if (!h || h.width !== f.width || h.height !== f.height) {
      h?.image?.delete();
      h = { width: f.width, height: f.height, pixels: new Uint8Array(f.width * f.height * 4), stale: true };
      held.set(id, h);
      // A new or resized page needs its whole picture, not just what changed.
      if (f.w !== f.width || f.h !== f.height) bridge.browser.repaint();
    }
    const row = f.w * 4;
    for (let r = 0; r < f.h; r++) h.pixels.set(f.pixels.subarray(r * row, (r + 1) * row), ((f.y + r) * h.width + f.x) * 4);
    h.stale = true;
    pagesVersion++;
    changed();
  });
  bridge.browser.onClosed((id) => {
    held.get(id)?.image?.delete();
    held.delete(id);
    cursors.delete(id);
    pagesVersion++;
    changed();
  });
  bridge.browser.onCursor((id, cursor) => cursors.set(id, cursor));
  // Pictures sent before this tab listened are lost: ask for them again.
  bridge.browser.repaint();
}

/** A browser node's page as it looks now, if it has one. */
export function pageImage(id: string): Image | undefined {
  const h = held.get(id);
  if (!h) return undefined;
  if (h.stale) {
    const { ck } = engine;
    h.image?.delete();
    h.image =
      ck.MakeImage({ width: h.width, height: h.height, alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.BGRA_8888, colorSpace: ck.ColorSpace.SRGB }, h.pixels, h.width * 4) ??
      undefined;
    h.stale = false;
  }
  return h.image;
}

/** The pointer over a page in use, as CSS names it. */
export function pageCursor(id: string): string {
  const c = cursors.get(id) ?? "default";
  return c === "hand" ? "pointer" : c === "ibeam" ? "text" : c;
}

/** DOM key names → Electron's, for keys that aren't a single character. */
const KEYS: Record<string, string> = {
  Enter: "Enter",
  Backspace: "Backspace",
  Tab: "Tab",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  " ": "Space",
};

/** Sends a key to a page in use (a character also arrives as typed text). */
export function pageKey(id: string, e: KeyboardEvent, type: "keyDown" | "keyUp"): void {
  const modifiers = [e.shiftKey && "shift", e.ctrlKey && "control", e.altKey && "alt", e.metaKey && "meta"].filter((m): m is string => !!m);
  const keyCode = KEYS[e.key] ?? (e.key.length === 1 ? e.key : undefined);
  if (!keyCode) return;
  bridge.browser.input(id, { type, keyCode, modifiers });
  if (type === "keyDown" && e.key.length === 1 && !e.ctrlKey && !e.metaKey) bridge.browser.input(id, { type: "char", keyCode: e.key, modifiers });
}
