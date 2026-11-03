// A "prov:…" model must reach its provider: an Anthropic-type run goes through the Claude SDK with
// the provider's base URL and key in its environment (not the "isn't configured" error), including
// team planning; an unresolved provider model (its provider was removed) still says so.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Y from "yjs";
import { providerEnv, runAgent, type AgentEvent } from "../src/agent/agent.js";
import { runTeam } from "../src/agent/team.js";
import type { ResolvedProvider } from "../src/agent/providers.js";
import { listProviders, removeProvider, resolveProviderModel, saveProvider, setProviderKey } from "../src/main/provider-store.js";
import { setup } from "./helpers.js";

// The keychain the store sees: a stand-in cipher, switchable to "none" and Linux's fixed-password one.
const keychain = vi.hoisted(() => ({ available: true, backend: "gnome_libsecret" }));

// The main-process store keeps its file in a scratch userData.
vi.mock("electron", async () => {
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { mkdirSync } = await import("node:fs");
  return {
    // Like the real userData folder, the scratch dir exists before anything is written to it.
    app: {
      getPath: () => {
        const dir = join(tmpdir(), `lemon-provider-test-${process.pid}`);
        mkdirSync(dir, { recursive: true });
        return dir;
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => keychain.available,
      getSelectedStorageBackend: () => keychain.backend,
      encryptString: (s: string) => Buffer.from([...s].reverse().join(""), "utf8"),
      decryptString: (b: Buffer) => [...b.toString("utf8")].reverse().join(""),
    },
  };
});

const mock = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], reply: "Done" }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  // One turn that simply answers; tests read the options the agent passed.
  query: vi.fn(async function* (req: { options: Record<string, unknown> }) {
    mock.options.push(req.options);
    yield {
      type: "result", subtype: "success", is_error: false, result: mock.reply,
      duration_api_ms: 5, num_turns: 1, total_cost_usd: 0.01, modelUsage: {},
    };
  }),
  tool: (name: string, _description: unknown, _shape: unknown, call: unknown) => ({ name, call }),
  createSdkMcpServer: () => ({}),
}));

const zai: ResolvedProvider = {
  name: "Z.AI", apiType: "anthropic-messages", baseUrl: "https://api.z.ai/api/anthropic",
  apiKey: "zai-key", model: "glm-5.3",
};

beforeEach(() => { mock.options.length = 0; mock.reply = "Done"; });

