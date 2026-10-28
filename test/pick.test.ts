// What clicks, double-clicks and selection boxes select (src/renderer/canvas/pick.ts).
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../src/doc/schema.js";
import type { Box } from "../src/layout/layout.js";
import { boxPick, clickPick, doubleClickPick, selectAll, selectChildren, selectParents } from "../src/renderer/canvas/pick.js";

// A page "page" (0,0 400×400) with a card (20,20 200×100) holding a title and a button with a label,
// and an empty frame "empty" to the right.
const node = (id: string, type: TreeNode["type"], children: TreeNode[] = [], props: TreeNode["props"] = {}): TreeNode => ({ id, type, props, children });
const tree = node("document", "frame", [
  node("page", "frame", [node("card", "frame", [node("title", "text"), node("button", "frame", [node("label", "text")])], { layout: "vertical" }), node("note", "text")]),
  node("empty", "frame"),
]);
const boxes = new Map<string, Box>([
  ["page", { x: 0, y: 0, w: 400, h: 400 }],
  ["card", { x: 20, y: 20, w: 200, h: 100 }],
  ["title", { x: 30, y: 30, w: 100, h: 20 }],
  ["button", { x: 30, y: 60, w: 80, h: 30 }],
  ["label", { x: 40, y: 65, w: 40, h: 20 }],
  ["note", { x: 20, y: 300, w: 100, h: 20 }],
  ["empty", { x: 500, y: 0, w: 100, h: 100 }],
]);
const s = { tree, boxes };

describe("a click", () => {
  it("picks the top-level frame's child under the pointer", () => {
    expect(clickPick(s, 45, 70, [])).toBe("card");
  });
  it("picks nothing on the empty area of a frame with contents, and an empty frame anywhere", () => {
    expect(clickPick(s, 300, 200, [])).toBeNull();
    expect(clickPick(s, 550, 50, [])).toBe("empty");
    expect(clickPick(s, 450, 50, [])).toBeNull();
  });
  it("stays at the depth of the selection", () => {
    expect(clickPick(s, 45, 70, ["title"])).toBe("button");
    expect(clickPick(s, 45, 70, ["button"])).toBe("button");
    expect(clickPick(s, 40, 305, ["title"])).toBe("note");
  });
  it("with Ctrl picks the deepest node", () => {
    expect(clickPick(s, 45, 70, [], true)).toBe("label");
  });
});

describe("a double-click", () => {
  it("goes one level into the selected node, and opens a selected text for typing", () => {
    expect(doubleClickPick(s, 45, 70, ["card"])).toEqual({ id: "button" });
    expect(doubleClickPick(s, 45, 70, ["button"])).toEqual({ id: "label" });
    expect(doubleClickPick(s, 45, 70, ["label"])).toEqual({ id: "label", edit: true });
  });
});

describe("a selection box", () => {
  it("picks what it touches in the frame it started in, or top-level frames from the empty canvas", () => {
    expect(boxPick(s, { x: 10, y: 100, w: 50, h: 220 }, { x: 10, y: 100 })).toEqual(["card", "note"]);
    expect(boxPick(s, { x: 380, y: -20, w: 200, h: 50 }, { x: 450, y: -20 })).toEqual(["page", "empty"]);
  });
  it("with Ctrl picks the deepest nodes it touches", () => {
    expect(boxPick(s, { x: 25, y: 25, w: 30, h: 50 }, { x: 25, y: 25 }, true)).toEqual(["title", "label"]);
  });
});

describe("keyboard selection", () => {
  it("Enter selects children, Shift+Enter parents, Ctrl+A everything beside the selection", () => {
    expect(selectChildren(s, ["card"])).toEqual(["title", "button"]);
    expect(selectChildren(s, ["title"])).toEqual(["title"]);
    expect(selectParents(s, ["title", "label"])).toEqual(["card", "button"]);
    expect(selectParents(s, ["page"])).toEqual(["page"]);
    expect(selectAll(s, ["title"])).toEqual(["title", "button"]);
    expect(selectAll(s, [])).toEqual(["page", "empty"]);
  });
});

describe("where dropped or drawn nodes go", async () => {
  const { frameAt, frameAround, flowSlot } = await import("../src/renderer/canvas/place.js");
  // The card is a column (layout: "vertical"; frames lay out in a row unless told otherwise); the button is in it.
  it("into the deepest frame under the pointer, not one being moved; the page outside every frame", () => {
    expect(frameAt(s, 45, 70).id).toBe("button");
    expect(frameAt(s, 45, 70, new Set(["button"])).id).toBe("card");
    expect(frameAt(s, 450, 50).id).toBe("document");
  });
  it("never into a group (as in Pen), but into a frame inside one", () => {
    // A group "g" (300,300 80×80) in the page, holding a frame "inner" (300,300 40×40).
    const inner = node("inner", "frame");
    const group = node("g", "group", [inner]);
    const t = node("document", "frame", [node("page", "frame", [group])]);
    const b = new Map(boxes);
    b.set("g", { x: 300, y: 300, w: 80, h: 80 });
    b.set("inner", { x: 300, y: 300, w: 40, h: 40 });
    const laid = { tree: t, boxes: b };
    expect(frameAt(laid, 370, 370).id).toBe("page");
    expect(frameAt(laid, 310, 310).id).toBe("inner");
    const up = new Map([["g", t.children[0]!], ["inner", group], ["page", t]]);
    expect(frameAround(up, group).id).toBe("page");
  });
  it("at the place in a column the pointer points to, with a line between the children", () => {
    const card = tree.children[0]!.children[0]!;
    expect(flowSlot(s, card, 50, 35)).toEqual({ index: 0, line: { x1: 20, y1: 30, x2: 220, y2: 30 } });
    expect(flowSlot(s, card, 50, 55)).toEqual({ index: 1, line: { x1: 20, y1: 55, x2: 220, y2: 55 } });
    expect(flowSlot(s, card, 50, 100).index).toBe(2);
    expect(flowSlot(s, card, 50, 100, new Set(["title"])).index).toBe(1);
  });
});
