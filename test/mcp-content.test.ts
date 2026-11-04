import { describe, expect, it } from "vitest";
import { SKILL_FILES, answerLocally, getStyle, readSkill } from "../src/mcp/content.js";
import { DIRECTIONS } from "../src/agent/directions.js";
import { INSTRUCTIONS } from "../src/agent/instructions.js";

describe("read_skill", () => {
  it("serves SKILL.md, and every file it points to", () => {
    const skill = readSkill();
    for (const [, path] of skill.matchAll(/\]\(\.\/([^)]+)\)/g)) expect(SKILL_FILES[path!], path).toBeDefined();
    expect(readSkill("./execute.md")).toBe(readSkill("execute.md"));
  });

  it("tells outside agents the MCP tool's words, not the app agent's", () => {
    const execute = readSkill("execute.md");
    expect(execute).toContain("`filePath`");
    expect(execute).toContain("instead of `input`");
    expect(execute).not.toContain("instead of a `script`");
    // The app's own agent keeps its words.
    expect(INSTRUCTIONS).toContain("instead of a `script`");
  });

  it("names the files it has when asked for one it hasn't", () => {
    expect(() => readSkill("guide/web-app.md")).toThrow(/SKILL\.md, execute\.md/);
  });
});

describe("get_style", () => {
  it("lists every style, and loads one by name or id", () => {
    const list = getStyle();
    for (const d of DIRECTIONS) expect(list).toContain(`"${d.name}"`);
    const d = DIRECTIONS[0]!;
    expect(getStyle(d.name.toUpperCase())).toContain(d.composition);
    expect(getStyle(d.id)).toBe(getStyle(d.name));
  });

  it("answers a style it hasn't as an error", () => {
    expect(answerLocally("get_style", { name: "Nope" })).toMatchObject({ isError: true });
    expect(answerLocally("execute", {})).toBeUndefined();
  });
});
