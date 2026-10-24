// The window's connection to the document and the drawing engine, set up once before the UI renders.
import * as Y from "yjs";
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import selawik400 from "./ui-fonts/selawk.ttf?url";
import selawik600 from "./ui-fonts/selawksb.ttf?url";
import { createEngine, type Engine } from "../engine.js";
import { getVars, toTree } from "../doc/store.js";
import { layout, type Boxes } from "../layout/layout.js";
import { DEFAULT_FONT, FontsNeeded } from "../text/fonts.js";
import type { TreeNode, Vars } from "../doc/schema.js";
import { browserBridge } from "./bridge.js";
import { store } from "./store.js";

export const bridge = window.lemon ?? browserBridge();
export const doc = new Y.Doc();
export let engine: Engine;

/** The UI font family on the canvas (frame names, size pills, cursor labels): Segoe UI's open twin. */
export const CANVAS_UI_FONT = "Selawik";

const LOCAL = "this-window";

/** Changes the document from this window (one undo step, sent to the host). */
export function edit(fn: () => void): void {
  doc.transact(fn, LOCAL);
}

export async function boot(): Promise<void> {
  const catalogue = await bridge.fontCatalogue();
  engine = await createEngine({ styles: (f) => catalogue[f], load: (face) => bridge.loadFont(face) }, () => wasmUrl);
  const [regular, semibold] = await Promise.all([selawik400, selawik600].map((u) => fetch(u).then((r) => r.arrayBuffer())));
  engine.fonts.addLocal({ family: CANVAS_UI_FONT, weight: 400, italic: false }, regular!);
  engine.fonts.addLocal({ family: CANVAS_UI_FONT, weight: 600, italic: false }, semibold!);
  await engine.fonts.ensure([{ family: DEFAULT_FONT, weight: 400, italic: false }]);

  Y.applyUpdate(doc, await bridge.docState());
  bridge.onDocUpdate((u) => Y.applyUpdate(doc, u));
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL) bridge.pushDocUpdate(update);
    stale = true;
    store.set((s) => ({ docVersion: s.docVersion + 1 }));
  });
}

// ---- The laid-out document, recomputed after changes ----------------------------------------------
export interface Scene {
  tree: TreeNode;
  boxes: Boxes;
  vars: Vars;
}
let scene: Scene | undefined;
let stale = true;
let loadingFonts = false;
const waiting = new Set<() => void>();

/** The current scene, or the previous one while fonts for the new one load (`onReady` fires after). */
export function currentScene(onReady?: () => void): Scene | undefined {
  if (!stale) return scene;
  const tree = toTree(doc);
  const vars = getVars(doc);
  try {
    scene = { tree, vars, boxes: layout(tree, vars, engine.text) };
    stale = false;
  } catch (e) {
    if (!(e instanceof FontsNeeded)) throw e;
    if (onReady) waiting.add(onReady);
    if (!loadingFonts) {
      loadingFonts = true;
      engine.fonts.ensure(e.faces).finally(() => {
        loadingFonts = false;
        stale = true;
        waiting.forEach((f) => f());
        waiting.clear();
      });
    }
  }
  return scene;
}
