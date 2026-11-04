// The .pen file: reading and writing Pen's format loses nothing, older files come up to 2.21, and a
// ref's changes, fills and replacements read through its component.
//
// Pen's own sample files are checked too when LEMON_PEN_SAMPLES names a folder of .pen files (they
// aren't part of this repository).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { fileText, readFile, toPen } from "../src/doc/file.js";
import { assetsOf } from "../src/doc/assets.js";
import * as store from "../src/doc/store.js";
import { getVars } from "../src/doc/store.js";
import { withTheme } from "../src/doc/values.js";

const open = (file: unknown, files: Record<string, Uint8Array> = {}) => {
  const doc = new Y.Doc();
  const report = readFile(JSON.stringify(file), doc, (url) => files[url]);
  return { doc, report };
};

/** A file as it should read back: empty child lists dropped (Pen leaves them out too). */
function normal(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normal);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!(k === "children" && Array.isArray(x) && x.length === 0)) out[k] = normal(x);
    return out;
  }
  return v;
}

const FIXTURE = {
  version: "2.21",
  children: [
    {
      type: "frame",
      id: "card",
      name: "Card",
      reusable: true,
      x: 0,
      y: 0,
      layout: "vertical",
      gap: 8,
      padding: [16, 24],
      fill: [{ type: "color", color: "$surface" }, { type: "gradient", gradientType: "radial", colors: [{ color: "#ffffff00", position: 0 }, { color: "#00000010", position: 1 }] }],
      stroke: "$border",
      strokeWidth: { bottom: 1 },
      effect: [{ type: "shadow", shadowType: "outer", offset: { x: 0, y: 2 }, blur: 4, color: "#0000001a" }],
      futureProperty: { kept: true },
      children: [
        { type: "text", id: "title", name: "Title", content: "Title", fontFamily: "Inter", fontSize: 18, fontWeight: "600", fill: "$ink" },
        { type: "frame", id: "body", name: "Body", slot: ["title"], width: "fill_container", height: "fit_content(40)" },
        { type: "icon", id: "chev", library: "lucide", icon: "chevron-right", width: 16, height: 16, fill: "$ink" },
      ],
    },
    {
      type: "frame",
      id: "page",
      x: 400,
      y: 0,
      width: 390,
      theme: { Mode: "Dark" },
      children: [
        {
          type: "ref",
          id: "c1",
          ref: "card",
          width: "fill_container",
          descendants: {
            title: { content: "Annual" },
            body: { children: [{ type: "text", id: "b1", content: "Inside the slot", fill: "$ink" }] },
            chev: { type: "ellipse", id: "dot", width: 8, height: 8, fill: "$ink" },
          },
        },
        { type: "ref", id: "c2", ref: "card", descendants: { chev: { enabled: false } } },
        { type: "path", id: "p", geometry: "M0 0L10 10", viewBox: [0, 0, 10, 10], width: 10, height: 10, stroke: "#000000", fillRule: "evenodd" },
        { type: "rectangle", id: "pic", width: 100, height: 60, fill: { type: "image", url: "./images/a.png", mode: "contain" } },
      ],
    },
  ],
  themes: { Mode: ["Light", "Dark"] },
  variables: {
    surface: { type: "color", value: [{ value: "#ffffff", theme: { Mode: "Light" } }, { value: "#111111", theme: { Mode: "Dark" } }] },
    ink: { type: "color", value: [{ value: "#111111", theme: { Mode: "Light" } }, { value: "#eeeeee", theme: { Mode: "Dark" } }] },
    border: { type: "color", value: "$ink" },
    gap: { type: "number", value: 8 },
    dense: { type: "boolean", value: false },
  },
};

