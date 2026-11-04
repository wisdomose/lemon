// Importing a page as layers: the measured boxes become .pen nodes the way Pen's Import makes them
// (compared with Pen's import of chat-buddy.xyz's header, 2 Nov 2026).
import { describe, expect, it } from "vitest";
import { imageUrls, relinkImages, toPen, type Snap } from "../src/agent/import-page.js";

const box = (over: Partial<Snap>): Snap => ({
  tag: "div", context: "div", x: 0, y: 0, w: 100, h: 20, display: "block", position: "static", direction: "row", gap: 0,
  justify: "normal", align: "normal", padding: [0, 0, 0, 0], background: null, border: null, radius: [0, 0, 0, 0], opacity: 1, clip: false,
  children: [], ...over,
});
const text = (content: string, over: Partial<Snap> = {}): Snap =>
  box({
    tag: "span", context: "span", display: "inline",
    text: { content, color: "#aeb8c4", font: "Geist", size: 14, weight: "500", lineHeight: 20, align: "center", italic: false, letterSpacing: 0, wraps: false },
    ...over,
  });

describe("toPen", () => {
  it("makes a flex header like Pen's: a bordered frame with a row of buttons", () => {
    const header = box({
      tag: "header", context: "header", w: 960, h: 44, display: "flex", align: "center", background: "#101418", clip: true,
      border: { widths: [0, 0, 1, 0], color: "#1b252d" }, padding: [0, 0, 1, 0],
      children: [
        box({ tag: "button", context: "button", w: 31, h: 32, y: 6, display: "flex", direction: "column", justify: "center", align: "center", padding: [0, 8, 0, 8], radius: [8, 8, 8, 8], children: [text("1m")] }),
      ],
    });
    const node = toPen(header) as unknown as Record<string, unknown>;
    expect(node).toMatchObject({
      type: "frame", name: "1m", context: "header", width: 960, height: 44, fill: "#101418", clip: true,
      stroke: "#1b252d", strokeWidth: { bottom: 1 }, strokeAlignment: "inner", padding: [0, 0, 1, 0], alignItems: "center",
    });
    expect(node).not.toHaveProperty("layout");
    const button = (node.children as Record<string, unknown>[])[0]!;
    expect(button).toMatchObject({ type: "frame", name: "1m", context: "button", cornerRadius: 8, layout: "vertical", padding: [0, 8], justifyContent: "center", alignItems: "center" });
    expect((button.children as unknown[])[0]).toMatchObject({ type: "text", content: "1m", fill: "#aeb8c4", fontFamily: "Geist", fontSize: 14, fontWeight: "500", lineHeight: 1.43, textAlign: "center" });
  });

  it("names a box after its only text, otherwise after its tag", () => {
    const two = box({ display: "flex", children: [text("a"), text("b", { x: 20 })] });
    expect(toPen(two)).toMatchObject({ name: "div" });
  });

  it("turns an svg icon into a frame of paths, named for the icon", () => {
    const svg = box({
      tag: "svg", context: "ChevronDown - svg", w: 16, h: 16,
      svg: { items: [{ kind: "path", x: 4, y: 6, w: 8, h: 4, d: "m6 9 6 6 6-6", fill: null, stroke: "#aeb8c4", strokeWidth: 1.33, cap: "round", join: "round" }] },
    });
    expect(toPen(svg)).toMatchObject({
      type: "frame", name: "svg", context: "ChevronDown - svg", clip: true, width: 16, height: 16, layout: "none",
      children: [{ type: "path", x: 4, y: 6, width: 8, height: 4, geometry: "m6 9 6 6 6-6", stroke: "#aeb8c4", strokeWidth: 1.33, strokeLinecap: "round" }],
    });
  });

  it("keeps an absolutely placed child where it was", () => {
    const parent = box({ display: "flex", w: 200, h: 100, children: [text("x"), box({ position: "absolute", x: 150, y: 10, w: 20, h: 20, background: "#ff0000" })] });
    const kids = (toPen(parent) as unknown as { children: Record<string, unknown>[] }).children;
    expect(kids[1]).toMatchObject({ type: "rectangle", layoutPosition: "absolute", x: 150, y: 10, fill: "#ff0000" });
  });

  it("finds and relinks the pictures it uses", () => {
    const page = box({ display: "block", children: [box({ tag: "img", image: "https://example.com/a.png", w: 50, h: 50 })] });
    const node = toPen(page, "Example");
    expect(node).toMatchObject({ name: "Example" });
    expect([...imageUrls(node)]).toEqual(["https://example.com/a.png"]);
    relinkImages(node, new Map([["https://example.com/a.png", "./images/abc.png"]]));
    expect((node as unknown as { children: { fill: { url: string } }[] }).children[0]!.fill.url).toBe("./images/abc.png");
  });
});
