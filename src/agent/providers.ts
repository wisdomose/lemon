// API-key providers (Z.AI and friends) and the ones a person adds for themselves. Shared by the agent
// (main process) and the windows (settings, model picker); key material never passes through here —
// records only ever carry a masked preview of a saved key.
export type ApiType = "openai-completions" | "anthropic-messages";

export interface ProviderModel {
  /** The model's id at the provider's API (e.g. "glm-5.3"). */
  id: string;
  /** How the picker and provider pages show it; customs show their id as typed. */
  label?: string;
  contextWindow: number;
  maxTokens: number;
  /** The model reads pictures, so an OpenAI Completions run shows it the canvas screenshots it takes. */
  images?: boolean;
}

export interface ProviderRecord {
  id: string;
  name: string;
  apiType: ApiType;
  baseUrl: string;
  models: ProviderModel[];
  /** Built-ins ship with the app: their endpoints and models are fixed, only their key is a person's. */
  builtIn?: boolean;
  /** First characters of the saved key, so pages can show that a key exists without exposing it. */
  keyMasked?: string;
  /** Extra request headers (OpenAI Completions only), e.g. for gateways that want another auth header. */
  headers?: Record<string, string>;
}

/** What an agent run needs for one provider model, resolved in the main process (key included). */
export interface ResolvedProvider {
  name: string;
  apiType: ApiType;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /** The model's id at the provider's API — not the picker's "prov:…" string. */
  model: string;
  maxTokens?: number;
  /** The model reads pictures (see ProviderModel). */
  images?: boolean;
}

/** A provider being added or changed by its page. `key` sets it ("" clears); left out keeps it. */
export interface ProviderDraft {
  id?: string;
  name: string;
  apiType: ApiType;
  baseUrl: string;
  models: ProviderModel[];
  headers?: Record<string, string>;
  key?: string | null;
}

export const API_TYPES: { value: ApiType; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];

export interface BuiltInProvider extends Omit<ProviderRecord, "keyMasked" | "builtIn"> {
  builtIn: true;
  authLabel: string;
  getStarted: { text: string; url: string; button: string };
  /** Shown with a link mark in the list: the provider routes many models, these are examples. */
  multi?: boolean;
}

/**
 * The providers that ship with the app, in the order the settings page lists them. A built-in only
 * needs its key: Lemon talks to its documented endpoint with the models shown here.
 */
