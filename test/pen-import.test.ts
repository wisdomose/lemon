// Opening Pen files: Pen's nodes, sizes, copies and pictures as Lemon's, and the report of what didn't come over.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { importPen } from "../src/import/pen.js";
import { assetsOf } from "../src/doc/assets.js";
import * as store from "../src/doc/store.js";

const pen = (children: unknown[], variables: Record<string, unknown> = {}) => JSON.stringify({ version: "2.21", children, variables });

async function open(text: string, files: Record<string, Uint8Array> = {}) {
  const doc = new Y.Doc();
  const report = await importPen(text, doc, (url) => files[url]);
  return { doc, report, props: (id: string) => store.propsOf(doc, id), tree: store.toTree(doc) };
}

describe("Pen import", () => {
  it("maps frames, sizes, layout and text", async () => {
    const { props, tree } = await open(
      pen(
        [
          {
            type: "frame", id: "page", x: 10, y: 20, width: 390, fill: "$paper", layout: "vertical", gap: 8, padding: [16, 24],
            justifyContent: "space_between", alignItems: "center", cornerRadius: 12,
            children: [
              { type: "frame", id: "row", width: "fill_container", children: [{ type: "text", id: "t1", content: "Hi", fontFamily: "$font", fontSize: 18, fontWeight: "700", fill: "#111111" }] },
              { type: "text", id: "t2", content: "Wraps", textGrowth: "fixed-width", width: "fill_container", height: 99, lineHeight: 1.5, textAlign: "justify" },
              { type: "text", id: "t3", content: "Ignored size", width: 50 },
            ],
          },
        ],
        { paper: { type: "color", value: "#FDFAF2" }, font: { type: "string", value: "Inter" } },
      ),
    );
    expect(tree.children.map((c) => c.id)).toEqual(["page"]);
    expect(props("page")).toMatchObject({ x: 10, y: 20, width: 390, fill: "$paper", layout: "column", gap: 8, padding: [16, 24], justify: "between", align: "center", radius: 12 });
    // Pen's frames lay out in a row unless told otherwise.
    expect(props("row")).toMatchObject({ width: "fill", layout: "row" });
    expect(props("t1")).toMatchObject({ text: "Hi", font: "$font", size: 18, weight: 700, color: "#111111", lineHeight: 1.2 });
    expect(props("t2")).toMatchObject({ width: "fill", lineHeight: 1.5, textAlign: "left" });
    expect(props("t2").height).toBeUndefined();
    expect(props("t3").width).toBeUndefined();
  });

  it("makes reusable nodes components and refs copies, with their changes by id path", async () => {
    const { doc, report, props } = await open(
      pen([
        { type: "frame", id: "btn", reusable: true, fill: "#00ff00", children: [{ type: "text", id: "label", content: "Go" }, { type: "icon", id: "ic", icon: "arrow-right", library: "lucide", fill: "#000000" }] },
        { type: "frame", id: "card", reusable: true, layout: "vertical", children: [{ type: "ref", id: "cb", ref: "btn" }] },
        {
          type: "frame", id: "screen", children: [
            { type: "ref", id: "c1", ref: "card", width: 200, descendants: { "cb/label": { content: "Buy" }, cb: { fill: "#ff0000" }, "cb/ic": { enabled: false } } },
          ],
        },
      ]),
    );
    expect(report).toMatchObject({ components: 2, copies: 2 });
    expect(props("btn").component).toBe(true);
    const copy = store.toTree(doc, "c1");
    expect(copy.instance).toBe("card");
    expect(copy.props.width).toBe(200);
    expect(props("c1/cb").fill).toBe("#ff0000");
    expect(props("c1/cb/label").text).toBe("Buy");
    expect(props("c1/cb/ic").visible).toBe(false);
    expect(props("c1/cb/ic").icon).toBe("arrow-right");
  });

  it("brings pictures from beside the file, and keeps missing ones as placeholders", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const { doc, report, props } = await open(
      pen([{ type: "frame", id: "f", children: [
        { type: "rectangle", id: "a", fill: { type: "image", url: "assets/a.png", mode: "contain" } },
        { type: "rectangle", id: "b", fill: [{ type: "image", url: "assets/missing.png" }] },
      ] }]),
      { "assets/a.png": bytes },
    );
    const fill = props("a").fill as { type: string; asset: string; fit: string };
    expect(fill).toMatchObject({ type: "image", fit: "contain" });
    expect(assetsOf(doc).get(fill.asset)).toEqual(bytes);
    expect(props("b").fill).toMatchObject({ type: "image", asset: "missing:assets/missing.png" });
    expect(report.pictures).toBe(1);
    expect(report.missingPictures).toEqual(["assets/missing.png"]);
  });

  it("maps strokes, shadows, gradients and rotation, and reports what it leaves out", async () => {
    const { report, props } = await open(
      pen([{ type: "frame", id: "f", children: [
        { type: "rectangle", id: "s", stroke: "$ink", strokeWidth: { bottom: 1.5 }, rotation: -6, effect: [{ type: "shadow", shadowType: "outer", color: "#16130F", offset: { x: 0, y: 4 } }, { type: "blur", radius: 4 }] },
        { type: "rectangle", id: "g", fill: { type: "gradient", gradientType: "linear", rotation: 90, colors: [{ color: "#000000", position: 0 }, { color: "#ffffff", position: 1 }] } },
        { type: "rectangle", id: "r", fill: { type: "gradient", gradientType: "radial", colors: [{ color: "#123456", position: 0 }] } },
        { type: "path", id: "p", geometry: "M0 0L10 10", width: 10, height: 10 },
        { type: "note", id: "n", content: "a note" },
      ] }], { ink: { type: "color", value: "#16130F" } }),
    );
    expect(props("s")).toMatchObject({ stroke: { color: "$ink", width: [0, 0, 1.5, 0] }, rotation: -6, shadow: { x: 0, y: 4, blur: 0, color: "#16130F" } });
    // Pen's 90° (pointing left) is Lemon's 270°.
    expect(props("g").fill).toMatchObject({ type: "linear", angle: 270 });
    expect(props("r").fill).toBe("#123456");
    expect(props("p")).toMatchObject({ width: 10, height: 10, layout: "none" });
    expect(report.leftOut).toMatchObject({
      blurs: 1,
      "radial and angular gradients (shown as their first colour)": 1,
      "vector paths (kept their space)": 1,
      "sticky notes, prompts and context notes": 1,
    });
  });

  it("refuses what isn't a Pen file", async () => {
    await expect(open("not json")).rejects.toThrow(/isn't a Pen file/);
    await expect(open(JSON.stringify({ lemon: 1, nodes: [] }))).rejects.toThrow(/isn't a Pen file/);
  });
});
