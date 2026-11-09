// What keeps the window idle while only something on top of the canvas moves (src/renderer/canvas/tiles.ts),
// and how an outside agent's leftover "Generating" frames are turned off (src/agent/placeholders.ts).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { ROOT_ID } from "../src/doc/schema.js";
import { AgentPlaceholders, placeholderIds } from "../src/agent/placeholders.js";
import { Tiles, ViewComposite, type Tile } from "../src/renderer/canvas/tiles.js";

const painted = (tiles: Tiles<string>, view: Tile<string>[], tag: string) => {
  for (const t of tiles.toPaint(view)) tiles.painted(t, `${tag}${t.i},${t.j}`);
  tiles.commit(view, 0);
};

describe("the view's picture", () => {
  it("is put together again only when the view or a tile in it changes", () => {
    const tiles = new Tiles<string>(() => {});
    const composite = new ViewComposite<string>();
    const page = { x: 0, y: 0, w: 512, h: 256 };
    let view = tiles.inView(page, 1);
    painted(tiles, view, "a");
    expect(composite.changed("v1", view)).toBe(true);
    // The same view, the same tiles: the last picture stands.
    view = tiles.inView(page, 1);
    expect(composite.changed("v1", view)).toBe(false);
    // The view moved.
    expect(composite.changed("v2", view)).toBe(true);
    expect(composite.changed("v2", view)).toBe(false);
    // A tile shows a new picture.
    tiles.invalidate([{ x: 10, y: 10, w: 5, h: 5 }], 0);
    painted(tiles, view, "b");
    expect(composite.changed("v2", view)).toBe(true);
    expect(composite.changed("v2", view)).toBe(false);
  });

  it("is put together every time while a tile has no picture yet", () => {
    const tiles = new Tiles<string>(() => {});
    const composite = new ViewComposite<string>();
    const view = tiles.inView({ x: 0, y: 0, w: 256, h: 128 }, 1);
    expect(composite.changed("v", view)).toBe(true);
    expect(composite.changed("v", view)).toBe(true);
  });
});

describe("the tiles' version", () => {
  it("goes up when a tile is damaged, painted, shown anew or let go, and only then", () => {
    const tiles = new Tiles<string>(() => {}, 4);
    const page = { x: 0, y: 0, w: 256, h: 128 };
    const view = tiles.inView(page, 1);
    painted(tiles, view, "a");
    const v = tiles.version;
    tiles.begin();
    tiles.inView(page, 1);
    tiles.commit(view, 0);
    tiles.evict();
    expect(tiles.version).toBe(v);
    // Damage away from every tile changes nothing.
    tiles.invalidate([{ x: 5000, y: 5000, w: 10, h: 10 }], 0);
    expect(tiles.version).toBe(v);
    tiles.invalidate([{ x: 0, y: 0, w: 10, h: 10 }], 0);
    expect(tiles.version).toBeGreaterThan(v);
    const v2 = tiles.version;
    painted(tiles, view, "b");
    expect(tiles.version).toBeGreaterThan(v2);
    const v3 = tiles.version;
    tiles.clear();
    expect(tiles.version).toBeGreaterThan(v3);
  });
});

describe("an outside agent's placeholders", () => {
  const doc = () => {
    const d = new Y.Doc();
    const person = store.insert(d, ROOT_ID, { type: "frame", name: "Person's", placeholder: true });
    return { d, person };
  };

  it("are the ones it turned on, and turned off again when it is done", () => {
    const { d, person } = doc();
    const mine = new AgentPlaceholders();
    let before = placeholderIds(d);
    const a = store.insert(d, ROOT_ID, { type: "frame", name: "A", placeholder: true });
    const b = store.insert(d, ROOT_ID, { type: "frame", name: "B", placeholder: true });
    mine.track(d, before);
    expect(mine.size).toBe(2);
    // It finishes B itself.
    before = placeholderIds(d);
    store.update(d, b, { placeholder: false });
    mine.track(d, before);
    expect(mine.size).toBe(1);
    const origin = { agent: "Claude Code" };
    let seen: unknown;
    d.on("afterTransaction", (tr: Y.Transaction) => (seen = tr.origin));
    expect(mine.clear(d, origin)).toEqual([a]);
    expect(seen).toBe(origin);
    const nodes = store.nodesOf(d);
    expect(nodes.get(a)!.get("placeholder")).toBeUndefined();
    // One that was on before the agent came is left alone.
    expect(nodes.get(person)!.get("placeholder")).toBe(true);
    expect(mine.size).toBe(0);
  });

  it("leave nothing to do once the agent turned them off or they were deleted", () => {
    const { d } = doc();
    const mine = new AgentPlaceholders();
    const before = placeholderIds(d);
    const a = store.insert(d, ROOT_ID, { type: "frame", name: "A", placeholder: true });
    mine.track(d, before);
    store.nodesOf(d).delete(a);
    let changes = 0;
    d.on("afterTransaction", () => changes++);
    expect(mine.clear(d, "agent")).toEqual([]);
    expect(changes).toBe(0);
  });
});