export const BUILT_IN_PROVIDERS: BuiltInProvider[] = [
  {
    id: "kimi",
    name: "Kimi",
    apiType: "anthropic-messages",
    baseUrl: "https://api.moonshot.ai/anthropic",
    builtIn: true,
    models: [
      { id: "kimi-k3", label: "Kimi K3", contextWindow: 256000, maxTokens: 128000 },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", contextWindow: 256000, maxTokens: 128000 },
    ],
    authLabel: "Kimi API key",
    getStarted: {
      text: "Sign in to Moonshot AI and create a key on the API Keys page.",
      url: "https://platform.moonshot.ai/console/api-keys",
      button: "Generate Kimi key",
    },
  },
  {
    id: "deepseek",
    name: "Deepseek",
    apiType: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    builtIn: true,
    models: [
      { id: "deepseek-chat", label: "DeepSeek V4 Flash", contextWindow: 128000, maxTokens: 8192 },
      { id: "deepseek-reasoner", label: "DeepSeek V4 Pro", contextWindow: 128000, maxTokens: 8192 },
    ],
    authLabel: "DeepSeek API key",
    getStarted: {
      text: "Sign in to DeepSeek and create a key on the API Keys page.",
      url: "https://platform.deepseek.com/api_keys",
      button: "Generate DeepSeek key",
    },
  },
  {
    id: "together",
    name: "Together AI",
    apiType: "openai-completions",
    baseUrl: "https://api.together.xyz/v1",
    builtIn: true,
    multi: true,
    models: [
      { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax-M3", contextWindow: 200000, maxTokens: 128000 },
      { id: "Qwen/Qwen3.2-35B", label: "Qwen3.2 35B", contextWindow: 128000, maxTokens: 128000 },
      { id: "Qwen/Qwen3.5-397B", label: "Qwen3.5 397B", contextWindow: 128000, maxTokens: 128000 },
    ],
    authLabel: "Together AI API key",
    getStarted: {
      text: "Sign in to Together AI and create a key on the API Keys page.",
      url: "https://api.together.xyz/settings/api-keys",
      button: "Generate Together AI key",
    },
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    apiType: "openai-completions",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    builtIn: true,
    multi: true,
    models: [
      { id: "glm-5.2", label: "GLM 5.2", contextWindow: 1000000, maxTokens: 128000 },
      { id: "glm-5.1", label: "GLM 5.1", contextWindow: 1000000, maxTokens: 128000 },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", contextWindow: 128000, maxTokens: 8192 },
    ],
    authLabel: "Fireworks AI API key",
    getStarted: {
      text: "Sign in to Fireworks AI and create a key on the API Keys page.",
      url: "https://fireworks.ai/account/api-keys",
      button: "Generate Fireworks AI key",
    },
  },
  {
    id: "zai",
    name: "Z.AI",
    apiType: "anthropic-messages",
    baseUrl: "https://api.z.ai/api/anthropic",
    builtIn: true,
    models: [
      { id: "glm-5.3-flash", label: "GLM-5.3 Flash", contextWindow: 1000000, maxTokens: 128000 },
      { id: "glm-5.3", label: "GLM-5.3", contextWindow: 1000000, maxTokens: 128000 },
      { id: "glm-5.2", label: "GLM-5.2", contextWindow: 1000000, maxTokens: 128000 },
    ],
    authLabel: "Z.AI API key",
    getStarted: {
      text: "Sign in to Z.AI and create a key on the API Keys page.",
      url: "https://z.ai/manage-apikey/apikey-list",
      button: "Generate Z.AI key",
    },
  },
  {
    id: "zen",
    name: "OpenCode Zen",
    apiType: "openai-completions",
    baseUrl: "https://opencode.ai/zen/v1",
    builtIn: true,
    multi: true,
    models: [
      { id: "claude-opus-5.5", label: "Claude Opus 5.5", contextWindow: 200000, maxTokens: 128000, images: true },
      { id: "claude-sonnet-5.5", label: "Claude Sonnet 5.5", contextWindow: 200000, maxTokens: 128000, images: true },
      { id: "claude-haiku-5.5", label: "Claude Haiku 5.5", contextWindow: 200000, maxTokens: 128000, images: true },
    ],
    authLabel: "OpenCode Zen API key",
    getStarted: {
      text: "Sign in to OpenCode Zen and create a key on the API Keys page.",
      url: "https://opencode.ai/zen",
      button: "Generate OpenCode Zen key",
    },
  },
];

export const builtInProvider = (id: string): BuiltInProvider | undefined => BUILT_IN_PROVIDERS.find((p) => p.id === id);

/** A provider model as the picker stores it ("prov:zai:glm-5.3"); parseProviderModel reads it back. */
export const providerModelId = (providerId: string, modelId: string): string => `prov:${providerId}:${modelId}`;
export function parseProviderModel(id: string): { providerId: string; modelId: string } | undefined {
  const m = /^prov:([^:]+):(.+)$/.exec(id);
  return m ? { providerId: m[1]!, modelId: m[2]! } : undefined;
}

/** How a provider model is named: its label in the provider's list (or the catalog's), else its id. */
export function providerModelLabel(id: string, providers: readonly ProviderRecord[] = []): string | undefined {
  const parsed = parseProviderModel(id);
  if (!parsed) return undefined;
  const offered = (list: readonly ProviderRecord[]) => list.find((p) => p.id === parsed.providerId)?.models.find((m) => m.id === parsed.modelId)?.label;
  return offered(providers) ?? offered(BUILT_IN_PROVIDERS) ?? parsed.modelId;
}

/** A saved key shown as its first characters ("772c27656ecb…"), the way the provider pages do. */
export const maskKey = (key: string): string => (key.length <= 12 ? key : `${key.slice(0, 12)}…`);

/** The subtitle under a provider's name: customs list their models, built-ins show examples. */
export function providerSubtitle(p: ProviderRecord): string {
  const labels = p.models.map((m) => m.label ?? m.id);
  if (!labels.length) return "";
  return `${"multi" in p && p.multi ? "Multiple models, e.g. " : "e.g. "}${labels.join(" · ")}`;
}

/**
 * The order every provider list shows them in: the ones a person has set up — a key saved, which is
 * what the connection pill reports — come before the not-connected ones, so what works is never
 * buried under what needs setting up. Each block keeps its given order: built-ins stay in catalog
 * order, customs in creation order.
 */
export function orderProviders(records: ProviderRecord[]): ProviderRecord[] {
  return [...records.filter((p) => p.keyMasked), ...records.filter((p) => !p.keyMasked)];
}

// ---- What the main process accepts from a window --------------------------------------------------
const LIMITS = { name: 100, url: 2000, models: 100, modelId: 200, headers: 50, header: 4000, key: 4000 };
/** RFC 7230 token characters: what a header name may be made of. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const fail = (why: string): never => {
  throw new Error(why);
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown, what: string): number => {
  if (v === undefined || v === "") return 0;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail(`${what} must be a whole number.`);
};

/**
 * A provider page's draft, checked before the main process stores it: a window is not trusted to send
 * well-formed values, and what is stored here is later sent to the network.
 */
export function checkDraft(raw: unknown): ProviderDraft {
  if (!isRecord(raw)) fail("That provider couldn't be read.");
  const d = raw as Record<string, unknown>;
  if (d.id !== undefined && (typeof d.id !== "string" || !d.id)) fail("That provider couldn't be read.");
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name || name.length > LIMITS.name) fail("Give the provider a name (up to 100 characters).");
  if (!API_TYPES.some((t) => t.value === d.apiType)) fail("Choose an API type.");
  const baseUrl = typeof d.baseUrl === "string" ? d.baseUrl.trim() : "";
  let url: URL | undefined;
  try {
    url = new URL(baseUrl);
  } catch {
    // reported below
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || baseUrl.length > LIMITS.url) fail("The base URL must be an http(s) address.");
  if (!Array.isArray(d.models) || d.models.length > LIMITS.models) fail("A provider lists up to 100 models.");
  const models: ProviderModel[] = (d.models as unknown[]).flatMap((m): ProviderModel[] => {
    if (!isRecord(m)) return fail("That model couldn't be read.");
    const id = typeof m.id === "string" ? m.id.trim() : "";
    if (!id) return [];
    if (id.length > LIMITS.modelId) fail("A model ID is up to 200 characters.");
    return [{
      id,
      ...(typeof m.label === "string" && m.label.trim() ? { label: m.label.trim().slice(0, LIMITS.name) } : {}),
      contextWindow: count(m.contextWindow, "Context window"),
      maxTokens: count(m.maxTokens, "Max tokens"),
      ...(m.images === true ? { images: true } : {}),
    }];
  });
  if (!models.length) fail("Add at least one model.");
  let headers: Record<string, string> | undefined;
  if (d.headers !== undefined) {
    if (!isRecord(d.headers)) fail("Extra headers must be a JSON object of strings.");
    const entries = Object.entries(d.headers as Record<string, unknown>);
    if (entries.length > LIMITS.headers) fail("Up to 50 extra headers.");
    for (const [k, v] of entries) {
      if (!HEADER_NAME.test(k) || typeof v !== "string" || v.length > LIMITS.header || /[\r\n]/.test(v)) fail(`The header "${k}" isn't valid.`);
    }
    if (entries.length) headers = Object.fromEntries(entries) as Record<string, string>;
  }
  if (d.key !== undefined && d.key !== null && (typeof d.key !== "string" || d.key.length > LIMITS.key)) fail("That key couldn't be read.");
  return {
    ...(typeof d.id === "string" ? { id: d.id } : {}),
    name,
    apiType: d.apiType as ApiType,
    baseUrl,
    models,
    ...(headers ? { headers } : {}),
    ...(d.key !== undefined ? { key: d.key as string | null } : {}),
  };
}
