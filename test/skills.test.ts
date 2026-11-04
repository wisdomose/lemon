// The prompt's "/" skills (src/main/skills.ts): Pen's own, then added ones, kept by where they are.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSkillInfo, Skills } from "../src/main/skills.js";

const skill = (dir: string, name: string, front = `name: ${name}\ndescription: About ${name}.`) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\n${front}\n---\n\n# ${name}\n`);
  return join(dir, name);
};

function setup() {
  const root = mkdtempSync(join(tmpdir(), "lemon-skills-"));
  const builtIn = join(root, "pen");
  skill(builtIn, "better-ui");
  skill(builtIn, "better-colors");
  mkdirSync(join(builtIn, "no-skill-here"));
  return { root, builtIn, skills: new Skills(join(root, "skills.json"), builtIn) };
}

describe("skills", () => {
  it("lists the built-in skills by name, then added ones in the order added", () => {
    const { root, skills } = setup();
    expect(skills.add(skill(join(root, "mine"), "zeta"))).toBeNull();
    expect(skills.add(skill(join(root, "mine"), "alpha"))).toBeNull();
    expect(skills.list().map((s) => [s.name, s.added])).toEqual([
      ["better-colors", false],
      ["better-ui", false],
      ["zeta", true],
      ["alpha", true],
    ]);
  });

  it("keeps an added skill by its SKILL.md's path, once, and forgets it without touching the folder", () => {
    const { root, skills } = setup();
    const folder = skill(join(root, "mine"), "probe");
    skills.add(folder);
    skills.add(folder);
    expect(JSON.parse(readFileSync(join(root, "skills.json"), "utf8"))).toEqual([join(folder, "SKILL.md")]);
    skills.remove(join(folder, "SKILL.md"));
    expect(skills.list().some((s) => s.added)).toBe(false);
    expect(readFileSync(join(folder, "SKILL.md"), "utf8")).toContain("# probe");
  });

  it("turns down a folder with no SKILL.md", () => {
    const { root, skills } = setup();
    mkdirSync(join(root, "empty"));
    expect(skills.add(join(root, "empty"))).toBe("There is no SKILL.md in empty.");
  });

  it("reads only listed skills", () => {
    const { root, builtIn, skills } = setup();
    expect(skills.read(join(builtIn, "better-ui", "SKILL.md"))).toContain("# better-ui");
    expect(skills.read(join(root, "skills.json"))).toBeNull();
  });

  it("takes the name from the front matter, else the folder", () => {
    const { root } = setup();
    expect(readSkillInfo(join(skill(root, "quoted", 'name: "Quoted"\ndescription: \'Says so\''), "SKILL.md"))).toEqual({ name: "Quoted", description: "Says so" });
    expect(readSkillInfo(join(skill(root, "bare", "title: none"), "SKILL.md"))).toEqual({ name: "bare", description: "" });
    // As Pen's better-interface writes its description.
    const folded = skill(root, "folded", "name: folded\ndescription: >-\n  One long line,\n  folded.\nlicense: MIT");
    expect(readSkillInfo(join(folded, "SKILL.md"))).toEqual({ name: "folded", description: "One long line, folded." });
  });
});
