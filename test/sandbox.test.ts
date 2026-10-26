import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { execute } from "../src/agent/execute.js";
import { FailedScripts } from "../src/agent/patches.js";
import { run, setup } from "./helpers.js";

describe("sandbox", () => {
  it("cannot reach the host: no process, require, modules, fetch or host objects", async () => {
    const { sandbox } = await setup();
    const probes = {
      process: "typeof process",
      require: "typeof require",
      fetch: "typeof fetch",
      importFn: "typeof __import",
      std: "typeof std + typeof os",
      // The constructor chain only reaches the sandbox's own Function, which evaluates inside the sandbox.
      ctor: "(function(){}).constructor('return typeof process')()",
      hostLeak: "Object.getOwnPropertyNames(globalThis).filter(k => !['__host','doc','log','console','__call','__fmt'].includes(k) && /host|node|deno|electron/i.test(k)).join(',')",
    };
    for (const [name, expr] of Object.entries(probes)) {
      const r = sandbox.run("", `return ${expr};`, () => null);
      expect(r.ok, name).toBe(true);
      if (r.ok) expect(String(r.value), name).toMatch(/^(undefined|undefinedundefined|)$/);
    }
    // Dynamic import has no module loader behind it: it fails or yields nothing usable.
    const dyn = sandbox.run("", "return import('fs');", () => null);
    if (dyn.ok) expect(String(dyn.value)).not.toMatch(/function|Module/);
  });

  it("stops an endless loop at the time limit", async () => {
    const { sandbox } = await setup();
    const t0 = Date.now();
    const r = sandbox.run("", "while (true) {}", () => null, { timeMs: 300, memoryBytes: 32 << 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/longer than 0.3s/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("stops a memory hog at the memory limit, and the next run still works", async () => {
    const { sandbox } = await setup();
    const r = sandbox.run("", "const a = []; for (let i = 0; ; i++) a.push({ i, s: 'y' + i });", () => null, { timeMs: 10_000, memoryBytes: 32 << 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("out of memory");
    // Repeated huge strings are not all counted against the memory limit; the time limit stops them.
    const strings = sandbox.run("", "const a = []; while (true) a.push('x'.repeat(1e5) + Math.random());", () => null, { timeMs: 1000, memoryBytes: 32 << 20 });
    expect(strings.ok).toBe(false);
    const again = sandbox.run("", "return 1 + 1;", () => null);
    expect(again).toEqual({ ok: true, value: 2, globals: {} });
  }, 20_000);

  it("reports the script's own line number", async () => {
    const sandbox = await Sandbox.create();
    const r = sandbox.run("const x = 1;", "const a = 1;\nconst b = 2;\nundefinedFn();", () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(3);
  });
});

describe("execute (the agent's tool)", () => {
  it("builds a section, returns refs, checks it and draws it", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `
      doc.setVars({ paper: "#f6f1e7", ink: "#1b1a17", accent: "#c4572f" });
      const page = doc.insert(null, { type: "frame", name: "Landing", width: 1440, fill: "$paper", ref: "page" });
      const hero = doc.insert(page, { type: "frame", name: "Hero", width: "fill", padding: [96, 120], gap: 24 });
      doc.insert(hero, { type: "text", ref: "title", text: "Slow mornings above the Tagus.", font: "Fraunces", size: 88, weight: 600, color: "$ink", width: "fill" });
      doc.insert(hero, { type: "text", text: "Coffee, pastries and a terrace with a view.", size: 22, color: "$ink" });
      const button = doc.insert(hero, { type: "frame", layout: "row", padding: [16, 28], radius: 999, fill: "$accent" });
      doc.insert(button, { type: "text", text: "Reserve a table", size: 18, weight: 600, color: "#ffffff" });
      doc.screenshot(page);
      return doc.get(page, 1);
    `);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.refs.title).toBeTypeOf("string");
    expect(r.frames).toEqual([r.refs.page]);
    expect(r.pictures).toHaveLength(1);
    expect(r.pictures[0]!.png.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47])); // "PNG"
    expect(r.issues.some((i) => i.kind === "hard-coded-colour")).toBe(true); // the white button text
    expect(r.timings.attempts).toBeGreaterThanOrEqual(1);
    const page = r.value as { box: { w: number; h: number } };
    expect(page.box.w).toBe(1440);
  });

  it("appends in order when a script leaves out the position", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `
      const page = doc.insert(null, { type: "frame", name: "Page" });
      for (const name of ["Header", "Hero", "Footer"]) doc.insert(page, { type: "frame", name });
      doc.insert(page, { type: "frame", name: "Top" }, 0);
      return doc.get(page, 1).children.map((c) => c.name);
    `);
    expect(r.value).toEqual(["Top", "Header", "Hero", "Footer"]);
  });

  it("rolls back everything when the script fails part-way", async () => {
    const doc = new Y.Doc();
    await run(doc, `doc.insert(null, { type: "frame", name: "Existing" });`);
    const before = JSON.stringify(store.toTree(doc));
    const r = await run(doc, `
      const f = doc.insert(null, { type: "frame", name: "Half-built" });
      doc.insert(f, { type: "text", text: "one" });
      doc.update("no-such-id", { text: "two" });
    `);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/No node with id "no-such-id"/);
    expect(r.error?.line).toBe(4);
    expect(JSON.stringify(store.toTree(doc))).toBe(before);
  });

  it("inserts one node at a time: children are refused", async () => {
    const r = await run(new Y.Doc(), `doc.insert(null, { type: "frame", children: [{ type: "text", text: "x" }] });`);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/adds one node/);
  });

  it("keeps values assigned without const/let for the next script, and none from a failed one", async () => {
    const { engine, sandbox } = await setup();
    const doc = new Y.Doc();
    const first = await execute(doc, engine, sandbox, `const local = 1; page = doc.insert(null, { type: "frame" }); helper = () => 1; return local;`, "test");
    expect(Object.keys(first.globals)).toEqual(["page"]);
    const failed = await execute(doc, engine, sandbox, `stray = 2; throw new Error("no");`, "test", undefined, first.globals);
    expect(failed.globals).toEqual(first.globals);
    const second = await execute(doc, engine, sandbox, `doc.insert(page, { type: "text", text: "Hi" }); return typeof helper;`, "test", undefined, first.globals);
    expect(second.ok).toBe(true);
    expect(second.value).toBe("undefined");
    expect(store.toTree(doc).children[0]!.children).toHaveLength(1);
  });

  it("fixes a failed script with edits, which must each match once", () => {
    const failed = new FailedScripts();
    const id = failed.keep(`doc.insert(null, { type: "frame", fill: "#zzz" });\nreturn 1;`);
    expect(failed.patch(id, [{ find: "#zzz", replace: "#fff" }, { find: "#fff", replace: "#000" }])).toBe(`doc.insert(null, { type: "frame", fill: "#000" });\nreturn 1;`);
    expect(() => failed.patch(id, [{ find: "nope", replace: "" }])).toThrow(/doesn't match/);
    expect(() => failed.patch(id, [{ find: "e", replace: "" }])).toThrow(/more than once/);
    // A failed patch is kept under the same id; later edits match the patched script.
    failed.keep(`return 2;`, id);
    expect(failed.patch(id, [{ find: "2", replace: "3" }])).toBe("return 3;");
    failed.done(id);
    expect(() => failed.patch(id, [])).toThrow(/no failed script/);
  });

  it("handles a heavy chart (565 rectangles) and 1,000 small reads", async () => {
    const doc = new Y.Doc();
    const chart = await run(doc, `
      const f = doc.insert(null, { type: "frame", name: "Chart", layout: "none", width: 1200, height: 500, fill: "#101418" });
      for (let i = 0; i < 565; i++) {
        const h = 40 + ((i * 37) % 300);
        doc.insert(f, { type: "rect", x: 10 + i * 2, y: 450 - h, width: 1.5, height: h, fill: i % 2 ? "#3fb950" : "#f85149" });
      }
      return doc.get(f, 0).childCount;
    `);
    expect(chart.ok).toBe(true);
    expect(chart.value).toBe(565);
    const reads = await run(doc, `
      const id = doc.page()[0].id;
      let n = 0;
      for (let i = 0; i < 1000; i++) n += doc.get(id, 0).childCount > 0 ? 1 : 0;
      return n;
    `);
    expect(reads.value).toBe(1000);
    // Logged for the proof report.
    console.log("chart:", chart.timings, "reads:", reads.timings, "nodes:", store.toTree(doc).children[0]!.children.length);
  });
});
