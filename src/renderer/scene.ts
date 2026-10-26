// The window's connection to the document and the drawing engine, set up once before the UI renders.
import * as Y from "yjs";
import wasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";
import selawik400 from "./ui-fonts/selawk.ttf?url";
import selawik600 from "./ui-fonts/selawksb.ttf?url";
import { createEngine, type Engine } from "../engine.js";
import { getVars, toTree } from "../doc/store.js";
import { PERSON_EDIT, personClientId, personUndo, reconcileSelection } from "../doc/live.js";
import { layout, type Boxes } from "../layout/layout.js";
import { DEFAULT_FONT, FontsNeeded } from "../text/fonts.js";
import type { TreeNode, Vars } from "../doc/schema.js";
import { browserBridge } from "./bridge.js";
import { store } from "./store.js";

export const bridge = window.lemon ?? browserBridge();
export const doc = new Y.Doc();
// A person's copy: wins same-moment ties with an agent (see doc/live.ts).
doc.clientID = personClientId();
export let engine: Engine;
/** The person's own undo history (Ctrl+Z); agents' changes are never in it. */
export const history = personUndo(doc);

/** The UI font family on the canvas (frame names, size pills, cursor labels): Segoe UI's open twin. */
export const CANVAS_UI_FONT = "Selawik";

/** Changes the document from this window (one undo step, sent to the host). */
export function edit(fn: () => void): void {
  doc.transact(fn, PERSON_EDIT);
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
    if (origin === PERSON_EDIT || origin === history) bridge.pushDocUpdate(update);
    stale = true;
    // Someone (an agent, or this person's undo) may have deleted what is selected or hovered.
    store.set((s) => ({
      docVersion: s.docVersion + 1,
      selection: s.selection.filter((id) => reconcileSelection(doc, id)),
      hover: reconcileSelection(doc, s.hover),
    }));
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
        // Panels that show the document re-read it now that it can be laid out.
        store.set((st) => ({ docVersion: st.docVersion + 1 }));
      });
    }
  }
  return scene;
}

/** Resolves once the document can be laid out (its fonts are loaded). */
export async function laidOut(): Promise<Scene> {
  for (;;) {
    // While fonts load, currentScene returns the previous scene (if any) and calls `ready` once they
    // have loaded; only a fresh layout ends the wait.
    let ready!: () => void;
    const fontsLoaded = new Promise<void>((r) => (ready = r));
    const s = currentScene(ready);
    if (s && !stale) return s;
    await fontsLoaded;
  }
}
