import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ROOT_ID } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";

describe("document store", () => {
  it("inserts nested nodes, keeps sibling order, and reads back as a tree", () => {
    const doc = new Y.Doc();
    const refs: Record<string, string> = {};
    const id = store.insert(doc, ROOT_ID, {
      type: "frame",
      name: "Card",
      children: [
        { type: "text", text: "B", ref: "b" },
        { type: "text", text: "C" },
      ],
    }, undefined, refs);
    store.insert(doc, id, { type: "text", text: "A" }, 0);
    const tree = store.toTree(doc);
    expect(tree.children[0]!.children.map((c) => c.props.text)).toEqual(["A", "B", "C"]);
    expect(refs.b).toBeTypeOf("string");
  });

  it("moves, updates and removes", () => {
    const doc = new Y.Doc();
    const a = store.insert(doc, ROOT_ID, { type: "frame", name: "A" });
    const b = store.insert(doc, ROOT_ID, { type: "frame", name: "B" });
    const t = store.insert(doc, a, { type: "text", text: "hi" });
    store.move(doc, t, b);
    store.update(doc, t, { text: "hello", size: 20 });
    expect(store.toTree(doc, b).children[0]!.props).toMatchObject({ text: "hello", size: 20 });
    expect(() => store.move(doc, a, a)).toThrow(/inside itself/);
    store.remove(doc, b);
    expect(store.exists(doc, t)).toBe(false);
  });

  it("rejects children on non-frames and unknown types", () => {
    const doc = new Y.Doc();
    expect(() => store.insert(doc, ROOT_ID, { type: "text", children: [] } as never)).toThrow(/cannot have children/);
    expect(() => store.insert(doc, ROOT_ID, { type: "blob" } as never)).toThrow(/Unknown node type/);
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
      store.insert(copy, frame, { type: "text", text: "from agent" });
      store.update(copy, frame, { gap: 12 });
    });
    store.update(doc, frame, { name: "Renamed by person" }); // happens while the agent works
    staged.commit("agent");
    expect(updates.filter((o) => o === "agent")).toHaveLength(1);
    const t = store.toTree(doc, frame);
    expect(t.props).toMatchObject({ name: "Renamed by person", gap: 12 });
    expect(t.children[0]!.props.text).toBe("from agent");
  });
});
