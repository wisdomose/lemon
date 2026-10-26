// A small picture of a whole document, for its card on the Dashboard: everything on the page, fitted
// into the card's picture area with a margin, on a transparent background (the card shows through).
import type * as Y from "yjs";
import { getVars, toTree } from "../doc/store.js";
import { facesUsed, layout } from "../layout/layout.js";
import type { Engine } from "../engine.js";
import { drawNode } from "./draw.js";
import { assetLookup } from "../doc/assets.js";

/** The card's picture area (Dashboard), at twice its size for sharp screens. */
export const THUMB = { width: 546, height: 340, margin: 32 } as const;

/** The document's picture as PNG, or undefined when the page is empty. */
export async function thumbnail(engine: Engine, doc: Y.Doc): Promise<Uint8Array | undefined> {
  const page = toTree(doc);
  const vars = getVars(doc);
  if (!page.children.length) return undefined;
  await engine.fonts.ensure(facesUsed(page, vars));
  const boxes = layout(page, vars, engine.text);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const top of page.children) {
    const b = boxes.get(top.id);
    if (!b || top.props.visible === false) continue;
    x0 = Math.min(x0, b.x), y0 = Math.min(y0, b.y), x1 = Math.max(x1, b.x + b.w), y1 = Math.max(y1, b.y + b.h);
  }
  if (!(x1 > x0 && y1 > y0)) return undefined;
  const { ck } = engine;
  const room = { w: THUMB.width - 2 * THUMB.margin, h: THUMB.height - 2 * THUMB.margin };
  const scale = Math.min(room.w / (x1 - x0), room.h / (y1 - y0), 1);
  const surface = ck.MakeSurface(THUMB.width, THUMB.height);
  if (!surface) return undefined;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(ck.TRANSPARENT);
    canvas.translate((THUMB.width - (x1 - x0) * scale) / 2, (THUMB.height - (y1 - y0) * scale) / 2);
    canvas.scale(scale, scale);
    canvas.translate(-x0, -y0);
    for (const top of page.children) drawNode({ ck, text: engine.text, vars, boxes, assets: assetLookup(doc) }, canvas, top);
    const image = surface.makeImageSnapshot();
    const png = image.encodeToBytes();
    image.delete();
    return png ?? undefined;
  } finally {
    surface.delete();
  }
}
