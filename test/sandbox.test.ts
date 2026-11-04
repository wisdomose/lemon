import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as store from "../src/doc/store.js";
import { Sandbox } from "../src/sandbox/sandbox.js";
import { LiveRun, execute, type Focus } from "../src/agent/execute.js";
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
  it("builds a section with Pen's API, names what it made, checks it and draws it", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `
      SetVariables({ paper: { type: "color", value: "#f6f1e7" }, ink: { type: "color", value: "#1b1a17" }, accent: { type: "color", value: "#c4572f" } });
      const page = Insert(document, { type: "frame", name: "Landing", width: 1440, layout: "vertical", fill: "$paper" });
      const hero = Insert(page, { type: "frame", name: "Hero", layout: "vertical", width: "fill_container", padding: [96, 120], gap: 24 });
      Insert(hero, { type: "text", name: "Title", content: "Slow mornings above the Tagus.", fontFamily: "Fraunces", fontSize: 88, fontWeight: "600", fill: "$ink", textGrowth: "fixed-width", width: "fill_container" });
      Insert(hero, { type: "text", name: "Lede", content: "Coffee, pastries and a terrace with a view.", fontSize: 22, fill: "$ink" });
      const button = Insert(hero, { type: "frame", name: "Button", padding: [16, 28], cornerRadius: 999, fill: "$accent" });
      Insert(button, { type: "text", name: "Label", content: "Reserve a table", fontSize: 18, fontWeight: "600", fill: "#ffffff" });
      TakeScreenshot([page]);
      return Get(page, { depth: 1 });
    `);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    const title = r.created.find((c) => c.name === "Title");
    expect(title?.type).toBe("text");
    const page = r.created.find((c) => c.name === "Landing")!.id;
    expect(r.frames).toEqual([page]);
    expect(r.pictures).toHaveLength(1);
    expect(r.pictures[0]!.png.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47])); // "PNG"
    expect(r.issues.some((i) => i.kind === "hard-coded-colour")).toBe(true); // the white button text
    expect(r.timings.attempts).toBeGreaterThanOrEqual(1);
    // Get returns .pen data: the node's own properties, children nested to the depth asked.
    const got = r.value as { type: string; width: number; children: { name: string; children: unknown }[] };
    expect(got).toMatchObject({ type: "frame", width: 1440, fill: "$paper" });
    expect(got.children.map((c) => c.name)).toEqual(["Hero"]);
    expect(got.children[0]!.children).toBe("...");
  });

  it("appends in order, and Move puts a node at an index", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `
      const page = Insert(document, { type: "frame", name: "Page" });
      for (const name of ["Header", "Hero", "Footer"]) Insert(page, { type: "frame", name });
      const top = Insert(page, { type: "frame", name: "Top" });
      Move(top, undefined, 0);
      return Get(page, { depth: 1 }).children.map((c) => c.name);
    `);
    expect(r.value).toEqual(["Top", "Header", "Hero", "Footer"]);
  });

  it("visits a subtree with bounds and problems, and resolves variables when asked", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `
      SetVariables({ ink: { type: "color", value: "#111111" } });
      const box = Insert(document, { type: "frame", name: "Box", width: 100, height: 40, clip: true });
      Insert(box, { type: "rectangle", name: "Wide", width: 150, height: 10, fill: "$ink" });
      const rows = Get(box, (n, c) => [n.name, c.depth, c.bounds.width, c.problems ?? null]);
      const fills = Get(box, (n) => n.fill, { resolveVariables: true });
      return { rows, fills };
    `);
    expect(r.value).toEqual({ rows: [["Box", 0, 100, null], ["Wide", 1, 150, "partially clipped"]], fills: ["#111111"] });
  });

  it("rolls back everything when the script fails part-way", async () => {
    const doc = new Y.Doc();
    await run(doc, `Insert(document, { type: "frame", name: "Existing" });`);
    const before = JSON.stringify(store.toTree(doc));
    const r = await run(doc, `
      const f = Insert(document, { type: "frame", name: "Half-built" });
      Insert(f, { type: "text", content: "one" });
      Update("no-such-id", { content: "two" });
    `);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/no node "no-such-id"/);
    expect(r.error?.line).toBe(4);
    expect(JSON.stringify(store.toTree(doc))).toBe(before);
  });

  it("inserts one node at a time, and refuses what Pen doesn't support", async () => {
    const one = await run(new Y.Doc(), `Insert(document, { type: "frame", children: [{ type: "text", content: "x" }] });`);
    expect(one.error?.message).toMatch(/adds one node/);
    const pct = await run(new Y.Doc(), `Insert(document, { type: "frame", width: "50%" });`);
    expect(pct.error?.message).toMatch(/percentages/);
    const pad = await run(new Y.Doc(), `Insert(document, { type: "text", content: "x", padding: 4 });`);
    expect(pad.error?.message).toMatch(/frames only/);
    const obj = await run(new Y.Doc(), `const f = Get(Insert(document, { type: "frame" })); Insert(f, { type: "text" });`);
    expect(obj.error?.message).toMatch(/pass its \.id/);
  });

  it("makes instances of components, changes their nodes, fills slots and copies", async () => {
    const doc = new Y.Doc();
    const r = await run(doc, `
      const card = Insert(document, { type: "frame", name: "Card", reusable: true, layout: "vertical" });
      const title = Insert(card, { type: "text", name: "Title", content: "Title", fill: "#000000" });
      const slot = Insert(card, { type: "frame", name: "Slot", slot: [] });
      const page = Insert(document, { type: "frame", name: "Page", layout: "vertical" });
      const a = Insert(page, { type: "ref", ref: card, descendants: { Title: { content: "By name" } } });
      Insert(a + "/" + slot, { type: "text", name: "Inside", content: "In the slot", fill: "#000000" });
      const b = Copy(card, page, { descendants: { [title]: { content: "Copied" } } });
      const plain = Copy(page, document, { name: "Page 2" });
      return [Get(a, { resolveInstances: true }), Get(b), Get(plain, { depth: 1 }).children.length];
    `);
    expect(r.error).toBeUndefined();
    const [a, b, count] = r.value as [{ children: { content?: string; children?: { content: string }[] }[] }, { type: string; descendants: Record<string, unknown> }, number];
    expect(a.children[0]!.content).toBe("By name");
    expect(a.children[1]!.children![0]!.content).toBe("In the slot");
    expect(b.type).toBe("ref");
    expect(Object.values(b.descendants)).toEqual([{ content: "Copied" }]);
    expect(count).toBe(2);
  });

  it("keeps values assigned without const/let for the next script, and none from a failed one", async () => {
    const { engine, sandbox } = await setup();
    const doc = new Y.Doc();
    const first = await execute(doc, engine, sandbox, `const local = 1; page = Insert(document, { type: "frame" }); helper = () => 1; return local;`, "test");
    expect(Object.keys(first.globals)).toEqual(["page"]);
    const failed = await execute(doc, engine, sandbox, `stray = 2; throw new Error("no");`, "test", undefined, first.globals);
    expect(failed.globals).toEqual(first.globals);
    const second = await execute(doc, engine, sandbox, `Insert(page, { type: "text", content: "Hi" }); return typeof helper;`, "test", undefined, first.globals);
    expect(second.ok).toBe(true);
    expect(second.value).toBe("undefined");
    expect(store.toTree(doc).children[0]!.children).toHaveLength(1);
  });

  it("fixes a failed script with edits, which must each match once", () => {
    const failed = new FailedScripts();
    const id = failed.keep(`Insert(document, { type: "frame", fill: "#zzz" });\nreturn 1;`);
    expect(failed.patch(id, [{ find: "#zzz", replace: "#fff" }, { find: "#fff", replace: "#000" }])).toBe(`Insert(document, { type: "frame", fill: "#000" });\nreturn 1;`);
    expect(() => failed.patch(id, [{ find: "nope", replace: "" }])).toThrow(/doesn't match/);
    expect(() => failed.patch(id, [{ find: "e", replace: "" }])).toThrow(/more than once/);
    // A failed patch is kept under the same id; later edits match the patched script.
    failed.keep(`return 2;`, id);
    expect(failed.patch(id, [{ find: "2", replace: "3" }])).toBe("return 3;");
    failed.done(id);
    expect(() => failed.patch(id, [])).toThrow(/no failed script/);
  });

  it("the cursor follows what is placed, not the frames around it or the placeholder mark", async () => {
    const { engine, sandbox } = await setup();
    const doc = new Y.Doc();
    const seen: Focus[] = [];
    const r = await new LiveRun(doc, engine, sandbox, "test", undefined, {}, (f) => seen.push(f)).finish(`
      const page = Insert(document, { type: "frame", width: 600, placeholder: true });
      const title = Insert(page, { type: "text", content: "Hello there" });
      Update(page, { padding: 40 });
      Update(title, { fontSize: 40 });
      Update(page, { placeholder: false });
    `);
    expect(r.ok).toBe(true);
    const [page, title] = store.toTree(doc).children[0] ? [store.toTree(doc).children[0]!.id, store.toTree(doc).children[0]!.children[0]!.id] : [];
    expect(seen.map((f) => [f.id, f.created])).toEqual([
      [page, true],
      [title, true],
    ]);
    expect(r.focus).toMatchObject({ id: title, created: true });
  });

  it("handles a heavy chart (565 rectangles) and 1,000 small reads", async () => {
    const doc = new Y.Doc();
    const chart = await run(doc, `
      const f = Insert(document, { type: "frame", name: "Chart", layout: "none", width: 1200, height: 500, fill: "#101418" });
      for (let i = 0; i < 565; i++) {
        const h = 40 + ((i * 37) % 300);
        Insert(f, { type: "rectangle", x: 10 + i * 2, y: 450 - h, width: 1.5, height: h, fill: i % 2 ? "#3fb950" : "#f85149" });
      }
      return Get(f, { depth: 1 }).children.length;
    `);
    expect(chart.ok).toBe(true);
    expect(chart.value).toBe(565);
    const reads = await run(doc, `
      const id = Get(document, (n, c) => (c.depth === 1 ? n.id : undefined))[0];
      let n = 0;
      for (let i = 0; i < 1000; i++) n += Get(id, { depth: 0 }).children === "..." ? 1 : 0;
      return n;
    `);
    expect(reads.value).toBe(1000);
    // Logged for the proof report.
    console.log("chart:", chart.timings, "reads:", reads.timings, "nodes:", store.toTree(doc).children[0]!.children.length);
  });
});
