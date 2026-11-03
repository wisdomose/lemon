// Provider model ids, the built-in catalog, and the OpenAI Completions engine — no network, no keys.
import { describe, expect, it, vi } from "vitest";
import { modelProvider, modelLabel } from "../src/agent/models.js";
import type { ProviderRecord } from "../src/agent/providers.js";
import {
  BUILT_IN_PROVIDERS,
  maskKey,
  orderProviders,
  parseProviderModel,
  providerModelId,
  providerSubtitle,
} from "../src/agent/providers.js";
import { runOpenAICompat } from "../src/agent/openai.js";

// ---- Model ids and the catalog ---------------------------------------------------------------------
describe("provider model ids", () => {
  it("round-trips ids that carry slashes and dots", () => {
    const id = providerModelId("zai", "glm-5.3");
    expect(parseProviderModel(id)).toEqual({ providerId: "zai", modelId: "glm-5.3" });
    const odd = providerModelId("together", "Qwen/Qwen3.5-397B");
    expect(parseProviderModel(odd)).toEqual({ providerId: "together", modelId: "Qwen/Qwen3.5-397B" });
    expect(parseProviderModel("codex:gpt-5.2")).toBeUndefined();
    expect(parseProviderModel("claude-opus-5-5")).toBeUndefined();
  });

  it("dispatches by prefix", () => {
    expect(modelProvider(providerModelId("zai", "glm-5.3"))).toBe("provider");
    expect(modelProvider("codex:gpt-5.2")).toBe("codex");
    expect(modelProvider("codex")).toBe("codex");
    expect(modelProvider("claude-opus-5-5")).toBe("claude");
  });

  it("shows a provider model by its label, else its id", () => {
    expect(modelLabel(providerModelId("zai", "glm-5.3"))).toBe("GLM-5.3");
    const custom: ProviderRecord = { id: "c1", name: "Mine", apiType: "openai-completions", baseUrl: "https://x", models: [{ id: "m-1", contextWindow: 0, maxTokens: 0 }] };
    expect(modelLabel(providerModelId("c1", "m-1"), [], [custom])).toBe("m-1");
    expect(modelLabel(providerModelId("c1", "m-1"), [], [{ ...custom, models: [{ id: "m-1", label: "Model One", contextWindow: 0, maxTokens: 0 }] }])).toBe("Model One");
    expect(modelLabel("codex:gpt-5.2")).toBe("gpt-5.2");
  });

  it("masks saved keys the way the pages show them", () => {
    expect(maskKey("772c27656ecbrestofthekey")).toBe("772c27656ecb…");
    expect(maskKey("short")).toBe("short");
  });

  it("describes built-ins as examples and customs by their models", () => {
    const zai = BUILT_IN_PROVIDERS.find((p) => p.id === "zai")!;
    expect(providerSubtitle(zai)).toBe("e.g. GLM-5.3 Flash · GLM-5.3 · GLM-5.2");
    expect(providerSubtitle({ id: "mine", name: "Mine", apiType: "openai-completions", baseUrl: "https://x/v1", models: [{ id: "m-1", contextWindow: 8, maxTokens: 4 }] })).toBe("e.g. m-1");
  });
});

describe("built-in providers", () => {
  it("are complete and unique", () => {
    const ids = new Set<string>();
    for (const p of BUILT_IN_PROVIDERS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.baseUrl).toMatch(/^https:\/\//);
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.authLabel).toBeTruthy();
      expect(p.getStarted.url).toMatch(/^https:\/\//);
      for (const m of p.models) expect(m.id).toBeTruthy();
    }
  });

  it("reaches Z.AI's Anthropic endpoint with its GLM models", () => {
    const zai = BUILT_IN_PROVIDERS.find((p) => p.id === "zai")!;
    expect(zai.apiType).toBe("anthropic-messages");
    expect(zai.baseUrl).toBe("https://api.z.ai/api/anthropic");
    expect(zai.models.map((m) => m.id)).toContain("glm-5.3");
  });
});

