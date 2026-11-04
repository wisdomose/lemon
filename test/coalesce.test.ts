// Sending an agent's many small changes to the window (src/main/coalesce.ts), and when the main process
// repairs the tree (touchesTree in src/doc/live.ts).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Debounced, UpdateBatcher, type Timers } from "../src/main/coalesce.js";
import { touchesTree } from "../src/doc/live.js";
import * as store from "../src/doc/store.js";
import { ROOT_ID } from "../src/doc/schema.js";

/** Timers that run only when told to. */
function fakeTimers() {
  let now = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const timers: Timers = {
    setTimeout: (fn, ms) => (due.set(next, { at: now + ms, fn }), next++),
    clearTimeout: (h) => void due.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [h, t] of [...due].sort((a, b) => a[1].at - b[1].at))
      if (t.at <= now) {
        due.delete(h);
        t.fn();
      }
  };
  return { timers, advance, waiting: () => due.size };
}

describe("updates to the window", () => {
  it("go as one merged update per frame, which brings the window's copy level", () => {
    const { timers, advance } = fakeTimers();
    const source = new Y.Doc();
    const window = new Y.Doc();
    const sent: Uint8Array[] = [];
    const batcher = new UpdateBatcher((u) => sent.push(u), 16, timers);
    source.on("update", (u: Uint8Array) => batcher.push(u));
    // An agent's 300 statements, each its own change.
    for (let i = 0; i < 300; i++) source.transact(() => store.insert(source, ROOT_ID, { type: "rectangle", name: `R${i}`, width: 10, height: 10 }));
    expect(sent).toHaveLength(0);
    advance(16);
    expect(sent).toHaveLength(1);
    Y.applyUpdate(window, sent[0]!);
    expect(store.toTree(window)).toEqual(store.toTree(source));
    // Nothing more to send: no timer left, no empty update.
    advance(100);
    expect(sent).toHaveLength(1);
  });

  it("starts a new frame after each send, and flush sends at once", () => {
    const { timers, advance } = fakeTimers();
    const doc = new Y.Doc();
    const sent: Uint8Array[] = [];
    const batcher = new UpdateBatcher((u) => sent.push(u), 16, timers);
    doc.on("update", (u: Uint8Array) => batcher.push(u));
    doc.getMap("m").set("a", 1);
    advance(10);
    doc.getMap("m").set("b", 2);
    advance(6);
    expect(sent).toHaveLength(1);
    doc.getMap("m").set("c", 3);
    batcher.flush();
    expect(sent).toHaveLength(2);
    advance(16);
    expect(sent).toHaveLength(2);
    const copy = new Y.Doc();
    sent.forEach((u) => Y.applyUpdate(copy, u));
    expect(copy.getMap("m").toJSON()).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("are dropped when the window has gone", () => {
    const { timers, advance, waiting } = fakeTimers();
    const sent: Uint8Array[] = [];
    const batcher = new UpdateBatcher((u) => sent.push(u), 16, timers);
    batcher.push(Y.encodeStateAsUpdate(new Y.Doc()));
    batcher.dispose();
    advance(50);
    expect(sent).toHaveLength(0);
    expect(waiting()).toBe(0);
  });
});

describe("work that follows the document", () => {
  it("runs once after the changes pause, or at once when asked", () => {
    const { timers, advance } = fakeTimers();
    let runs = 0;
    const d = new Debounced(() => runs++, 50, timers);
    for (let i = 0; i < 100; i++) (d.call(), advance(5));
    expect(runs).toBe(0);
    advance(50);
    expect(runs).toBe(1);
    d.call();
    expect(d.pending).toBe(true);
    d.now();
    expect(runs).toBe(2);
    d.now();
    expect(runs).toBe(2);
  });
});

describe("repairing the tree", () => {
  /** Whether each transaction on `doc` touched the tree, in order. */
  function watch(doc: Y.Doc) {
    const seen: boolean[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => seen.push(touchesTree(doc, tr)));
    return seen;
  }

  it("is only worth it after a delete, a move or a node added under a missing parent", () => {
    const doc = new Y.Doc();
    const frame = store.insert(doc, ROOT_ID, { type: "frame", name: "A" });
    const other = store.insert(doc, ROOT_ID, { type: "frame", name: "B" });
    const child = store.insert(doc, frame, { type: "rectangle", name: "R" });
    const seen = watch(doc);
    doc.transact(() => store.update(doc, child, { fill: "#ff0000" }));
    doc.transact(() => store.insert(doc, frame, { type: "text", content: "hi" }));
    expect(seen).toEqual([false, false]);
    doc.transact(() => store.move(doc, child, other));
    expect(seen.at(-1)).toBe(true);
    doc.transact(() => store.remove(doc, other));
    expect(seen.at(-1)).toBe(true);
  });

  it("sees a node another copy added inside a frame deleted here", () => {
    const here = new Y.Doc();
    const frame = store.insert(here, ROOT_ID, { type: "frame", name: "A" });
    const there = new Y.Doc();
    Y.applyUpdate(there, Y.encodeStateAsUpdate(here));
    store.insert(there, frame, { type: "rectangle", name: "Late" });
    store.remove(here, frame);
    const seen = watch(here);
    Y.applyUpdate(here, Y.encodeStateAsUpdate(there, Y.encodeStateVector(here)));
    expect(seen).toEqual([true]);
  });
});
