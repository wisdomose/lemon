// Copy, paste, duplicate, group, frame selection and ungroup (src/renderer/arrange.ts). The expected
// results are what Pen wrote to the file for the same steps on the same document.
import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { nodeAsPen } from "../src/doc/file.js";
import { ROOT_ID } from "../src/doc/schema.js";
import { layout, facesUsed } from "../src/layout/layout.js";
import { copyNodes, duplicateNodes, groupNodes, pasteNodes, readClip, ungroupNodes } from "../src/renderer/arrange.js";
import type { Laid } from "../src/renderer/canvas/pick.js";
import { put, setup } from "./helpers.js";
import type { Engine } from "../src/engine.js";

let engine: Engine;
beforeAll(async () => {
  engine = (await setup()).engine;
});

async function laid(doc: Y.Doc): Promise<Laid> {
  const tree = store.toTree(doc);
  const vars = store.getVars(doc);
  await engine.fonts.ensure(facesUsed(tree, vars));
  return { tree, boxes: layout(tree, vars, engine.text) };
}

/** A free frame Board with A and B, a loose ellipse C, and a column frame Stack with D and E. */
function sample(): Y.Doc {
  const doc = new Y.Doc();
  put(doc, {
    type: "frame", id: "Board", name: "Board", x: 0, y: 0, width: 300, height: 200, fill: "#ffffff", layout: "none",
    children: [
      { type: "rectangle", id: "A", name: "A", x: 20, y: 20, width: 60, height: 40, fill: "#e11d48" },
      { type: "rectangle", id: "B", name: "B", x: 120, y: 60, width: 50, height: 50, fill: "#2563eb" },
    ],
  });
  put(doc, { type: "ellipse", id: "C", name: "C", x: 400, y: 0, width: 80, height: 80, fill: "#16a34a" });
  put(doc, {
    type: "frame", id: "Stack", name: "Stack", x: 0, y: 300, width: 200, height: 200, fill: "#f4f4f5", layout: "vertical", gap: 10, padding: 10,
    children: [
      { type: "rectangle", id: "D", name: "D", width: 80, height: 30, fill: "#f59e0b" },
      { type: "rectangle", id: "E", name: "E", width: 80, height: 30, fill: "#8b5cf6" },
    ],
  });
  return doc;
}

const pen = (doc: Y.Doc, id: string) => {
  const { id: _, ...rest } = nodeAsPen(doc, id);
  return rest;
};
const VIEW = { x: -100, y: -100, w: 2000, h: 2000 };

describe("group and frame selection", () => {
  it("groups at the members' top-left, keeping where they are", async () => {
    const doc = sample();
    const g = groupNodes(doc, await laid(doc), ["A", "B"], "group")!;
    expect(store.childIds(doc, "Board")).toEqual([g]);
    expect(pen(doc, g)).toEqual({
      type: "group", x: 20, y: 20,
      children: [
        { type: "rectangle", id: "A", name: "A", x: 0, y: 0, width: 60, height: 40, fill: "#e11d48" },
        { type: "rectangle", id: "B", name: "B", x: 100, y: 40, width: 50, height: 50, fill: "#2563eb" },
      ],
    });
  });

  it("puts the group in the topmost member's place", async () => {
    const doc = sample();
    put(doc, { type: "rectangle", id: "F", x: 0, y: 0, width: 10, height: 10 }, "Board");
    const g = groupNodes(doc, await laid(doc), ["F", "A"], "group")!;
    expect(store.childIds(doc, "Board")).toEqual(["B", g]);
    expect(store.childIds(doc, g)).toEqual(["A", "F"]);
  });

  it("takes the members' place in a column, without x and y", async () => {
    const doc = sample();
    const g = groupNodes(doc, await laid(doc), ["E", "D"], "group")!;
    expect(store.childIds(doc, "Stack")).toEqual([g]);
    const out = pen(doc, g);
    expect(out).not.toHaveProperty("x");
    expect(out.children!.map((c) => [c.id, c.x, c.y])).toEqual([["D", 0, 0], ["E", 0, 40]]);
  });

  it("frames the selection in a numbered frame its size, without layout or fill", async () => {
    const doc = sample();
    const f = groupNodes(doc, await laid(doc), ["A", "B"], "frame")!;
    const { children, ...rest } = pen(doc, f);
    expect(rest).toEqual({ type: "frame", name: "Frame 1", x: 20, y: 20, width: 150, height: 90, layout: "none" });
    expect(children!.map((c) => [c.id, c.x, c.y])).toEqual([["A", 0, 0], ["B", 100, 40]]);
    expect(store.propsOf(doc, groupNodes(doc, await laid(doc), ["C"], "frame")!).name).toBe("Frame 2");
  });
});

