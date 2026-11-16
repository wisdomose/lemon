// Claude's model list: the SDK's alias rows become picker models, and the window keeps what it shows
// when Claude can't be asked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { toClaudeModels } from "../src/agent/claude-models.js";
import { modelLabel, type ClaudeModel } from "../src/agent/models.js";
import { bridge } from "../src/renderer/bridge.js";
import { store } from "../src/renderer/store.js";
import { effortChoices, refreshClaudeModels } from "../src/renderer/agent/model-catalog.js";

vi.mock("../src/renderer/bridge.js", () => ({ bridge: { claudeModels: vi.fn() } }));
const fetchModels = vi.mocked(bridge.claudeModels);
const levels = ["low", "medium", "high", "xhigh", "max"] as const;
const row = (value: string, resolvedModel: string | undefined, displayName: string, more: Partial<ModelInfo> = {}): ModelInfo => ({
  value, displayName, description: "", ...(resolvedModel ? { resolvedModel } : {}), supportsEffort: true, supportedEffortLevels: [...levels], ...more,
});

describe("the SDK's rows as picker models", () => {
  // The rows the SDK gave on 14 Nov 2026 (value, resolvedModel, displayName).
  const rows = [
    row("default", "claude-opus-5-5", "Default (recommended)"),
    row("opus", "claude-opus-5-5", "Opus"),
    row("claude-fable-5-1[1m]", "claude-fable-5-1", "Fable"),
    row("sonnet", "claude-sonnet-5-5", "Sonnet"),
    row("haiku", "claude-haiku-5-5", "Haiku"),
  ];

  it("keeps each model once under the id it resolves to, named from that id, in the SDK's order", () => {
    expect(toClaudeModels(rows).map((m) => [m.id, m.label])).toEqual([
      ["claude-opus-5-5", "Claude Opus 5.5"],
      ["claude-fable-5-1", "Claude Fable 5.1"],
      ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
      ["claude-haiku-5-5", "Claude Haiku 5.5"],
    ]);
    expect(toClaudeModels(rows)[0]).toMatchObject({ provider: "claude", efforts: [...levels] });
  });

  it("falls back to the row's own value and name, without a context-window suffix", () => {
    expect(toClaudeModels([row("some-model[1m]", undefined, "Some Model")])).toMatchObject([{ id: "some-model", label: "Some Model" }]);
  });

  it("carries a model's own effort levels: none when it takes no effort, unknown when it doesn't say", () => {
    const [none, some, unknown] = toClaudeModels([
      row("a", "claude-a-1-0", "A", { supportsEffort: false }),
      row("b", "claude-b-1-0", "B", { supportedEffortLevels: ["low", "high"] }),
      { value: "c", resolvedModel: "claude-c-1-0", displayName: "C", description: "" },
    ]);
    expect(none!.efforts).toEqual([]);
    expect(some!.efforts).toEqual(["low", "high"]);
    expect(unknown!.efforts).toBeUndefined();
  });
});

describe("Claude's models in the window", () => {
  const next: ClaudeModel = { id: "claude-opus-6-0", provider: "claude", label: "Claude Opus 6.0", efforts: ["low", "high"] };
  beforeEach(() => {
    fetchModels.mockReset();
    store.set({ model: "claude-opus-5-5", effort: undefined, claudeModels: [] });
  });

  it("names a Claude model the built-in list doesn't have", () => {
    expect(modelLabel("claude-opus-6-0")).toBe("Claude Opus 6.0");
    expect(modelLabel("claude-opus-6-0", [{ ...next, label: "Opus Six" }])).toBe("Opus Six");
  });

  it("offers a listed model's own effort levels, and the built-in ones until it is listed", () => {
    expect(effortChoices(next.id, [], [], [next])).toEqual({ levels: ["low", "high"] });
    expect(effortChoices(next.id, [], [], []).levels).toEqual([...levels]);
    expect(effortChoices("claude-opus-5-5", [], [], [{ ...next, id: "claude-opus-5-5", efforts: ["low", "medium"] }])).toEqual({ levels: ["low", "medium"], fallback: "medium" });
  });

  it("shows Claude's list once it answers, asking once for overlapping refreshes", async () => {
    let finish!: (models: ClaudeModel[]) => void;
    fetchModels.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const first = refreshClaudeModels();
    expect(refreshClaudeModels()).toBe(first);
    expect(fetchModels).toHaveBeenCalledOnce();
    finish([next]);
    await first;
    expect(store.get().claudeModels).toEqual([next]);
  });

  it("keeps what it shows when Claude can't be asked or lists nothing", async () => {
    store.set({ claudeModels: [next] });
    fetchModels.mockRejectedValue(new Error("not signed in"));
    await refreshClaudeModels();
    expect(store.get().claudeModels).toEqual([next]);
    fetchModels.mockResolvedValue([]);
    await refreshClaudeModels();
    expect(store.get().claudeModels).toEqual([next]);
  });

  it("drops a chosen effort the selected model no longer offers, and leaves another provider's alone", async () => {
    store.set({ model: next.id, effort: "max" });
    fetchModels.mockResolvedValue([next]);
    await refreshClaudeModels();
    expect(store.get()).toMatchObject({ model: next.id, effort: undefined });
    store.set({ model: "codex:custom", effort: "ultra" });
    await refreshClaudeModels();
    expect(store.get().effort).toBe("ultra");
  });
});
