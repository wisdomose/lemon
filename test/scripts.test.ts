// Script nodes (main/scripts.ts): declared inputs, Pen's seeded Math.random, errors and missing files.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { runScript, scriptInputs } from "../src/main/scripts.js";

let sandbox: Sandbox;
const dir = mkdtempSync(join(tmpdir(), "lemon-scripts-"));
const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

beforeAll(async () => {
  sandbox = await Sandbox.create();
});

describe("script nodes", () => {
  it("reads the inputs a header declares", () => {
    const inputs = scriptInputs(` * @schema 2.11
 * @input rows: number = 3
 * @input color: color = #3B82F6
 * @input label: string = "Hello"
 * @input filled: boolean = true
 * @input layout: enum("grid", "stack") = "grid"
 * @input target: ref`);
    expect(inputs).toEqual([
      { name: "rows", type: "number", default: 3 },
      { name: "color", type: "color", default: "#3B82F6" },
      { name: "label", type: "string", default: "Hello" },
      { name: "filled", type: "boolean", default: true },
      { name: "layout", type: "enum", options: ["grid", "stack"], default: "grid" },
      { name: "target", type: "ref" },
    ]);
  });

  it("runs with the node's size and inputs, and Math.random as Pen seeds it", () => {
    const path = file(
      "bars.js",
      `/**
 * @schema 2.11
 * @input rows: number = 4
 */
return Array.from({ length: pencil.input.rows }, (_, i) => ({ type: "rectangle", y: i * 10, width: pencil.width * (0.3 + 0.7 * Math.random()), height: 8 }));`,
    );
    const out = runScript(sandbox, path, 300, 200, { rows: 4 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Pen draws these bars 147, 90, 138 and 122 px wide (measured): mulberry32 from 0.
    expect(out.nodes.map((n) => Math.round(n.width as number))).toEqual([146, 90, 137, 121]);
    const two = runScript(sandbox, path, 300, 200, { rows: 2 });
    expect(two.ok && two.nodes).toHaveLength(2);
  });

  it("reports a runtime error with where it happened and the lines around it", () => {
    const path = file("broken.js", `/** @schema 2.11 */\nreturn [{ type: "rectangle", height: notDefined }];\n`);
    const out = runScript(sandbox, path, 300, 200, {});
    expect(out).toMatchObject({ ok: false, kind: "error", title: "Script runtime error" });
    if (out.ok || out.kind !== "error") return;
    expect(out.message).toContain("ReferenceError");
    expect(out.stack.join("\n")).toContain("broken.js:2");
    expect(out.excerpt.find((l) => l.at)?.line).toBe(2);
  });

  it("asks for the schema tag, and says when the file is missing", () => {
    expect(runScript(sandbox, file("plain.js", "return [];"), 100, 100, {})).toMatchObject({ ok: false, title: "Script error" });
    expect(runScript(sandbox, join(dir, "nope.js"), 100, 100, {})).toEqual({ ok: false, kind: "missing", file: "nope.js" });
  });
});
