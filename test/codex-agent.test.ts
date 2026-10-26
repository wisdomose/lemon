// Provider-independent canvas behavior must survive routing through Codex, including teams and rollback.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { runAgent, type AgentEvent } from "../src/agent/agent.js";
import { runTeam } from "../src/agent/team.js";
import { runCodex } from "../src/agent/codex.js";
import { toTree } from "../src/doc/store.js";
import { setup } from "./helpers.js";

vi.mock("../src/agent/codex.js", () => ({ runCodex: vi.fn() }));
const provider = vi.mocked(runCodex);
const response = { reply: "Done", durationMs: 1, tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } };
beforeEach(() => { provider.mockReset(); });

describe("Codex canvas integration", () => {
  it("executes validated scripts, rolls back failures, and clears generating marks", async () => {
    const doc = new Y.Doc();
    const events: AgentEvent[] = [];
    provider.mockImplementation(async (o) => {
      expect(() => o.tool!.call({ title: 42 })).toThrow();
      const failed = await o.tool!.call({ title: "Failed step", script: 'doc.insert(null, { type: "frame", name: "Discard" }); throw new Error("undo");' });
      expect(failed.isError).toBe(true);
      expect(toTree(doc).children).toHaveLength(0);
      const valid = await o.tool!.call({ title: "Draw frame", script: 'doc.insert(null, { type: "frame", name: "Keep", width: 200, height: 100, generating: true });' });
      expect(valid.isError).toBeUndefined();
      o.onText?.("Done", "reply");
      return response;
    });
    const stats = await runAgent({ ...await setup(), doc, prompt: "Draw", model: "codex", onEvent: (e) => events.push(e) });
    expect(stats.ok).toBe(true);
    expect(stats.steps.map((s) => s.ok)).toEqual([false, true]);
    expect(toTree(doc).children.map((c) => c.props.name)).toEqual(["Keep"]);
    expect(toTree(doc).children[0]!.props.generating).toBeUndefined();
    expect(events).toContainEqual({ type: "text", text: "Done", streamId: "reply" });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("uses Codex for split-work planning and every team member", async () => {
    const plan = JSON.stringify({ summary: "Simple", vars: {}, layout: "page", name: "Page", width: 800, parts: [{ name: "Hero", brief: "First" }, { name: "Footer", brief: "Last" }] });
    let planning = 0;
    let building = 0;
    provider.mockImplementation(async (o) => {
      expect(o.model).toBe("codex");
      expect(o.effort).toBe("ultra");
      if (!o.tool) { planning++; return { ...response, reply: plan }; }
      building++;
      const r = await o.tool.call({ title: "Build part", script: 'doc.insert(mine, { type: "rect", width: 10, height: 10 });' });
      expect(r.isError).toBeUndefined();
      return response;
    });
    const doc = new Y.Doc();
    const stats = await runTeam({ ...await setup(), doc, prompt: "A page", model: "codex", effort: "ultra", team: { count: 2, mode: "split" } });
    expect(planning).toBe(3);
    expect(building).toBe(2);
    expect(stats.every((s) => s.ok)).toBe(true);
    expect(toTree(doc).children[0]!.children.map((c) => c.children.length)).toEqual([1, 1]);
  });
});
