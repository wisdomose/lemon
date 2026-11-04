// What a change repaints (src/render/damage.ts) and which tiles that marks (src/renderer/canvas/tiles.ts).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { IncrementalTree, changedRecords } from "../src/doc/incremental.js";
import { layout, type Box, type LayoutReuse } from "../src/layout/layout.js";
import { damage, overlaps, paintedBounds, sceneBounds, type BoundsCache } from "../src/render/damage.js";
import { TILE, Tiles, tileRange, tileRect } from "../src/renderer/canvas/tiles.js";
import { ROOT_ID, type TreeNode } from "../src/doc/schema.js";
import { setup } from "./helpers.js";

/** A document whose scenes are built as the editor builds them. */
async function editor() {
  const { engine } = await setup();
  const doc = new Y.Doc();
  const tree = new IncrementalTree(doc);
  const reuse: LayoutReuse = new WeakMap();
  doc.on("afterTransaction", (tr: Y.Transaction) => tree.mark(changedRecords(doc, tr)));
  const cache: BoundsCache = new WeakMap();
  const scene = () => {
    const t = tree.build();
    const vars = store.getVars(doc);
    const s = { tree: t, vars, boxes: layout(t, vars, engine.text, reuse) };
    return { ...s, bounds: sceneBounds(s, cache, engine.text) };
  };
  const change = (fn: () => void) => {
    const a = scene();
    doc.transact(fn);
    const b = scene();
    return damage(a, a.bounds, b, b.bounds);
  };
  return { doc, scene, change };
}
const covers = (rects: Box[], b: Box) => rects.some((r) => r.x <= b.x && r.y <= b.y && r.x + r.w >= b.x + b.w && r.y + r.h >= b.y + b.h);

