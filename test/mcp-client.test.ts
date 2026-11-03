// The added MCP servers as the app reaches them for the OpenAI Completions engine: a real stdio server
// (the MCP SDK's own, started as a subprocess), one that can't start, and the function names they get.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { connectServers, functionName, type ConnectedServers } from "../src/agent/mcp-client.js";
import { runOpenAICompat } from "../src/agent/openai.js";

const dir = mkdtempSync(join(tmpdir(), "lemon-mcp-client-"));
const resolve = (id: string) => pathToFileURL(createRequire(import.meta.url).resolve(id)).href;
const sdk = (path: string) => resolve(`@modelcontextprotocol/sdk/${path}`);
const script = join(dir, "notes-server.mjs");
writeFileSync(
  script,
  `import { McpServer } from ${JSON.stringify(sdk("server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(sdk("server/stdio.js"))};
import { z } from ${JSON.stringify(resolve("zod"))};
const server = new McpServer({ name: "notes", version: "1.0.0" });
server.registerTool("add", { description: "Adds two numbers", inputSchema: { a: z.number(), b: z.number() } }, async (args) =>
  ({ content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] }));
server.registerTool("fail", { description: "Always fails" }, async () => ({ content: [{ type: "text", text: "nope" }], isError: true }));
server.registerTool("leak", { description: "Reports a variable" }, async () => ({ content: [{ type: "text", text: process.env.SECRET_FROM_APP ?? "unset" }] }));
await server.connect(new StdioServerTransport());
`,
);

let connected: ConnectedServers;
const errors: [string, string][] = [];
beforeAll(async () => {
  process.env.SECRET_FROM_APP = "app-secret";
  connected = await connectServers(
    { notes: { command: process.execPath, args: [script] }, broken: { command: join(dir, "no-such-server") }, "has space": { command: "x" } },
    (server, why) => errors.push([server, why]),
  );
}, 30_000);
afterAll(async () => {
  delete process.env.SECRET_FROM_APP;
  await connected?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("added MCP servers for the OpenAI Completions engine", () => {
  it("lists a server's tools under `<server>__<tool>`, with their own names for the cards", () => {
    expect(Object.keys(connected.tools).sort()).toEqual(["notes__add", "notes__fail", "notes__leak"]);
    expect(connected.tools.notes__add).toMatchObject({ title: "add", description: "Adds two numbers" });
  });

  it("calls the tool on its server and passes errors on as such", async () => {
    expect(await connected.tools.notes__add!.call({ a: 2, b: 3 })).toEqual({ content: [{ type: "text", text: "5" }] });
    expect(await connected.tools.notes__fail!.call({})).toMatchObject({ isError: true });
  });

  it("starts a server without the app's own environment", async () => {
    expect((await connected.tools.notes__leak!.call({})).content).toEqual([{ type: "text", text: "unset" }]);
  });

  it("leaves out a server that can't start, and says so", () => {
    expect(errors.map(([s]) => s)).toEqual(["broken"]);
  });
});

describe("function names", () => {
  it("are what Chat Completions accepts, and unique", () => {
    const taken = new Set(["execute"]);
    expect(functionName("linear", "list issues", taken)).toBe("linear__list_issues");
    expect(functionName("linear", "list.issues", taken)).toBe("linear__list_issues_2");
    const long = functionName("a-very-long-server-name", "x".repeat(80), taken);
    expect(long).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});

describe("the engine with server tools", () => {
  const sse = (chunks: unknown[]) =>
    new Response(new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const chunk of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        c.close();
      },
    }));

  it("offers them beside the canvas tools and reports each call for its card", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "notes__add", arguments: '{"a":1,"b":1}' } }] }, finish_reason: "tool_calls" }] }]))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: "It's 2." }, finish_reason: "stop" }] }]));
    const execute = { description: "d", inputSchema: {}, call: vi.fn() };
    const events: unknown[] = [];
    const result = await runOpenAICompat({
      system: "s", prompt: "p", baseUrl: "https://x/v1", model: "m", fetchImpl,
      tools: { execute }, serverTools: connected.tools, onServerTool: (e) => events.push(e),
    });
    const first = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { tools: { function: { name: string } }[] };
    expect(first.tools.map((t) => t.function.name)).toEqual(["execute", "notes__add", "notes__fail", "notes__leak"]);
    expect(events).toEqual([
      { id: "c1", tool: "add", input: { a: 1, b: 1 } },
      { id: "c1", ok: true, content: [{ type: "text", text: "2" }] },
    ]);
    expect(execute.call).not.toHaveBeenCalled();
    expect(result.reply).toBe("It's 2.");
  });
});
