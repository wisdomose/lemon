import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ROOT_ID } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";

describe("document store", () => {
  it("inserts nested nodes, keeps sibling order, and reads back as a tree", () => {
    const doc = new Y.Doc();
    const id = store.insert(doc, ROOT_ID, {
      type: "frame",
      name: "Card",
      children: [
        { type: "text", content: "B" },
        { type: "text", content: "C" },
      ],
    });
    store.insert(doc, id, { type: "text", content: "A" }, 0);
    const tree = store.toTree(doc);
    expect(tree.children[0]!.children.map((c) => c.props.content)).toEqual(["A", "B", "C"]);
    // New nodes get new ids like Pen's, whatever id they are given.
    expect(id).toMatch(/^[A-Za-z0-9]{5}$/);
    expect(store.insert(doc, ROOT_ID, { type: "frame", id: "mine" })).not.toBe("mine");
  });

  it("moves, updates and removes", () => {
    const doc = new Y.Doc();
    const a = store.insert(doc, ROOT_ID, { type: "frame", name: "A" });
    const b = store.insert(doc, ROOT_ID, { type: "frame", name: "B" });
    const t = store.insert(doc, a, { type: "text", content: "hi" });
    store.move(doc, t, b);
    store.update(doc, t, { content: "hello", fontSize: 20 });
    expect(store.toTree(doc, b).children[0]!.props).toMatchObject({ content: "hello", fontSize: 20 });
    expect(() => store.move(doc, a, a)).toThrow(/inside itself/);
    expect(() => store.update(doc, t, { type: "frame" } as never)).toThrow(/not `type`/);
    store.remove(doc, b);
    expect(store.exists(doc, t)).toBe(false);
  });

  it("rejects children on what can't have them, and unknown types", () => {
    const doc = new Y.Doc();
    expect(() => store.insert(doc, ROOT_ID, { type: "text", children: [{ type: "text" }] })).toThrow(/can't have children/);
    const t = store.insert(doc, ROOT_ID, { type: "rectangle" });
    expect(() => store.insert(doc, t, { type: "text" })).toThrow(/only frames and groups/);
    expect(() => store.insert(doc, ROOT_ID, { type: "blob" } as never)).toThrow(/Unknown node type/);
  });

  it("keeps properties it doesn't know", () => {
    const doc = new Y.Doc();
    const id = store.insert(doc, ROOT_ID, { type: "frame", somethingNew: { a: 1 } });
    expect(store.propsOf(doc, id)).toMatchObject({ somethingNew: { a: 1 } });
  });

  it("staging leaves the document untouched when the work fails", () => {
    const doc = new Y.Doc();
    store.insert(doc, ROOT_ID, { type: "frame", name: "Keep" });
    const before = Y.encodeStateAsUpdate(doc);
    expect(() =>
      store.stage(doc, (copy) => {
        store.insert(copy, ROOT_ID, { type: "frame", name: "Lost" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it("commits a staged change as one update and merges with concurrent edits", () => {
    const doc = new Y.Doc();
    const frame = store.insert(doc, ROOT_ID, { type: "frame", name: "F" });
    const updates: unknown[] = [];
    doc.on("update", (_u, origin) => updates.push(origin));
    const staged = store.stage(doc, (copy) => {
      store.insert(copy, frame, { type: "text", content: "from agent" });
      store.update(copy, frame, { gap: 12 });
    });
    store.update(doc, frame, { name: "Renamed by person" }); // happens while the agent works
    staged.commit("agent");
    expect(updates.filter((o) => o === "agent")).toHaveLength(1);
    const t = store.toTree(doc, frame);
    expect(t.props).toMatchObject({ name: "Renamed by person", gap: 12 });
    expect(t.children[0]!.props.content).toBe("from agent");
  });

  it("sets variables with their types, adding the theme axes they use", () => {
    const doc = new Y.Doc();
    store.setVariables(doc, { ink: { type: "color", value: [{ value: "#000000", theme: { mode: "light" } }, { value: "#ffffff", theme: { mode: "dark" } }] } });
    expect(store.getThemes(doc)).toEqual({ mode: ["light", "dark"] });
    expect(store.getVars(doc)).toEqual({ ink: "#000000" });
    expect(() => store.setVariables(doc, { bad: "#fff" as never })).toThrow(/needs \{ type/);
    store.setVariables(doc, { gap: { type: "number", value: 8 } }, true);
    expect(Object.keys(store.getVariables(doc))).toEqual(["gap"]);
  });
});
