// Reading the agent's script while it is being written (src/agent/live-script.ts).
import { describe, expect, it } from "vitest";
import { partialField, scriptTarget } from "../src/agent/live-script.js";

describe("a JSON string field cut off anywhere", () => {
  const json = JSON.stringify({ title: "Build the \"hero\"", script: 'doc.update("a1", {text: "Café\\n"});\nreturn 1;' });
  it("reads the complete field and says it is complete", () => {
    expect(partialField(json, "title")).toEqual({ value: 'Build the "hero"', done: true });
  });
  it("reads every prefix without breaking, never longer than the real value", () => {
    const full = JSON.parse(json).script as string;
    for (let n = 0; n <= json.length; n++) {
      const f = partialField(json.slice(0, n), "script");
      if (f) expect(full.startsWith(f.value)).toBe(true);
    }
    expect(partialField(json, "script")).toEqual({ value: full, done: true });
  });
  it("is undefined until the field has begun", () => {
    expect(partialField('{"title": "x", "scr', "script")).toBeUndefined();
  });
});

describe("where an unfinished script will work", () => {
  const ids = new Set(["page", "hero", "title"]);
  const exists = (id: string) => ids.has(id);

  it("follows the script's changes in order, to the last one written so far", () => {
    const script = 'doc.update("hero", { fill: "#fff" });\ndoc.update("title", { text: "Hi" });\ndoc.ins';
    expect(scriptTarget(script, exists)).toEqual({ id: "title" });
    expect(scriptTarget(script.slice(0, 40), exists)).toEqual({ id: "hero" });
  });
  it("adding into a frame: at the end, or at the index once the call is complete", () => {
    expect(scriptTarget('doc.insert("page", { type: "frame", children: [', exists)).toEqual({ parent: "page" });
    expect(scriptTarget('doc.insert("page", { type: "frame", children: [{ type: "text" }] }, 2);', exists)).toEqual({ parent: "page", index: 2 });
  });
  it("a new top-level frame goes to the page, with its x/y if given before its children", () => {
    expect(scriptTarget('const id = doc.insert(null, { type: "frame", width: 390', exists)).toEqual({ parent: "root" });
    expect(scriptTarget('doc.insert(null, { type: "frame", x: 40, y: 1200, children: [{ x: 5, y: 6 }] })', exists)).toEqual({
      parent: "root",
      at: { x: 40, y: 1200 },
    });
  });
  it("resolves variables set to an id", () => {
    expect(scriptTarget('const screen = "page";\ndoc.insert(screen, { type: "text"', exists)).toEqual({ parent: "page" });
  });
  it("resolves ids kept from earlier scripts", () => {
    expect(scriptTarget('doc.insert(section, { type: "text"', exists, { section: "hero" })).toEqual({ parent: "hero" });
  });
  it("ignores nodes that don't exist yet (made earlier in the same script) and reads", () => {
    const script = 'const card = doc.insert("page", { type: "frame" });\ndoc.update(card, { fill: "#000" });\ndoc.get("hero");';
    expect(scriptTarget(script, exists)).toEqual({ parent: "page" });
  });
});