describe(".pen files", () => {
  it("read and write back unchanged", () => {
    const png = new Uint8Array([0x89, 0x50, 1, 2]);
    const { doc, report } = open(FIXTURE, { "./images/a.png": png });
    expect(report.missingPictures).toEqual([]);
    expect(assetsOf(doc).get("./images/a.png")).toEqual(png);
    expect(normal(JSON.parse(fileText(doc)))).toEqual(normal(FIXTURE));
    // And again from what was written.
    const again = new Y.Doc();
    readFile(fileText(doc), again);
    expect(fileText(again)).toEqual(fileText(doc));
  });

  it("reads an instance through its component, with its changes, fills and replacements", () => {
    const { doc } = open(FIXTURE);
    const c1 = store.toTree(doc, "c1");
    expect(c1.instance).toBe("card");
    expect(c1.props).toMatchObject({ width: "fill_container", layout: "vertical" });
    expect(c1.props.reusable).toBeUndefined();
    expect(c1.children.map((c) => c.id)).toEqual(["c1/title", "c1/body", "dot"]);
    expect(c1.children[0]!.props.content).toBe("Annual");
    expect(c1.children[1]!.children.map((c) => [c.id, c.props.content])).toEqual([["b1", "Inside the slot"]]);
    expect(store.parentOf(doc, "b1")).toBe("c1/body");
    expect(store.parentOf(doc, "dot")).toBe("c1");
    expect(store.toTree(doc, "c2").children[2]!.props.enabled).toBe(false);
  });

  it("puts new content in a slot, replaces a node, and hides one when it's deleted", () => {
    const { doc } = open(FIXTURE);
    const t = store.insert(doc, "c2/body", { type: "text", content: "New" });
    expect(store.toTree(doc, "c2").children[1]!.children.map((c) => c.id)).toEqual([t]);
    expect(() => store.insert(doc, "c2/title", { type: "text" })).toThrow();
    const r = store.replace(doc, "c2/title", { type: "text", content: "Swapped" });
    expect(store.toTree(doc, "c2").children[0]!.id).toBe(r);
    store.remove(doc, "c1/title");
    expect(store.propsOf(doc, "c1/title").enabled).toBe(false);
    const pen = toPen(doc).children[1]!.children!;
    expect(pen[1]!.descendants).toMatchObject({ body: { children: [{ type: "text", content: "New" }] }, title: { type: "text", content: "Swapped" } });
    expect(pen[0]!.descendants!.title).toEqual({ content: "Annual", enabled: false });
  });

  it("detaches an instance into ordinary nodes that look the same", () => {
    const { doc } = open(FIXTURE);
    const before = store.toTree(doc, "c1");
    store.detach(doc, "c1");
    const after = store.toTree(doc, "c1");
    const shape = (n: typeof before): unknown => [n.type, n.props.content ?? null, n.children.map(shape)];
    expect(after.instance).toBeUndefined();
    expect(shape(after)).toEqual(shape(before));
    expect(store.childIds(doc, "c1")).toHaveLength(3);
  });

  it("resolves variables for the theme in force", () => {
    const { doc } = open(FIXTURE);
    const light = getVars(doc);
    expect(light).toMatchObject({ surface: "#ffffff", ink: "#111111", border: "#111111", gap: 8, dense: false });
    const dark = withTheme(light, { Mode: "Dark" });
    expect(dark).toMatchObject({ surface: "#111111", border: "#eeeeee" });
  });

  it("brings older files up to 2.21", () => {
    const { doc } = open({
      version: "2.8",
      children: [
        {
          type: "frame",
          id: "f",
          stroke: { align: "inside", thickness: 1, fill: "#e5e5e5" },
          fill: { type: "image", url: "", mode: "fill" },
          children: [
            { type: "icon_font", id: "i", iconFontFamily: "lucide", iconFontName: "info", width: 16, height: 16, fill: "#000000" },
            { type: "line", id: "l", width: "fill_container", height: 0, stroke: { align: "center", thickness: 1, fill: "$border" } },
          ],
        },
      ],
    });
    const pen = toPen(doc);
    expect(pen.version).toBe("2.21");
    // As Pen writes the same file after opening it.
    expect(pen.children[0]).toMatchObject({ stroke: "#e5e5e5", strokeWidth: 1, strokeAlignment: "inner", fill: { mode: "cover" } });
    expect(pen.children[0]!.children![0]).toEqual({ type: "icon", id: "i", icon: "info", library: "lucide", width: 16, height: 16, fill: "#000000" });
    // Pen keeps `line` nodes; a centred stroke leaves out `strokeAlignment` (centre is the default).
    expect(pen.children[0]!.children![1]).toEqual({ type: "line", id: "l", width: "fill_container", height: 0, stroke: "$border", strokeWidth: 1 });
  });

  it("refuses what isn't a .pen file", () => {
    expect(() => open({ nodes: [] })).toThrow(/isn't a .pen file/);
    expect(() => open({ version: "3.0", children: [] })).toThrow(/version 3.0/);
    expect(() => open({ children: [{ type: "sprite", id: "x" }] })).toThrow(/unknown type "sprite"/);
  });

  const samples = process.env.LEMON_PEN_SAMPLES;
  it.runIf(!!samples)("reads and writes back Pen's sample files", () => {
    for (const name of readdirSync(samples!).filter((f) => f.endsWith(".pen"))) {
      const text = readFileSync(join(samples!, name), "utf8");
      const doc = new Y.Doc();
      readFile(text, doc);
      const once = fileText(doc);
      const again = new Y.Doc();
      readFile(once, again);
      expect(fileText(again), name).toEqual(once);
      // Every node and every component change survives.
      const count = (v: unknown): number => (Array.isArray(v) ? v.reduce((n: number, x) => n + count(x), 0) : v && typeof v === "object" ? ("type" in v && "id" in v ? 1 : 0) + Object.values(v).reduce((n: number, x) => n + count(x), 0) : 0);
      expect(count(JSON.parse(once).children), name).toEqual(count(JSON.parse(text).children));
      // Every node of every instance reads.
      for (const top of store.toTree(doc).children) expect(top.id).toBeTruthy();
    }
  });
});
