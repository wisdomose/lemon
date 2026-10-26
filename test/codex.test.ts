// Exercise the app-server boundary without credentials, network calls, or model charges.
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { CodexConnection, codexBinary, codexModels, codexStatus, runCodex } from "../src/agent/codex.js";

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));

type Message = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown };

/** A newline-delimited server peer: tests control ordering and mid-turn failures. */
function server(onTurn?: (send: (m: Message) => void) => void, modelPages: unknown[] = []) {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: Writable; kill: ReturnType<typeof vi.fn> };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const received: Message[] = [];
  const send = (message: Message) => child.stdout.write(JSON.stringify(message) + "\n");
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const m = JSON.parse(String(chunk)) as Message;
    received.push(m);
    if (m.method === "initialize") send({ id: m.id, result: {} });
    if (m.method === "account/read") send({ id: m.id, result: { account: { type: "chatgpt", email: "person@example.com", planType: "plus" } } });
    if (m.method === "model/list") send({ id: m.id, result: modelPages.shift() ?? { data: [], nextCursor: null } });
    if (m.method === "config/read") send({ id: m.id, result: { config: { mcp_servers: { personal: {} } } } });
    if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "thread" } } });
    if (m.method === "turn/start") {
      send({ id: m.id, result: { turn: { id: "turn" } } });
      queueMicrotask(() => onTurn?.(send));
    }
    callback();
  } });
  child.kill = vi.fn(() => { child.emit("exit", 0); });
  mock.spawn.mockReturnValue(child);
  return { child, received, send };
}

beforeEach(() => vi.clearAllMocks());

