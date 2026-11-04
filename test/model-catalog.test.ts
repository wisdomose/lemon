// Verify refresh races and failure recovery independently of the desktop bridge and model calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexModel } from "../src/agent/models.js";
import { bridge } from "../src/renderer/bridge.js";
import { store } from "../src/renderer/store.js";
import { effortChoices, refreshCodexModels } from "../src/renderer/agent/model-catalog.js";

vi.mock("../src/renderer/bridge.js", () => ({ bridge: { codexModels: vi.fn() } }));
const fetchModels = vi.mocked(bridge.codexModels);
const model: CodexModel = { id: "codex:custom", provider: "codex", label: "Custom", description: "", efforts: [{ id: "ultra", description: "Deep" }], defaultEffort: "ultra", isDefault: true };

beforeEach(() => {
  fetchModels.mockReset();
  store.set({ model: "codex", effort: undefined, codexModels: [], codexModelsState: "idle", codexModelsError: undefined });
});

describe("model catalog refresh", () => {
  it("deduplicates overlapping requests and preserves cached choices while refreshing", async () => {
    let finish!: (models: CodexModel[]) => void;
    fetchModels.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    store.set({ codexModels: [model] });
    const first = refreshCodexModels();
    expect(store.get().codexModelsState).toBe("loading");
    expect(store.get().codexModels).toEqual([model]);
    expect(refreshCodexModels()).toBe(first);
    expect(fetchModels).toHaveBeenCalledOnce();
    finish([model]);
    await first;
    expect(store.get().codexModelsState).toBe("ready");
    fetchModels.mockResolvedValue([]);
    await refreshCodexModels();
    expect(fetchModels).toHaveBeenCalledTimes(2);
    expect(store.get().codexModels).toEqual([]);
  });

  it("keeps cached models after errors and supports retry", async () => {
    store.set({ codexModels: [model], model: model.id, effort: "ultra" });
    fetchModels.mockRejectedValue(new Error("CLI unavailable"));
    await refreshCodexModels();
    expect(store.get()).toMatchObject({ codexModelsState: "error", codexModelsError: "CLI unavailable", codexModels: [model], effort: "ultra" });
    fetchModels.mockResolvedValue([model]);
    await refreshCodexModels();
    expect(store.get()).toMatchObject({ codexModelsState: "ready", effort: "ultra" });
    expect(store.get().codexModelsError).toBeUndefined();
  });

  it("clears unsupported efforts without silently switching selected models", async () => {
    store.set({ model: model.id, effort: "removed" });
    fetchModels.mockResolvedValue([model]);
    await refreshCodexModels();
    expect(store.get().effort).toBeUndefined();
    expect(store.get().model).toBe(model.id);
    store.set({ effort: "ultra" });
    fetchModels.mockResolvedValue([]);
    await refreshCodexModels();
    expect(store.get().effort).toBeUndefined();
    expect(store.get().model).toBe(model.id);
  });

  it("keeps a Claude effort when the Codex catalog refreshes (opening the model picker)", async () => {
    store.set({ model: "claude-opus-5-5", effort: "low" });
    fetchModels.mockResolvedValue([model]);
    await refreshCodexModels();
    expect(store.get().effort).toBe("low");
  });
});

describe("effort choices", () => {
  const sdk = ["low", "medium", "high", "xhigh"];
  it("offers Claude's levels up to Max (as Pen does), marking what the SDK sends when none is chosen", () => {
    expect(effortChoices("claude-opus-5-5", [])).toEqual({ levels: [...sdk, "max"], fallback: "medium" });
    expect(effortChoices("claude-fable-5-1", [])).toEqual({ levels: [...sdk, "max"], fallback: "high" });
  });

  it("offers a Codex model's own levels with its default", () => {
    expect(effortChoices(model.id, [model])).toEqual({ levels: ["ultra"], fallback: "ultra" });
    expect(effortChoices("codex", [model]).levels).toEqual([]);
  });

  it("offers them for Anthropic-type providers (built-in or custom) but not OpenAI Completions ones", () => {
    expect(effortChoices("prov:zai:glm-5.3", [])).toEqual({ levels: sdk, fallback: "high" });
    expect(effortChoices("prov:deepseek:deepseek-chat", []).levels).toEqual([]);
    const custom = { id: "c1", name: "Z.AI 2", apiType: "anthropic-messages" as const, baseUrl: "https://api.z.ai/api/anthropic", models: [{ id: "GLM-5.3", contextWindow: 0, maxTokens: 0 }] };
    expect(effortChoices("prov:c1:GLM-5.3", [], [custom]).levels).toEqual(sdk);
    expect(effortChoices("prov:c1:GLM-5.3", [], [{ ...custom, apiType: "openai-completions" }]).levels).toEqual([]);
    expect(effortChoices("prov:gone:x", []).levels).toEqual([]);
  });
});
