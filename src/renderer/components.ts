// What a person does with components in the window: make one (Ctrl+Alt+K), detach a copy
// (Ctrl+Alt+X), stop a main being a component, go to a copy's main, and place a copy from the
// Components panel. The rules (what a copy is, what can change in one) are in doc/store.ts.
import * as docStore from "../doc/store.js";
import { ROOT_ID, type TreeNode } from "../doc/schema.js";
import { zoomToFit } from "./canvas/canvas.js";
import { flowSlot, flows, frameAt } from "./canvas/place.js";
import { currentScene, doc, edit } from "./scene.js";
import { store } from "./store.js";

/** How a node shows on the canvas: a main component (magenta), a copy or part of one (violet), or plain. */
export type Kind = "main" | "instance" | "part" | null;

export function kindOf(node: TreeNode | undefined): Kind {
  if (!node) return null;
  if (node.instance) return "instance";
  if (docStore.isPart(node.id)) return "part";
  return node.props.component ? "main" : null;
}

/** Main components, magenta (capture 38); copies, violet with a dashed outline (capture 39). */
export const MAIN_COLOUR = "#d480ff";
export const COPY_COLOUR = "#9580ff";

/** Makes each selected node a main component (copies inside copies can't be). */
export function makeComponents(): void {
  const ids = store.get().selection.filter((id) => !docStore.isPart(id) && docStore.exists(doc, id) && !docStore.propsOf(doc, id).component);
  if (ids.length) edit(() => ids.forEach((id) => docStore.update(doc, id, { component: true })));
}

/** Detaches each selected copy into ordinary nodes. */
export function detachSelected(): void {
  const ids = store.get().selection.filter((id) => !docStore.isPart(id) && docStore.isInstance(doc, id));
  if (ids.length) edit(() => ids.forEach((id) => docStore.detach(doc, id)));
}

/** A main stops being a component; its copies become ordinary nodes. */
export function unmakeComponent(id: string): void {
  edit(() => docStore.update(doc, id, { component: null } as never));
}

/** Selects a copy's main component and brings it into view. */
export function goToMain(id: string): void {
  const main = docStore.mainOf(doc, id);
  if (main) reveal(main);
}

/** Selects a node and brings it into view. */
export function reveal(id: string): void {
  const box = currentScene()?.boxes.get(id);
  store.set({ selection: [id] });
  if (box) zoomToFit(true, box);
}

/** The drag data for placing a copy of a main component on the canvas (from the Components panel). */
export const COMPONENT_DRAG = "application/x-lemon-component";

/** Every main component on the page, in layer order. */
export function mainComponents(tree: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (n.props.component && !docStore.isPart(n.id)) out.push(n);
    // Copies' parts are the main's own nodes again: not listed twice.
    if (!n.instance) n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

/** Places a copy of `main` at page point (x, y): in the frame there (at that place in a row or column), or on the page. */
export function placeCopy(main: string, x: number, y: number): void {
  const s = currentScene();
  if (!s) return;
  const container = frameAt(s, x, y);
  let id = "";
  try {
    edit(() => {
      if (flows(container)) id = docStore.insert(doc, container.id, { type: "instance", of: main }, flowSlot(s, container, x, y).index);
      else {
        const cb = container.id === ROOT_ID ? { x: 0, y: 0 } : s.boxes.get(container.id)!;
        id = docStore.insert(doc, container.id, { type: "instance", of: main, x: Math.round(x - cb.x), y: Math.round(y - cb.y) });
      }
    });
  } catch (e) {
    // A component dropped inside itself.
    if (e instanceof docStore.DocError) return;
    throw e;
  }
  store.set({ selection: [id] });
}
