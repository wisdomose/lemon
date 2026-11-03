// The gallery's scripts and design systems ("Choose a style"): each listed one has its file, and every
// script runs as a script node runs it (src/main/scripts.ts), returning nodes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SCRIPTS } from "../src/agent/script-library.js";
import { DESIGN_SYSTEMS } from "../src/agent/design-systems.js";
import { runScript } from "../src/main/scripts.js";
import { Sandbox } from "../src/sandbox/sandbox.js";

const src = join(import.meta.dirname, "..", "src");
let sandbox: Sandbox;
beforeAll(async () => {
  sandbox = await Sandbox.create();
});

describe("script library", () => {
  for (const s of SCRIPTS) {
    it(`${s.name} runs at its own size and returns nodes`, () => {
      const out = runScript(sandbox, join(src, "main", "script-library", `${s.id}.js`), s.width, s.height, {});
      expect(out.ok ? "" : out.kind === "error" ? out.message : "missing").toBe("");
      if (out.ok) expect(out.nodes.length).toBeGreaterThan(0);
      expect(existsSync(join(src, "renderer", "agent", "scripts", `${s.id}.webp`))).toBe(true);
    });
  }
});

describe("design systems", () => {
  it("every one with a picture has its file, with reusable components", () => {
    for (const d of DESIGN_SYSTEMS) {
      if (!existsSync(join(src, "renderer", "agent", "design-systems", `${d.id}.webp`))) continue;
      const file = join(src, "main", "design-systems", `${d.id}.pen`);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain('"reusable": true');
    }
  });
});
