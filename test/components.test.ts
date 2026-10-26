import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { ROOT_ID, type TreeNode } from "../src/doc/schema.js";
import { fileText, readFile } from "../src/doc/file.js";

/** A page with a button component (a frame with a label) and nothing else. */
function setup() {
  const doc = new Y.Doc();
  const refs: Record<string, string> = {};
  const button = store.insert(doc, ROOT_ID, {
    type: "frame",
    name: "Button",
    component: true,
    x: 0,
    y: 0,
    fill: "#ff0000",
    padding: 8,
    children: [{ type: "text", ref: "label", text: "Buy" }],
  }, undefined, refs);
  const page = store.insert(doc, ROOT_ID, { type: "frame", name: "Page", x: 400, y: 0, width: 300 });
  return { doc, button, label: refs.label!, page };
}

const names = (n: TreeNode): string[] => [n.props.name ?? n.props.text ?? n.type, ...n.children.flatMap(names)];

describe("components", () => {
  it("reads an instance as its main's tree, under its own ids", () => {
    const { doc, button, label, page } = setup();
    const copy = store.insert(doc, page, { type: "instance", of: button });
    const t = store.toTree(doc, copy);
    expect(t.type).toBe("frame");
    expect(t.instance).toBe(button);
    expect(t.props.fill).toBe("#ff0000");
    expect(t.props.component).toBeUndefined();
    expect(t.props.x).toBeUndefined();
    expect(t.children.map((c) => c.id)).toEqual([`${copy}/${label}`]);
    expect(store.propsOf(doc, `${copy}/${label}`).text).toBe("Buy");
    expect(store.typeOf(doc, copy)).toBe("frame");
    expect(store.parentOf(doc, `${copy}/${label}`)).toBe(copy);
  });

  it("follows changes to the main, and keeps the instance's own changes", () => {
    const { doc, button, label, page } = setup();
    const copy = store.insert(doc, page, { type: "instance", of: button, fill: "#00ff00" });
    store.update(doc, `${copy}/${label}`, { text: "Sell" });
    store.update(doc, button, { padding: 12 });
    store.update(doc, label, { size: 20, text: "Buy now" });
    const t = store.toTree(doc, copy);
    expect(t.props.fill).toBe("#00ff00");
    expect(t.props.padding).toBe(12);
    expect(t.children[0]!.props).toMatchObject({ text: "Sell", size: 20 });
    // Setting a change to null goes back to the main's value.
    store.update(doc, `${copy}/${label}`, { text: null } as never);
    expect(store.propsOf(doc, `${copy}/${label}`).text).toBe("Buy now");
  });

  it("reads instances inside a main, with changes by id path", () => {
    const { doc, button, label, page } = setup();
    const card = store.insert(doc, ROOT_ID, { type: "frame", name: "Card", component: true, x: 0, y: 200 });
    const inner = store.insert(doc, card, { type: "instance", of: button, overrides: { [label]: { text: "Add" } } });
    const copy = store.insert(doc, page, { type: "instance", of: card, overrides: { [`${inner}/${label}`]: { color: "#0000ff" } } });
    const part = `${copy}/${inner}/${label}`;
    expect(store.exists(doc, part)).toBe(true);
    expect(store.propsOf(doc, part)).toMatchObject({ text: "Add", color: "#0000ff" });
    expect(store.isInstance(doc, `${copy}/${inner}`)).toBe(true);
    expect(store.mainOf(doc, `${copy}/${inner}`)).toBe(button);
    expect(store.parentOf(doc, part)).toBe(`${copy}/${inner}`);
  });

  it("hides a deleted part, and refuses to add, move or rearrange parts", () => {
    const { doc, button, label, page } = setup();
    const copy = store.insert(doc, page, { type: "instance", of: button });
    store.remove(doc, `${copy}/${label}`);
    expect(store.propsOf(doc, `${copy}/${label}`).visible).toBe(false);
    expect(store.propsOf(doc, label).visible).toBeUndefined();
    expect(() => store.insert(doc, copy, { type: "rect" })).toThrow(/copy of a component/);
    expect(() => store.insert(doc, `${copy}/${label}`, { type: "rect" })).toThrow(/copy of a component/);
    expect(() => store.move(doc, `${copy}/${label}`, page)).toThrow(/copy of a component/);
  });

  it("refuses a component inside itself", () => {
    const { doc, button, label, page } = setup();
    expect(() => store.insert(doc, button, { type: "instance", of: button })).toThrow(/itself/);
    const card = store.insert(doc, ROOT_ID, { type: "frame", component: true });
    store.insert(doc, card, { type: "instance", of: button });
    const holder = store.insert(doc, button, { type: "frame" });
    expect(() => store.insert(doc, holder, { type: "instance", of: card })).toThrow(/itself/);
    const loose = store.insert(doc, page, { type: "instance", of: card });
    expect(() => store.move(doc, loose, holder)).toThrow(/itself/);
    expect(() => store.insert(doc, page, { type: "instance", of: label })).toThrow(/isn't a component/);
  });

  it("detaches an instance into ordinary nodes that look the same", () => {
    const { doc, button, label, page } = setup();
    const card = store.insert(doc, ROOT_ID, { type: "frame", name: "Card", component: true, children: [{ type: "text", text: "Title" }] });
    const inner = store.insert(doc, card, { type: "instance", of: button });
    const copy = store.insert(doc, page, { type: "instance", of: card, width: 200, overrides: { [`${inner}/${label}`]: { text: "Go" } } });
    const before = store.toTree(doc, copy);
    store.detach(doc, copy);
    const after = store.toTree(doc, copy);
    expect(after.instance).toBeUndefined();
    expect(after.props.width).toBe(200);
    expect(names(after)).toEqual(names(before));
    // The instance inside stays an instance, with the change it had.
    const nested = after.children[1]!;
    expect(nested.instance).toBe(button);
    expect(nested.children[0]!.props.text).toBe("Go");
    // Ordinary nodes now: they no longer follow the main.
    store.update(doc, button, { fill: "#000000" });
    expect(store.toTree(doc, copy).children[1]!.props.fill).toBe("#000000");
    store.update(doc, card, { fill: "#123456" });
    expect(store.toTree(doc, copy).props.fill).toBeUndefined();
  });

  it("detaches the copies when their main is deleted or stops being a component", () => {
    const { doc, button, page } = setup();
    const a = store.insert(doc, page, { type: "instance", of: button });
    store.update(doc, button, { component: null } as never);
    expect(store.toTree(doc, a).instance).toBeUndefined();
    expect(names(store.toTree(doc, a))).toEqual(["Button", "Buy"]);
    store.update(doc, button, { component: true });
    const b = store.insert(doc, page, { type: "instance", of: button });
    store.remove(doc, button);
    expect(store.toTree(doc, b).instance).toBeUndefined();
    expect(names(store.toTree(doc, b))).toEqual(["Button", "Buy"]);
  });

  it("saves and opens instances with their changes", () => {
    const { doc, button, label, page } = setup();
    const copy = store.insert(doc, page, { type: "instance", of: button, overrides: { [label]: { text: "Sell" } } });
    const text = fileText(doc);
    expect(JSON.parse(text).nodes.find((n: { id: string }) => n.id === copy)).toMatchObject({ type: "instance", of: button, overrides: { [label]: { text: "Sell" } } });
    const back = new Y.Doc();
    readFile(text, back);
    expect(store.toTree(back)).toEqual(store.toTree(doc));
  });
});
