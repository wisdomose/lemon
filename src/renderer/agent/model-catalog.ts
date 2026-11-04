// One in-flight request per window; reopening refreshes metadata without blanking cached choices.
import { bridge } from "../bridge.js";
import { store } from "../store.js";
import { modelProvider, type CodexModel } from "../../agent/models.js";
import { BUILT_IN_PROVIDERS, parseProviderModel, type ProviderRecord } from "../../agent/providers.js";

/**
 * The efforts offered through the Claude SDK, as in Pen (Low → Very high). The SDK turns anything it
 * doesn't know ("minimal") into "high", so only what it passes on is offered.
 */
const SDK_EFFORTS = ["low", "medium", "high", "xhigh"];
/** Claude's own models also offer Max, as in Pen (4 Nov 2026: every Claude 5.x model, Low to Max). */
const CLAUDE_EFFORTS = [...SDK_EFFORTS, "max"];
/** What the SDK sends when no effort is chosen (read from its requests): high for Fable, else medium. */
const CLAUDE_DEFAULT_EFFORT: Record<string, string> = {
  "claude-fable-5-1": "high",
  "claude-opus-5-5": "medium",
  "claude-sonnet-5-5": "medium",
  "claude-haiku-5-5": "medium",
};

/**
 * The efforts a model's row offers, and the one shown picked when none is chosen (what the run will
 * use). Claude and Anthropic-type providers go through the SDK, which sends the effort on (Z.AI
 * honours it, and gets "high" when none is chosen); a Codex model offers its own. OpenAI Completions
 * providers don't take one: their APIs don't agree on it.
 */
export function effortChoices(
  model: string,
  codexModels: readonly CodexModel[],
  providers: readonly ProviderRecord[] = [],
): { levels: string[]; fallback?: string } {
  const backend = modelProvider(model);
  if (backend === "claude") return { levels: CLAUDE_EFFORTS, ...(CLAUDE_DEFAULT_EFFORT[model] ? { fallback: CLAUDE_DEFAULT_EFFORT[model] } : {}) };
  if (backend === "provider") {
    const id = parseProviderModel(model)?.providerId;
    const provider = providers.find((p) => p.id === id) ?? BUILT_IN_PROVIDERS.find((p) => p.id === id);
    return provider?.apiType === "anthropic-messages" ? { levels: SDK_EFFORTS, fallback: "high" } : { levels: [] };
  }
  const codex = codexModels.find((m) => m.id === model);
  return { levels: codex?.efforts.map((e) => e.id) ?? [], ...(codex?.defaultEffort ? { fallback: codex.defaultEffort } : {}) };
}

let pending: Promise<void> | undefined;

/** Asks for Codex's models (`fresh`: ask Codex again rather than reuse its recent answer). */
export function refreshCodexModels(fresh = false): Promise<void> {
  if (pending) return pending;
  store.set({ codexModelsState: "loading", codexModelsError: undefined });
  pending = bridge.codexModels(fresh).then((models) => {
    store.set((s) => {
      const selected = models.find((m) => m.id === s.model);
      // A refreshed catalog may remove an effort. Let Codex choose its default in that case. Another
      // provider's model keeps its effort: the catalog says nothing about it.
      const effort = s.model.startsWith("codex") && !selected?.efforts.some((e) => e.id === s.effort) ? undefined : s.effort;
      return { codexModels: models, codexModelsState: "ready", effort };
    });
  }).catch((error: unknown) => {
    store.set({ codexModelsState: "error", codexModelsError: error instanceof Error ? error.message : "Could not load Codex models." });
  }).finally(() => { pending = undefined; });
  return pending;
}

/** Reads the AI providers again (after a key or a provider page changed something). */
export function refreshProviders(): Promise<void> {
  return bridge.listProviders()
    .then((providers) => store.set({ providers }))
    .catch(() => {});
}