describe("provider list order", () => {
  /** A record as the store serves it: `keyMasked` only when a key is saved. */
  const rec = (id: string, keyMasked?: string): ProviderRecord => ({
    id, name: id, apiType: "openai-completions", baseUrl: "https://x/v1", models: [], ...(keyMasked ? { keyMasked } : {}),
  });

  it("moves a provider with its key saved above the keyless ones", () => {
    expect(orderProviders([rec("kimi"), rec("zai", "zai-key…"), rec("deepseek")]).map((p) => p.id)).toEqual(["zai", "kimi", "deepseek"]);
  });

  it("keeps each block's order: catalog for built-ins, creation for customs", () => {
    const records = [rec("kimi"), rec("deepseek", "d…"), rec("zai", "z…"), rec("first"), rec("second", "s…"), rec("third", "t…")];
    expect(orderProviders(records).map((p) => p.id)).toEqual(["deepseek", "zai", "second", "third", "kimi", "first"]);
  });

  it("places a keyed custom above keyless built-ins", () => {
    expect(orderProviders([rec("kimi"), rec("zen"), rec("mine", "m…")]).map((p) => p.id)).toEqual(["mine", "kimi", "zen"]);
  });

  it("leaves empty and all-keyless lists as they come", () => {
    expect(orderProviders([])).toEqual([]);
    const keyless = [rec("kimi"), rec("deepseek")];
    expect(orderProviders(keyless)).toEqual(keyless);
  });
});

// ---- The OpenAI Completions engine -----------------------------------------------------------------
/** A streaming endpoint answer: each chunk becomes one `data:` event, then [DONE]. */
const sse = (chunks: unknown[], status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    { status },
  );

const contentChunk = (text: string, finish?: string) => ({ choices: [{ delta: { content: text }, finish_reason: finish ?? null }] });
const usageChunk = () => ({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 4 } });

