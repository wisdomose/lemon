// The Claude models the signed-in Claude CLI offers, asked through the SDK without running a turn.
import { query, type ModelInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeLabel, type ClaudeModel } from "./models.js";

/**
 * The SDK's rows as picker models. It lists aliases ("default", "opus", "claude-fable-5-1[1m]") beside
 * the id each resolves to: a model is kept once, under that id (what a run sends), in the SDK's order.
 */
export function toClaudeModels(infos: readonly ModelInfo[]): ClaudeModel[] {
  const models = new Map<string, ClaudeModel>();
  for (const m of infos) {
    const id = (m.resolvedModel ?? m.value).replace(/\[[^\]]*\]$/, "");
    if (models.has(id)) continue;
    const efforts = m.supportsEffort === false ? [] : m.supportedEffortLevels;
    models.set(id, { id, provider: "claude", label: claudeLabel(id) ?? m.displayName, ...(efforts ? { efforts: [...efforts] } : {}) });
  }
  return [...models.values()];
}

/** How long a discovered model list is reused before the CLI is asked again (each ask starts it). */
const MODELS_FRESH_MS = 10 * 60_000;
/** Starting the CLI and hearing back took about 7s when measured (14 Nov 2026); past this it is stuck. */
const ASK_TIMEOUT_MS = 30_000;
let known: { at: number; models: Promise<ClaudeModel[]> } | undefined;

/** The models Claude offers: asked again only when the last answer is old (or `fresh` is asked for). */
export function claudeModels(fresh = false): Promise<ClaudeModel[]> {
  if (!fresh && known && performance.now() - known.at < MODELS_FRESH_MS) return known.models;
  const models = discoverModels();
  known = { at: performance.now(), models };
  // A failed ask is not remembered.
  models.catch(() => known?.models === models && (known = undefined));
  return models;
}

async function discoverModels(): Promise<ClaudeModel[]> {
  const abort = new AbortController();
  // A prompt that never comes: the CLI starts and answers the question, and no model turn runs.
  const never = (async function* (): AsyncGenerator<SDKUserMessage> {
    await new Promise((done) => abort.signal.addEventListener("abort", done, { once: true }));
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const asked = query({
      prompt: never,
      options: { tools: [], strictMcpConfig: true, settingSources: [], persistSession: false, abortController: abort },
    }).supportedModels();
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Claude did not answer with its models.")), ASK_TIMEOUT_MS);
    });
    return toClaudeModels(await Promise.race([asked, late]));
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