describe("Codex provider", () => {
  it("uses the local account API and always closes the process", async () => {
    const peer = server();
    expect(await codexStatus()).toEqual({ loggedIn: true, email: "person@example.com", plan: "plus" });
    expect(peer.child.kill).toHaveBeenCalledOnce();
    expect(peer.received.map((m) => m.method)).toEqual(["initialize", "initialized", "account/read"]);
  });

  it("streams text and usage, using isolated ephemeral threads for planning", async () => {
    const peer = server((send) => {
      send({ method: "item/agentMessage/delta", params: { itemId: "reply", delta: "Ready" } });
      send({ method: "thread/tokenUsage/updated", params: { tokenUsage: { total: { inputTokens: 12, outputTokens: 3, cachedInputTokens: 5 } } } });
      send({ method: "turn/completed", params: { turn: { status: "completed" } } });
    });
    const onText = vi.fn();
    const result = await runCodex({ system: "Plan", prompt: "A page", model: "codex", onText });
    expect(result.reply).toBe("Ready");
    expect(result.tokens).toEqual({ input: 12, output: 3, cacheRead: 5, cacheWrite: 0 });
    expect(onText).toHaveBeenCalledWith("Ready", "reply");
    const start = peer.received.find((m) => m.method === "thread/start")!.params!;
    expect(start).toMatchObject({ ephemeral: true, sandbox: "read-only", approvalPolicy: "never", dynamicTools: [], config: { "features.shell_tool": false, "mcp_servers.personal.enabled": false } });
    expect(start).not.toHaveProperty("model");
    expect(peer.child.kill).toHaveBeenCalledOnce();
  });

  it("returns canvas images and errors through dynamic tool responses", async () => {
    const peer = server((send) => {
      send({ id: "call", method: "item/tool/call", params: { tool: "execute", arguments: { title: "Draw", script: "draw()" } } });
    });
    const call = vi.fn().mockResolvedValue({ isError: true, content: [{ type: "text", text: "Fix script" }, { type: "image", mimeType: "image/png", data: "cG5n" }] });
    const result = runCodex({ system: "Design", prompt: "A page", model: "codex:custom", effort: "ultra", tool: { description: "Canvas", inputSchema: {}, call } });
    await vi.waitFor(() => expect(peer.received.some((m) => m.id === "call")).toBe(true));
    expect(call).toHaveBeenCalledWith({ title: "Draw", script: "draw()" });
    expect(peer.received.find((m) => m.id === "call")!.result).toEqual({ success: false, contentItems: [{ type: "inputText", text: "Fix script" }, { type: "inputImage", imageUrl: "data:image/png;base64,cG5n" }] });
    expect(peer.received.find((m) => m.method === "thread/start")!.params!.model).toBe("custom");
    expect(peer.received.find((m) => m.method === "turn/start")!.params!.effort).toBe("ultra");
    peer.send({ method: "turn/completed", params: { turn: { status: "completed" } } });
    await result;
  });

  it("cancels active work and never starts a pre-cancelled run", async () => {
    const peer = server();
    const abort = new AbortController();
    const result = runCodex({ system: "Design", prompt: "A page", model: "codex", signal: abort.signal });
    const rejected = expect(result).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(peer.received.some((m) => m.method === "turn/start")).toBe(true));
    abort.abort();
    await rejected;
    expect(peer.child.kill).toHaveBeenCalled();
    mock.spawn.mockClear();
    await expect(runCodex({ system: "", prompt: "", model: "codex", signal: abort.signal })).rejects.toThrow();
    expect(mock.spawn).not.toHaveBeenCalled();
  });

  it("reports failed turns and rejects unsupported server requests", async () => {
    const peer = server((send) => {
      send({ id: 100, method: "item/commandExecution/requestApproval", params: {} });
      send({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "Model unavailable" } } } });
    });
    await expect(runCodex({ system: "", prompt: "", model: "codex" })).rejects.toThrow("Model unavailable");
    expect(peer.received.find((m) => m.id === 100)).toHaveProperty("error");
  });

  it("reports invalid tool arguments without crashing the connection", async () => {
    const peer = server((send) => send({ id: "invalid", method: "item/tool/call", params: { tool: "execute", arguments: { title: 42 } } }));
    const result = runCodex({ system: "", prompt: "", model: "codex", tool: {
      description: "Canvas", inputSchema: {}, call: () => { throw new Error("Invalid title"); },
    } });
    await vi.waitFor(() => expect(peer.received.find((m) => m.id === "invalid")).toBeDefined());
    expect(peer.received.find((m) => m.id === "invalid")!.result).toEqual({ success: false, contentItems: [{ type: "inputText", text: "Error: Invalid title" }] });
    peer.send({ method: "turn/completed", params: { turn: { status: "completed" } } });
    await result;
  });

  it("waits for in-flight canvas work when stopped", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const call = vi.fn(async () => { await pending; return { content: [{ type: "text" as const, text: "Done" }] }; });
    server((send) => send({ id: "slow", method: "item/tool/call", params: { tool: "execute", arguments: {} } }));
    const abort = new AbortController();
    let settled = false;
    const result = runCodex({ system: "", prompt: "", model: "codex", signal: abort.signal, tool: { description: "Canvas", inputSchema: {}, call } });
    const rejected = expect(result).rejects.toThrow("cancelled");
    void result.finally(() => { settled = true; }).catch(() => {});
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    abort.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await rejected;
  });

  it("discovers all pages, filters hidden models, and preserves server effort names", async () => {
    const entry = { model: "custom", displayName: "Custom model", defaultReasoningEffort: "ultra", supportedReasoningEfforts: [{ reasoningEffort: "ultra", description: "Deep work" }] };
    const peer = server(undefined, [
      { data: [entry, { ...entry, model: "hidden", hidden: true }], nextCursor: "next" },
      { data: [entry, { ...entry, model: "second", displayName: "Second model" }], nextCursor: null },
    ]);
    const models = await codexModels(true);
    expect(models.map((m) => m.id)).toEqual(["codex:custom", "codex:second"]);
    expect(models[0]).toMatchObject({ label: "Custom model", defaultEffort: "ultra", efforts: [{ id: "ultra", description: "Deep work" }] });
    expect(peer.received.filter((m) => m.method === "model/list").map((m) => m.params)).toEqual([
      { limit: 100, includeHidden: false }, { limit: 100, includeHidden: false, cursor: "next" },
    ]);
    expect(peer.received.some((m) => m.method === "turn/start")).toBe(false);
    expect(peer.child.kill).toHaveBeenCalledOnce();
  });

  it("reuses a recent catalog instead of starting Codex again, unless asked afresh", async () => {
    const entry = { model: "kept", displayName: "Kept" };
    server(undefined, [{ data: [entry] }]);
    await codexModels(true);
    mock.spawn.mockClear();
    expect((await codexModels()).map((m) => m.id)).toEqual(["codex:kept"]);
    expect(mock.spawn).not.toHaveBeenCalled();
    server(undefined, [{ data: [{ model: "new", displayName: "New" }] }]);
    expect((await codexModels(true)).map((m) => m.id)).toEqual(["codex:new"]);
  });

  it("starts the Codex that comes with the app, not one on the PATH", async () => {
    server();
    await codexStatus();
    const [program] = mock.spawn.mock.calls.at(-1)!;
    expect(program).toBe(codexBinary());
    expect(existsSync(codexBinary())).toBe(true);
  });

  it("says why Codex couldn't be asked, rather than reporting signed out", async () => {
    mock.spawn.mockImplementationOnce(() => {
      throw new Error("spawn EINVAL");
    });
    expect(await codexStatus()).toEqual({ loggedIn: false, error: "spawn EINVAL" });
  });

  it("returns an empty catalog without inventing model or effort choices", async () => {
    server();
    expect(await codexModels(true)).toEqual([]);
    server(undefined, [{ data: [{ model: "new", displayName: "New", defaultReasoningEffort: "unsupported" }] }]);
    const models = await codexModels(true);
    expect(models[0]).toMatchObject({ id: "codex:new", efforts: [] });
    expect(models[0]?.defaultEffort).toBeUndefined();
  });

  it("rejects malformed pages and repeated cursors, cleaning up both connections", async () => {
    const malformed = server(undefined, [{ data: [{ model: 12 }] }]);
    await expect(codexModels(true)).rejects.toThrow();
    expect(malformed.child.kill).toHaveBeenCalledOnce();
    const repeated = server(undefined, [{ data: [], nextCursor: "again" }, { data: [], nextCursor: "again" }]);
    await expect(codexModels(true)).rejects.toThrow("repeated");
    expect(repeated.child.kill).toHaveBeenCalledOnce();
  });

  it("rejects pending requests on process exit", async () => {
    const peer = server();
    const connection = new CodexConnection();
    await connection.initialize();
    const pending = connection.request("unknown", {});
    const rejected = expect(pending).rejects.toThrow("stopped");
    peer.child.emit("exit", 1);
    await rejected;
    connection.close();
  });
});
