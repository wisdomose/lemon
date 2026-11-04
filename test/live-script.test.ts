// Reading the agent's script while it is being written (src/agent/live-script.ts).
import { describe, expect, it } from "vitest";
import { partialField, scriptTarget } from "../src/agent/live-script.js";

describe("a JSON string field cut off anywhere", () => {
  const json = JSON.stringify({ title: "Build the \"hero\"", script: 'Update("a1", {content: "Café\\n"});\nreturn 1;' });
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
  const ids = new Set(["page", "hero", "title", "card"]);
  const exists = (id: string) => ids.has(id);

  it("follows the script's changes in order, to the last one written so far", () => {
    const script = 'Update("hero", { fill: "#fff" });\nUpdate("title", { content: "Hi" });\nIns';
    expect(scriptTarget(script, exists)).toEqual({ id: "title" });
    expect(scriptTarget(script.slice(0, 36), exists)).toEqual({ id: "hero" });
  });
  it("adding into a frame: at its end", () => {
    expect(scriptTarget('Insert("page", { type: "frame", name: "Card"', exists)).toEqual({ parent: "page" });
    expect(scriptTarget('Copy("card", "page", { name: "Card 2" });', exists)).toEqual({ parent: "page" });
  });
  it("a new top-level frame goes to the document, with its x/y if given", () => {
    expect(scriptTarget('const id = Insert(document, { type: "frame", width: 390', exists)).toEqual({ parent: "document" });
    expect(scriptTarget('Insert(document, { type: "frame", x: 40, y: 1200 })', exists)).toEqual({
      parent: "document",
      at: { x: 40, y: 1200 },
    });
  });
  it("resolves variables set to an id", () => {
    expect(scriptTarget('const screen = "page";\nInsert(screen, { type: "text"', exists)).toEqual({ parent: "page" });
  });
  it("resolves ids kept from earlier scripts", () => {
    expect(scriptTarget('Insert(section, { type: "text"', exists, { section: "hero" })).toEqual({ parent: "hero" });
  });
  it("ignores nodes that don't exist yet (made earlier in the same script) and reads", () => {
    const script = 'const card2 = Insert("page", { type: "frame" });\nUpdate(card2, { fill: "#000" });\nGet("hero");';
    expect(scriptTarget(script, exists)).toEqual({ parent: "page" });
  });
});
