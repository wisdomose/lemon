// Verify refresh races and failure recovery independently of the desktop bridge and model calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexModel } from "../src/agent/models.js";
import { bridge } from "../src/renderer/bridge.js";
import { store } from "../src/renderer/store.js";
import { refreshCodexModels } from "../src/renderer/agent/model-catalog.js";

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
});
