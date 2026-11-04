// The tree rebuilt only where it changed (src/doc/incremental.ts), and layout kept for unchanged
// top-level frames (layout's `reuse`): always the same as building and laying out from scratch.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { IncrementalTree, changedRecords } from "../src/doc/incremental.js";
import { layout, type LayoutReuse } from "../src/layout/layout.js";
import { ROOT_ID } from "../src/doc/schema.js";
import { setup } from "./helpers.js";

function tracked(doc: Y.Doc) {
  const tree = new IncrementalTree(doc);
  doc.on("afterTransaction", (tr: Y.Transaction) => tree.mark(changedRecords(doc, tr)));
  return tree;
}

describe("the tree, rebuilt where it changed", () => {
  it("keeps untouched frames as the same objects and rebuilds the path to a change", () => {
    const doc = new Y.Doc();
    const a = store.insert(doc, ROOT_ID, { type: "frame", name: "A" });
    const b = store.insert(doc, ROOT_ID, { type: "frame", name: "B" });
    const inner = store.insert(doc, b, { type: "frame", name: "Inner" });
    const leaf = store.insert(doc, inner, { type: "rectangle", name: "Leaf" });
    const other = store.insert(doc, b, { type: "rectangle", name: "Other" });
    const tree = tracked(doc);
    const t1 = tree.build();
    expect(tree.build()).toBe(t1);
    doc.transact(() => store.update(doc, leaf, { fill: "#ff0000" }));
    const t2 = tree.build();
    expect(t2).toEqual(store.toTree(doc));
    expect(t2.children[0]).toBe(t1.children[0]); // A
    expect(t2.children[1]).not.toBe(t1.children[1]); // B, above the change
    expect(t2.children[1]!.children[1]).toBe(t1.children[1]!.children[1]); // Other
    void a;
    void other;
  });

  it("follows moves (both parents), deletes, and every instance of a changed component", () => {
    const doc = new Y.Doc();
    const card = store.insert(doc, ROOT_ID, { type: "frame", name: "Card", reusable: true });
    const title = store.insert(doc, card, { type: "text", content: "Title" });
    const page = store.insert(doc, ROOT_ID, { type: "frame", name: "Page" });
    store.insert(doc, page, { type: "ref", ref: card });
    const from = store.insert(doc, ROOT_ID, { type: "frame", name: "From" });
    const to = store.insert(doc, ROOT_ID, { type: "frame", name: "To" });
    const moving = store.insert(doc, from, { type: "rectangle", name: "Moving" });
    const tree = tracked(doc);
    tree.build();
    doc.transact(() => store.update(doc, title, { content: "Changed" }));
    expect(tree.build()).toEqual(store.toTree(doc));
    doc.transact(() => store.move(doc, moving, to));
    expect(tree.build()).toEqual(store.toTree(doc));
    doc.transact(() => store.remove(doc, to));
    expect(tree.build()).toEqual(store.toTree(doc));
  });

  it("matches a fresh tree after many random changes, from this copy and another", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const doc = new Y.Doc();
    const remote = new Y.Doc();
    doc.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(remote, u, "remote"));
    remote.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(doc, u, "remote"));
    const tree = tracked(doc);
    const ids = () => [...store.nodesOf(doc).keys()];
    for (let step = 0; step < 300; step++) {
      const target = rand(3) === 0 ? remote : doc;
      const all = ids().filter((id) => store.nodesOf(target).has(id));
      const pick = () => all[rand(all.length)]!;
      const containers = all.filter((id) => store.typeOf(target, id) === "frame");
      try {
        target.transact(() => {
          const op = rand(5);
          if (op <= 1 || !all.length) store.insert(target, containers.length && rand(2) ? containers[rand(containers.length)]! : ROOT_ID, { type: rand(2) ? "frame" : "rectangle", name: `n${step}` });
          else if (op === 2) store.update(target, pick(), { name: `u${step}`, width: rand(200) });
          else if (op === 3 && containers.length) store.move(target, pick(), rand(3) ? containers[rand(containers.length)]! : ROOT_ID);
          else store.remove(target, pick());
        });
      } catch {
        // A move into itself and the like are refused; nothing changed.
      }
      if (step % 7 === 0) expect(tree.build()).toEqual(store.toTree(doc));
    }
    expect(tree.build()).toEqual(store.toTree(doc));
  });
});

describe("layout kept for unchanged frames", () => {
  it("gives the same boxes as laying everything out", async () => {
    const { engine } = await setup();
    const doc = new Y.Doc();
    const a = store.insert(doc, ROOT_ID, { type: "frame", name: "A", layout: "vertical", gap: 8, padding: 10 });
    for (let i = 0; i < 5; i++) store.insert(doc, a, { type: "text", content: `Line ${i}`, fontSize: 14 });
    const b = store.insert(doc, ROOT_ID, { type: "frame", name: "B", x: 400, layout: "horizontal", gap: 4 });
    const r = store.insert(doc, b, { type: "rectangle", width: 20, height: 20 });
    const tree = tracked(doc);
    const reuse: LayoutReuse = new WeakMap();
    const vars = store.getVars(doc);
    layout(tree.build(), vars, engine.text, reuse);
    doc.transact(() => store.update(doc, r, { width: 60 }));
    const t = tree.build();
    expect(reuse.has(t.children[0]!)).toBe(true);
    expect(reuse.has(t.children[1]!)).toBe(false);
    expect(layout(t, vars, engine.text, reuse)).toEqual(layout(store.toTree(doc), vars, engine.text));
  });
});