describe("damage", () => {
  it("is where a changed node was and is, and nothing elsewhere", async () => {
    const { doc, change } = await editor();
    const a = store.insert(doc, ROOT_ID, { type: "frame", name: "A", x: 0, y: 0, width: 200, height: 200, layout: "none" });
    const r = store.insert(doc, a, { type: "rectangle", x: 10, y: 10, width: 20, height: 20, fill: "#ff0000" });
    store.insert(doc, ROOT_ID, { type: "frame", name: "B", x: 1000, y: 0, width: 200, height: 200 });
    const moved = change(() => store.update(doc, r, { x: 100 }));
    expect(covers(moved, { x: 10, y: 10, w: 20, h: 20 })).toBe(true);
    expect(covers(moved, { x: 100, y: 10, w: 20, h: 20 })).toBe(true);
    // Nothing near frame B, and not all of frame A.
    expect(moved.some((d) => overlaps(d, { x: 1000, y: 0, w: 200, h: 200 }))).toBe(false);
    expect(moved.every((d) => d.w < 100)).toBe(true);
  });

  it("is nothing when nothing changed, and all of a frame added or removed", async () => {
    const { doc, change } = await editor();
    store.insert(doc, ROOT_ID, { type: "frame", name: "A", width: 50, height: 50 });
    expect(change(() => {})).toEqual([]);
    let b = "";
    const added = change(() => (b = store.insert(doc, ROOT_ID, { type: "frame", name: "B", x: 300, y: 0, width: 80, height: 60, fill: "#000000" })));
    expect(covers(added, { x: 300, y: 0, w: 80, h: 60 })).toBe(true);
    const removed = change(() => store.remove(doc, b));
    expect(covers(removed, { x: 300, y: 0, w: 80, h: 60 })).toBe(true);
  });

  it("follows the layout: a child that grows moves its siblings in a column", async () => {
    const { doc, change } = await editor();
    const col = store.insert(doc, ROOT_ID, { type: "frame", name: "Col", layout: "vertical", width: 100 });
    const first = store.insert(doc, col, { type: "rectangle", width: 100, height: 20 });
    store.insert(doc, col, { type: "rectangle", width: 100, height: 20, fill: "#00ff00" });
    const d = change(() => store.update(doc, first, { height: 50 }));
    // The second rectangle went from y 20..40 to 50..70: both places repaint.
    expect(covers(d, { x: 0, y: 20, w: 100, h: 20 })).toBe(true);
    expect(covers(d, { x: 0, y: 50, w: 100, h: 20 })).toBe(true);
  });

  it("takes a changed parent's children with it (its opacity reaches them)", async () => {
    const { doc, change } = await editor();
    const f = store.insert(doc, ROOT_ID, { type: "frame", name: "F", width: 100, height: 100, layout: "none" });
    store.insert(doc, f, { type: "rectangle", x: 150, y: 0, width: 30, height: 30, fill: "#000000" });
    const d = change(() => store.update(doc, f, { opacity: 0.5 }));
    expect(covers(d, { x: 150, y: 0, w: 30, h: 30 })).toBe(true);
  });

  it("repaints all of something that reads what is behind it when damage is under it", async () => {
    const { doc, change } = await editor();
    const r = store.insert(doc, ROOT_ID, { type: "rectangle", name: "Under", x: 0, y: 0, width: 10, height: 10, fill: "#000000" });
    store.insert(doc, ROOT_ID, { type: "rectangle", name: "Glass", x: 0, y: 0, width: 300, height: 300, effect: { type: "background_blur", radius: 10 } });
    const d = change(() => store.update(doc, r, { fill: "#ffffff" }));
    expect(covers(d, { x: 0, y: 0, w: 300, h: 300 })).toBe(true);
  });

  it("counts strokes, shadows and turns in a node's painted bounds", () => {
    const node: TreeNode = { id: "r", type: "rectangle", props: { stroke: "#000000", strokeWidth: 4, effect: { type: "shadow", blur: 10, offset: { x: 0, y: 20 } } }, children: [] };
    const page: TreeNode = { id: ROOT_ID, type: "frame", props: {}, children: [node] };
    const b = paintedBounds(page, new Map([["r", { x: 100, y: 100, w: 50, h: 50 }]]), {}).own.get("r")!;
    expect(b.y + b.h).toBeGreaterThanOrEqual(150 + 20 + 15); // the shadow's offset and blur
    expect(b.x).toBeLessThanOrEqual(100 - 4);
    const turned: TreeNode = { id: "t", type: "rectangle", props: { rotation: 90 }, children: [] };
    const t = paintedBounds({ ...page, children: [turned] }, new Map([["t", { x: 0, y: 0, w: 100, h: 10 }]]), {}).own.get("t")!;
    // Turned a quarter counter-clockwise about its top-left: now 10 wide, 100 tall, above the corner.
    expect(t.w).toBeLessThan(20);
    expect(t.h).toBeGreaterThan(100);
    expect(t.y).toBeLessThan(-90);
  });
});

