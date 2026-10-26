// Off-screen pictures of a node, for the agent to look at (and for reports).
import type { CanvasKit } from "canvaskit-wasm";
import type { Assets } from "../doc/assets.js";
import type { TreeNode, Vars } from "../doc/schema.js";
import type { Boxes } from "../layout/layout.js";
import type { TextEngine } from "../text/paragraph.js";
import { drawNode } from "./draw.js";

export function findNode(root: TreeNode, id: string): TreeNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return undefined;
}

export interface Picture {
  png: Uint8Array;
  width: number;
  height: number;
  scale: number;
}

/**
 * Renders node `id` to PNG. The longest side is scaled down to `maxSide` (vision models read about
 * 1,500px well); `scale` reports the factor so coordinates can be mapped back.
 */
export function screenshot(
  ck: CanvasKit,
  page: TreeNode,
  boxes: Boxes,
  vars: Vars,
  text: TextEngine,
  assets: Assets,
  id: string,
  maxSide = 1568,
): Picture {
  const node = findNode(page, id);
  const box = boxes.get(id);
  if (!node || !box) throw new Error(`No node with id "${id}" to screenshot.`);
  const scale = Math.min(2, maxSide / Math.max(box.w, box.h, 1));
  const width = Math.max(1, Math.round(box.w * scale));
  const height = Math.max(1, Math.round(box.h * scale));
  const surface = ck.MakeSurface(width, height);
  if (!surface) throw new Error("Could not create a drawing surface.");
  try {
    const canvas = surface.getCanvas();
    canvas.clear(ck.WHITE);
    canvas.scale(scale, scale);
    canvas.translate(-box.x, -box.y);
    drawNode({ ck, text, vars, boxes, assets }, canvas, node);
    const image = surface.makeImageSnapshot();
    const png = image.encodeToBytes();
    image.delete();
    if (!png) throw new Error("Could not encode the picture.");
    return { png, width, height, scale };
  } finally {
    surface.delete();
  }
}
