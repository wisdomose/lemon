// "Let it cook": after the first design the agent goes on to more variations, each a further turn of
// the same conversation (as in Pen, checked 2 Nov 2026), for Claude and for Codex alike.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runAgent, type AgentEvent } from "../src/agent/agent.js";
import { runCodex } from "../src/agent/codex.js";
import { setup } from "./helpers.js";

vi.mock("../src/agent/codex.js", () => ({ runCodex: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn(), tool: vi.fn(() => ({})), createSdkMcpServer: vi.fn(() => ({})) }));
const codex = vi.mocked(runCodex);
const claude = vi.mocked(query);
const response = { reply: "Done", durationMs: 1, tokens: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } };
beforeEach(() => { codex.mockReset(); claude.mockReset(); });

/** A Claude conversation that answers every message it is sent with a finished turn. */
function claudeAnswering(sent: string[]) {
  claude.mockImplementation(({ prompt }) => {
    async function* run() {
      const messages = typeof prompt === "string" ? [{ message: { content: prompt } }] : prompt;
      let n = 0;
      for await (const m of messages) {
        sent.push(String(m.message.content));
        n++;
        yield { type: "result", subtype: "success", is_error: false, result: `Design ${n}`, duration_api_ms: 1, num_turns: n, total_cost_usd: n / 10, modelUsage: { m: { inputTokens: n, outputTokens: n, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } };
      }
    }
    return run() as never;
  });
}

describe("variations", () => {
  it("sends Claude one more turn per variation, in the same conversation", async () => {
    const sent: string[] = [];
    claudeAnswering(sent);
    const events: AgentEvent[] = [];
    const stats = await runAgent({ ...(await setup()), doc: new Y.Doc(), prompt: "A sign-in screen", model: "claude-opus-5-5", variants: { count: 3, mode: "layout" }, onEvent: (e) => events.push(e) });
    expect(claude).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatch(/^A sign-in screen\n\nThis is the first of several variations\./);
    for (const next of sent.slice(1)) {
      expect(next).toMatch(/^Now design another variation of this page\./);
      expect(next).toContain("Keep the first design's style");
      expect(next).toContain("<canvas>");
    }
    expect(events.filter((e) => e.type === "iterating")).toHaveLength(2);
    // Totals are the conversation's running ones, not added up turn by turn.
    expect(stats).toMatchObject({ ok: true, reply: "Design 3", costUsd: 0.3, tokens: { input: 3, output: 3 } });
  });

  it("asks for a new style, with new starting points, in Style mode", async () => {
    const sent: string[] = [];
    claudeAnswering(sent);
    await runAgent({ ...(await setup()), doc: new Y.Doc(), prompt: "A sign-in screen", model: "claude-opus-5-5", variants: { count: 2, mode: "style" } });
    expect(sent[1]).toContain("Give it a new style");
    const first = /<starting-points>(.*)<\/starting-points>/.exec(sent[0]!)![1];
    const second = /<starting-points>(.*)<\/starting-points>/.exec(sent[1]!)![1];
    expect(second).not.toBe(first);
  });

  it("sends a single message, with no note about variations, when there are none", async () => {
    const sent: string[] = [];
    claudeAnswering(sent);
    await runAgent({ ...(await setup()), doc: new Y.Doc(), prompt: "A sign-in screen", model: "claude-opus-5-5" });
    expect(sent).toHaveLength(1);
    expect(claude.mock.calls[0]![0].prompt).toBeTypeOf("string");
    expect(sent[0]).not.toContain("variation");
  });

  it("stops after a turn that failed", async () => {
    claude.mockImplementation(({ prompt }) => {
      async function* run() {
        for await (const _ of prompt as AsyncIterable<unknown>) yield { type: "result", subtype: "error_max_turns", is_error: true, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0, modelUsage: {} };
      }
      return run() as never;
    });
    const events: AgentEvent[] = [];
    await runAgent({ ...(await setup()), doc: new Y.Doc(), prompt: "A page", model: "claude-opus-5-5", variants: { count: 4, mode: "layout" }, onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.type === "iterating")).toBe(false);
  });

  it("asks Codex for each next variation on the same thread", async () => {
    const asked: (string | undefined)[] = [];
    codex.mockImplementation(async (o) => {
      for (let next = o.followUp?.(); next !== undefined; next = o.followUp?.()) asked.push(next);
      return response;
    });
    const events: AgentEvent[] = [];
    await runAgent({ ...(await setup()), doc: new Y.Doc(), prompt: "A page", model: "codex", variants: { count: 2, mode: "layout" }, onEvent: (e) => events.push(e) });
    expect(codex.mock.calls[0]![0].prompt).toContain("This is the first of several variations.");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/^Now design another variation/);
    expect(events.filter((e) => e.type === "iterating")).toHaveLength(1);
  });
});