describe("tiles", () => {
  const made: string[] = [];
  const tiles = () => {
    const released: string[] = [];
    return { t: new Tiles<string>((i) => released.push(i), 50), released };
  };

  it("cover a page rect at a zoom, 128 device pixels each", () => {
    expect(tileRange({ x: 0, y: 0, w: 128, h: 128 }, 1)).toEqual({ i0: 0, i1: 0, j0: 0, j1: 0 });
    expect(tileRange({ x: 0, y: 0, w: 129, h: 64 }, 1)).toEqual({ i0: 0, i1: 1, j0: 0, j1: 0 });
    // At 2× a tile covers 64 page units; negative coordinates round down.
    expect(tileRange({ x: -10, y: 70, w: 20, h: 10 }, 2)).toEqual({ i0: -1, i1: 0, j0: 1, j1: 1 });
    expect(tileRect(3, -2, 0.5)).toEqual({ x: 3 * TILE * 2, y: -2 * TILE * 2, w: TILE * 2, h: TILE * 2 });
  });

  it("are painted once, then again only under damage", () => {
    const { t } = tiles();
    t.begin();
    const view = t.inView({ x: 0, y: 0, w: 512, h: 256 }, 1);
    expect(view).toHaveLength(8);
    expect(t.toPaint(view)).toHaveLength(8);
    for (const tile of view) t.painted(tile, `${tile.i},${tile.j}`);
    expect(t.toPaint(view)).toHaveLength(0);
    // A change at (130..140, 10..20) damages one tile only.
    t.invalidate([{ x: 130, y: 10, w: 10, h: 10 }]);
    expect(t.toPaint(view).map((x) => [x.i, x.j])).toEqual([[1, 0]]);
    // A change across a tile corner damages the four around it.
    t.invalidate([{ x: 250, y: 120, w: 10, h: 10 }]);
    expect(t.toPaint(view).map((x) => `${x.i},${x.j}`).sort()).toEqual(["1,0", "1,1", "2,0", "2,1"]);
    void made;
  });

  it("keep showing the old picture until the view is ready, or 32 ms have passed", () => {
    const { t, released } = tiles();
    t.begin();
    const view = t.inView({ x: 0, y: 0, w: 256, h: 128 }, 1);
    view.forEach((x) => t.painted(x, `old ${x.i}`));
    t.commit(view, 0);
    t.invalidate([{ x: 0, y: 0, w: 256, h: 10 }], 100);
    t.painted(view[0]!, "new 0");
    // One of two repainted: the old pictures stay up.
    expect(t.commit(view, 110)).toBe(true);
    expect(view.map((x) => x.image)).toEqual(["old 0", "old 1"]);
    // The rest painted: both new ones show together.
    t.painted(view[1]!, "new 1");
    expect(t.commit(view, 112)).toBe(false);
    expect(view.map((x) => x.image)).toEqual(["new 0", "new 1"]);
    expect(released).toEqual(["old 0", "old 1"]);
    // Too slow: after 32 ms what is ready shows anyway.
    t.invalidate([{ x: 0, y: 0, w: 256, h: 10 }], 200);
    t.painted(view[0]!, "newer 0");
    expect(t.commit(view, 220)).toBe(true);
    expect(t.commit(view, 233)).toBe(false);
    expect(view[0]!.image).toBe("newer 0");
  });

  it("are kept per zoom, another zoom's standing in while this one paints", () => {
    const { t } = tiles();
    t.begin();
    const at1 = t.inView({ x: 0, y: 0, w: 256, h: 256 }, 1);
    at1.forEach((x) => t.painted(x, `z1 ${x.i},${x.j}`));
    t.begin();
    // Zoomed to 2×: a tile there covers a quarter of a 1× tile, which stands in.
    const at2 = t.inView({ x: 0, y: 0, w: 128, h: 128 }, 2);
    expect(at2.every((x) => x.image === undefined)).toBe(true);
    expect(t.standIns(tileRect(1, 1, 2), 2).map((s) => s.tile.image)).toEqual(["z1 0,0"]);
    // Damage reaches every zoom.
    t.invalidate([{ x: 0, y: 0, w: 1, h: 1 }]);
    expect(at1[0]!.dirty).toBe(true);
  });

  it("let go of the least recently used tiles over the limit, never those in view", () => {
    const { t, released } = tiles();
    for (let k = 0; k < 10; k++) {
      t.begin();
      const view = t.inView({ x: k * 1280, y: 0, w: 1280, h: 128 }, 1);
      view.forEach((x) => t.painted(x, `${k}:${x.i}`));
      t.evict();
    }
    expect(t.size).toBeLessThanOrEqual(50);
    // The last view (10 tiles) is all there; the first went first.
    expect(released.some((r) => r.startsWith("0:"))).toBe(true);
    expect(released.some((r) => r.startsWith("9:"))).toBe(false);
  });
});
