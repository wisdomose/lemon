// One in-flight request per window; reopening refreshes metadata without blanking cached choices.
import { bridge } from "../bridge.js";
import { store } from "../store.js";

let pending: Promise<void> | undefined;

export function refreshCodexModels(): Promise<void> {
  if (pending) return pending;
  store.set({ codexModelsState: "loading", codexModelsError: undefined });
  pending = bridge.codexModels().then((models) => {
    store.set((s) => {
      const selected = models.find((m) => m.id === s.model);
      // A refreshed catalog may remove an effort. Let Codex choose its default in that case.
      const effort = s.effort && selected?.efforts.some((e) => e.id === s.effort) ? s.effort : undefined;
      return { codexModels: models, codexModelsState: "ready", effort };
    });
  }).catch((error: unknown) => {
    store.set({ codexModelsState: "error", codexModelsError: error instanceof Error ? error.message : "Could not load Codex models." });
  }).finally(() => { pending = undefined; });
  return pending;
}