describe("OpenAI Completions engine", () => {
  it("streams the reply and reads usage, addressing the endpoint with the key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([contentChunk("Hello"), contentChunk(" canvas", "stop"), usageChunk()]));
    const onText = vi.fn();
    const result = await runOpenAICompat({
      system: "s", prompt: "p", baseUrl: "https://api.example.com/v1", apiKey: "k1", model: "m-1", onText, fetchImpl,
    });
    expect(result.reply).toBe("Hello canvas");
    expect(result.tokens).toEqual({ input: 11, output: 4, cacheRead: 0, cacheWrite: 0 });
    expect(onText).toHaveBeenCalledWith("Hello", expect.any(String));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k1");
    const body = JSON.parse(String(init.body)) as { model: string; stream: boolean; messages: { role: string }[] };
    expect(body.model).toBe("m-1");
    expect(body.stream).toBe(true);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("sends no auth header when no key is set (optional keys)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([contentChunk("Ok", "stop")]));
    await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1/", model: "m", fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://x/v1/chat/completions");
  });

  it("runs the canvas tool and feeds results back until the model replies", async () => {
    const toolCall = (args: string, finish?: string) => ({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "execute", arguments: args } }] }, finish_reason: finish ?? null }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse([toolCall('{"title":', ""), toolCall('"Step","script":"return 1+1"}', "tool_calls")]))
      .mockResolvedValueOnce(sse([contentChunk("Done — 2 on the canvas.", "stop")]));
    const tool = { description: "d", inputSchema: {}, call: vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: "Done" }] }) };
    const result = await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", tools: { execute: tool }, fetchImpl });
    expect(tool.call).toHaveBeenCalledWith({ title: "Step", script: "return 1+1" });
    expect(result.reply).toBe("Done — 2 on the canvas.");
    // The second request carries the assistant's tool call and the tool's answer.
    const [, second] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const body = JSON.parse(String(second.body)) as { messages: { role: string; tool_calls?: unknown[]; tool_call_id?: string; content?: string }[] };
    expect(body.messages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);
    expect(body.messages.some((m) => m.role === "tool" && m.tool_call_id === "call-1" && m.content === "Done")).toBe(true);
  });

  it("reports a failed script to the model instead of ending the run", async () => {
    const toolCall = (args: string, finish?: string) => ({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "c", type: "function", function: { name: "execute", arguments: args } }] }, finish_reason: finish ?? null }],
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse([toolCall("not json", "tool_calls")]))
      .mockResolvedValueOnce(sse([contentChunk("Recovered", "stop")]));
    const tool = { description: "d", inputSchema: {}, call: vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: "ok" }] }) };
    const result = await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", tools: { execute: tool }, fetchImpl });
    expect(tool.call).not.toHaveBeenCalled();
    expect(result.reply).toBe("Recovered");
  });

  it("passes the model's token limit and surfaces HTTP errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sse([contentChunk("Ok", "stop")]));
    await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", maxTokens: 512000, fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as { max_tokens: number }).max_tokens).toBe(512000);

    const failing = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", fetchImpl: failing })).rejects.toThrow("HTTP 401");
  });

  it("throws when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", signal: controller.signal, fetchImpl: vi.fn() }),
    ).rejects.toThrow("cancelled");
  });

  const callChunk = (id: string) => ({
    choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name: "execute", arguments: '{"title":"Look","script":"x"}' } }] }, finish_reason: "tool_calls" }],
  });
  const picture = { content: [{ type: "text" as const, text: "Shot" }, { type: "image" as const, data: "AAAA", mimeType: "image/png" }] };

  it("counts the tokens of every request in the run", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(sse([callChunk("c"), usageChunk()])).mockResolvedValueOnce(sse([contentChunk("Done", "stop"), usageChunk()]));
    const tool = { description: "d", inputSchema: {}, call: vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: "ok" }] }) };
    const result = await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", tools: { execute: tool }, fetchImpl });
    expect(result.tokens).toEqual({ input: 22, output: 8, cacheRead: 0, cacheWrite: 0 });
  });

  it("shows pictures to a model that reads them, after the tool's results", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(sse([callChunk("c")])).mockResolvedValueOnce(sse([contentChunk("Seen", "stop")]));
    const tool = { description: "d", inputSchema: {}, call: vi.fn().mockResolvedValue(picture) };
    await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", images: true, tools: { execute: tool }, fetchImpl });
    const [, second] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const messages = (JSON.parse(String(second.body)) as { messages: { role: string; content: unknown }[] }).messages;
    expect(messages.at(-2)).toMatchObject({ role: "tool", content: "Shot\n(picture 1 follows)" });
    expect(messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "text" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] });
  });

  it("tells a text-only model a picture was taken, and sends none", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(sse([callChunk("c")])).mockResolvedValueOnce(sse([contentChunk("Ok", "stop")]));
    const tool = { description: "d", inputSchema: {}, call: vi.fn().mockResolvedValue(picture) };
    await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", tools: { execute: tool }, fetchImpl });
    const [, second] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    const messages = (JSON.parse(String(second.body)) as { messages: { role: string; content: unknown }[] }).messages;
    expect(messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("can't see pictures") });
    expect(String(second.body)).not.toContain("image_url");
  });

  const named = (name: string, id: string) => ({
    choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "{}" } }] }, finish_reason: "tool_calls" }],
  });
  const ok = (text: string) => ({ description: "d", inputSchema: {}, call: vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text }] }) });

  it("offers every canvas tool and runs each call by its name, refusing unknown ones", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(sse([named("browser", "b")]))
      .mockResolvedValueOnce(sse([named("shell", "s")]))
      .mockResolvedValueOnce(sse([contentChunk("Done", "stop")]));
    const execute = ok("ran");
    const browser = ok("page");
    await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", tools: { execute, browser }, fetchImpl });
    const first = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { tools: { function: { name: string } }[] };
    expect(first.tools.map((t) => t.function.name)).toEqual(["execute", "browser"]);
    expect(browser.call).toHaveBeenCalledOnce();
    expect(execute.call).not.toHaveBeenCalled();
    const last = String((fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body);
    expect(last).toContain('There is no \\"shell\\" tool.');
  });

  it("goes on to the next variation in the same conversation when asked (Let it cook)", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(sse([contentChunk("First design", "stop")]))
      .mockResolvedValueOnce(sse([contentChunk("Second design", "stop")]));
    const followUp = vi.fn().mockReturnValueOnce("Now another variation.").mockReturnValueOnce(undefined);
    const result = await runOpenAICompat({ system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", tools: { execute: ok("ran") }, followUp, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe("Second design");
    const second = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body)) as { messages: { role: string; content: unknown }[] };
    expect(second.messages.slice(-2)).toEqual([{ role: "assistant", content: "First design" }, { role: "user", content: "Now another variation." }]);
  });
});