describe("provider runs through the Claude SDK", () => {
  it("sends the resolved model to the provider's endpoint with its key", async () => {
    const events: AgentEvent[] = [];
    const stats = await runAgent({
      ...await setup(), doc: new Y.Doc(), prompt: "Draw",
      model: "prov:zai:glm-5.3", provider: zai, onEvent: (e) => events.push(e),
    });
    expect(mock.options).toHaveLength(1);
    const options = mock.options[0]!;
    expect(options.model).toBe("glm-5.3");
    const env = options.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("zai-key");
    expect(options.effort).toBeUndefined();
    expect(stats.ok).toBe(true);
    expect(stats.model).toBe("glm-5.3");
    expect(stats.reply).toBe("Done");
    expect(events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("passes the chosen effort on (the SDK sends it as output_config.effort, which Z.AI honours)", async () => {
    await runAgent({ ...await setup(), doc: new Y.Doc(), prompt: "Draw", model: "prov:zai:glm-5.3", provider: zai, effort: "xhigh" });
    expect(mock.options.at(-1)?.effort).toBe("xhigh");
  });

  it("still says so when the provider is gone (the model wasn't resolved)", async () => {
    const events: AgentEvent[] = [];
    const stats = await runAgent({
      ...await setup(), doc: new Y.Doc(), prompt: "Draw",
      model: "prov:gone:model-x", onEvent: (e) => events.push(e),
    });
    expect(mock.options).toHaveLength(0);
    expect(stats.ok).toBe(false);
    expect(stats.reply).toContain("That provider isn't configured any more.");
    expect(events).toContainEqual({ type: "error", message: "That provider isn't configured any more. Choose another model." });
  });

  it("routes split-work planning through the provider too", async () => {
    const plan = JSON.stringify({ summary: "Simple", vars: {}, layout: "page", name: "Page", width: 800, parts: [{ name: "Hero", brief: "First" }, { name: "Footer", brief: "Last" }] });
    mock.reply = plan;
    const stats = await runTeam({
      ...await setup(), doc: new Y.Doc(), prompt: "A page",
      model: "prov:zai:glm-5.3", provider: zai, team: { count: 2, mode: "split" },
    });
    // Two proposals and the agreement (maxTurns 1), then the two builders (maxTurns 60).
    const planning = mock.options.filter((o) => o.maxTurns === 1);
    const building = mock.options.filter((o) => o.maxTurns === 60);
    expect(planning).toHaveLength(3);
    expect(building).toHaveLength(2);
    for (const options of mock.options) {
      expect(options.model).toBe("glm-5.3");
      expect((options.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    }
    expect(stats).toHaveLength(2);
  });
});

describe("what a run resolves from the provider store", () => {
  const file = () => join(tmpdir(), `lemon-provider-test-${process.pid}`, "providers.json");
  beforeEach(() => {
    rmSync(file(), { force: true });
    Object.assign(keychain, { available: true, backend: "gnome_libsecret" });
  });

  it("reads whatever is saved when the run starts, so edits and removals land on the next request", async () => {
    setProviderKey("zai", "zai-key");
    expect(resolveProviderModel("prov:zai:glm-5.3")).toMatchObject({
      name: "Z.AI", apiType: "anthropic-messages", baseUrl: "https://api.z.ai/api/anthropic",
      apiKey: "zai-key", model: "glm-5.3",
    });
    // A changed key is what the next request carries (nothing is cached between runs); the windows
    // only ever see its masked preview.
    setProviderKey("zai", "a-much-longer-zai-key-2");
    expect(resolveProviderModel("prov:zai:glm-5.3")?.apiKey).toBe("a-much-longer-zai-key-2");
    expect(listProviders().find((p) => p.id === "zai")?.keyMasked).toBe("a-much-longe" + "…");

    // Custom providers: saved with a key, re-pointed by an edit, gone after removal.
    const custom = saveProvider({
      name: "Mine", apiType: "openai-completions", baseUrl: "https://api.example.com/v1",
      models: [{ id: "m-1", contextWindow: 8, maxTokens: 4 }], key: "k",
    });
    expect(resolveProviderModel(`prov:${custom.id}:m-1`)).toMatchObject({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m-1" });
    saveProvider({
      id: custom.id, name: "Mine", apiType: "openai-completions", baseUrl: "https://api.example.com/v2",
      models: [{ id: "m-1", contextWindow: 8, maxTokens: 4 }],
    });
    expect(resolveProviderModel(`prov:${custom.id}:m-1`)).toMatchObject({ baseUrl: "https://api.example.com/v2", apiKey: "k" });
    removeProvider(custom.id);
    expect(resolveProviderModel(`prov:${custom.id}:m-1`)).toBeUndefined();
    expect(listProviders().some((p) => p.id === custom.id)).toBe(false);
  });

  it("lists set-up providers first, each block keeping its order", () => {
    setProviderKey("zai", "zai-key");
    setProviderKey("deepseek", "deepseek-key");
    const keyed = saveProvider({
      name: "Mine", apiType: "openai-completions", baseUrl: "https://api.example.com/v1",
      models: [{ id: "m-1", contextWindow: 8, maxTokens: 4 }], key: "k",
    });
    const keyless = saveProvider({
      name: "Other", apiType: "openai-completions", baseUrl: "https://api.other.com/v1",
      models: [{ id: "m-2", contextWindow: 8, maxTokens: 4 }],
    });
    // Set-up ones first — deepseek before zai is catalog order, the keyed custom follows — then the
    // keyless built-ins in catalog order and the keyless custom last; the pill reads the same signal.
    const listed = listProviders();
    expect(listed.map((p) => p.id)).toEqual(["deepseek", "zai", keyed.id, "kimi", "together", "fireworks", "zen", keyless.id]);
    expect(listed.map((p) => !!p.keyMasked)).toEqual([true, true, true, false, false, false, false, false]);
  });

  it("keeps keys only in the keychain, and refuses one when there is none worth the name", () => {
    setProviderKey("zai", "zai-secret-key");
    expect(readFileSync(file(), "utf8")).not.toContain("zai-secret-key");
    for (const state of [{ available: false, backend: "gnome_libsecret" }, { available: true, backend: "basic_text" }]) {
      Object.assign(keychain, state);
      expect(() => setProviderKey("deepseek", "k")).toThrow("no keychain");
    }
    expect(resolveProviderModel("prov:deepseek:deepseek-chat")?.apiKey).toBeUndefined();
  });

  it("checks what a window sends before keeping it", () => {
    const good = { name: "Mine", apiType: "openai-completions", baseUrl: "https://api.example.com/v1", models: [{ id: "m", contextWindow: 8, maxTokens: 4 }] };
    expect(() => saveProvider(null)).toThrow();
    expect(() => saveProvider({ ...good, name: " " })).toThrow("name");
    expect(() => saveProvider({ ...good, apiType: "grpc" })).toThrow("API type");
    expect(() => saveProvider({ ...good, baseUrl: "file:///etc/passwd" })).toThrow("base URL");
    expect(() => saveProvider({ ...good, models: [] })).toThrow("at least one model");
    expect(() => saveProvider({ ...good, models: [{ id: "m", contextWindow: -1, maxTokens: 4 }] })).toThrow("whole number");
    expect(() => saveProvider({ ...good, headers: { "x-a": "1\r\nInjected: yes" } })).toThrow("header");
    expect(() => saveProvider({ ...good, headers: { "bad name": "1" } })).toThrow("header");
    expect(() => saveProvider({ ...good, id: "gone" })).toThrow("removed");
    expect(() => setProviderKey("gone", "k")).toThrow("removed");
    expect(() => setProviderKey("zai", 42)).toThrow();
    // Blank model rows are dropped and the images flag carries to the run.
    const saved = saveProvider({ ...good, models: [{ id: " ", contextWindow: 0, maxTokens: 0 }, { id: "m", contextWindow: 8, maxTokens: 4, images: true }] });
    expect(saved.models).toEqual([{ id: "m", contextWindow: 8, maxTokens: 4, images: true }]);
    expect(resolveProviderModel(`prov:${saved.id}:m`)?.images).toBe(true);
  });
});

describe("a provider's environment for the Claude SDK", () => {
  it("never lets a keyless provider fall back to the person's own Anthropic credentials", () => {
    process.env.ANTHROPIC_API_KEY = "the-persons-own-key";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "the-persons-login";
    try {
      expect(providerEnv(zai).CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      const env = providerEnv({ ...zai, apiKey: undefined });
      expect(env.ANTHROPIC_BASE_URL).toBe(zai.baseUrl);
      expect(env.ANTHROPIC_API_KEY).not.toBe("the-persons-own-key");
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe(env.ANTHROPIC_API_KEY);
      expect(providerEnv(zai).ANTHROPIC_API_KEY).toBe("zai-key");
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  });
});