describe("ungroup", () => {
  it("puts a group's children back where they were", async () => {
    const doc = sample();
    const g = groupNodes(doc, await laid(doc), ["A", "B"], "group")!;
    expect(ungroupNodes(doc, await laid(doc), [g])).toEqual(["A", "B"]);
    expect(store.childIds(doc, "Board")).toEqual(["A", "B"]);
    expect([store.propsOf(doc, "B").x, store.propsOf(doc, "B").y]).toEqual([120, 60]);
  });

  it("lifts a column frame's children onto the page at their laid-out places", async () => {
    const doc = sample();
    ungroupNodes(doc, await laid(doc), ["Stack"]);
    expect(store.childIds(doc, ROOT_ID)).toEqual(["Board", "C", "D", "E"]);
    expect(pen(doc, "E")).toMatchObject({ x: 10, y: 350 });
  });
});

describe("duplicate", () => {
  it("puts the copy right after the node, in the same spot", async () => {
    const doc = sample();
    const [c] = duplicateNodes(doc, await laid(doc), ["C"]);
    expect(store.childIds(doc, ROOT_ID)).toEqual(["Board", "C", c, "Stack"]);
    expect(pen(doc, c!)).toEqual(pen(doc, "C"));
    const [d] = duplicateNodes(doc, await laid(doc), ["D"]);
    expect(store.childIds(doc, "Stack")).toEqual(["D", d, "E"]);
  });

  it("puts a page frame's copy in the first free space to its right", async () => {
    const doc = sample();
    const [b] = duplicateNodes(doc, await laid(doc), ["Board"]);
    expect(pen(doc, b!)).toMatchObject({ name: "Board", x: 520, y: 0 });
  });
});

describe("copy and paste", () => {
  it("writes Pen's clipboard", () => {
    const doc = sample();
    const one = copyNodes(doc, ["C"], "src")!;
    expect(one.text).toBe("Node ID: C");
    expect(copyNodes(doc, ["C", "Board"], "src")!.text).toBe("Node IDs: C, Board");
    expect(readClip(one.html)).toEqual({ source: "src", ids: ["C"], nodes: [nodeAsPen(doc, "C")] });
  });

  it("reads a copy made in Pen", () => {
    const payload = { source: "pen", localData: ["X"], remoteData: { nodes: [{ type: "ellipse", id: "X", x: 400, y: 0, name: "Ü", width: 80, height: 80 }] } };
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));
    expect(readClip(`<html><body><!--StartFragment--><span data-pen-node-clipboard="${b64}">Node ID: X</span>`)?.nodes[0]?.name).toBe("Ü");
    expect(readClip("<b>hello</b>")).toBeNull();
  });

  it("keeps the spot with nothing selected, last on the page", async () => {
    const doc = sample();
    const clip = readClip(copyNodes(doc, ["C"], "me")!.html)!;
    const [p] = pasteNodes(doc, await laid(doc), clip, [], VIEW, true);
    expect(store.childIds(doc, ROOT_ID).at(-1)).toBe(p);
    expect(pen(doc, p!)).toEqual(pen(doc, "C"));
  });

  it("lands in the middle of the view when its spot is out of view", async () => {
    const doc = sample();
    const clip = readClip(copyNodes(doc, ["C"], "me")!.html)!;
    const [p] = pasteNodes(doc, await laid(doc), clip, [], { x: 1000, y: 1000, w: 400, h: 200 }, true);
    expect(pen(doc, p!)).toMatchObject({ x: 1160, y: 1060 });
  });

  it("lands in the middle of the view when copied from another document", async () => {
    const doc = sample();
    const clip = readClip(copyNodes(doc, ["C"], "elsewhere")!.html)!;
    const [p] = pasteNodes(doc, await laid(doc), clip, [], { x: 0, y: 0, w: 1000, h: 600 }, false);
    expect(pen(doc, p!)).toMatchObject({ x: 460, y: 260 });
  });

  it("goes into a selected frame, centred, or beside a selected child", async () => {
    const doc = sample();
    const clip = readClip(copyNodes(doc, ["C"], "me")!.html)!;
    const [a] = pasteNodes(doc, await laid(doc), clip, ["Board"], VIEW, true);
    expect(store.childIds(doc, "Board").at(-1)).toBe(a);
    expect(pen(doc, a!)).toMatchObject({ x: 110, y: 60 });
    const [b] = pasteNodes(doc, await laid(doc), clip, ["A"], VIEW, true);
    expect(pen(doc, b!)).toMatchObject({ x: 110, y: 60 });
    const [c] = pasteNodes(doc, await laid(doc), clip, ["D"], VIEW, true);
    expect(store.childIds(doc, "Stack").at(-1)).toBe(c);
    expect(pen(doc, c!)).not.toHaveProperty("x");
  });

  it("goes beside the copied node when it is selected", async () => {
    const doc = sample();
    const clip = readClip(copyNodes(doc, ["Board"], "me")!.html)!;
    const [p] = pasteNodes(doc, await laid(doc), clip, ["Board"], VIEW, true);
    expect(store.childIds(doc, ROOT_ID).at(-1)).toBe(p);
    expect(pen(doc, p!)).toMatchObject({ name: "Board", x: 0, y: 0 });
    expect(store.childIds(doc, p!)).toHaveLength(2);
  });
});
