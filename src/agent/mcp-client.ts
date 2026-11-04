// The MCP servers the person added (Settings → MCP), reached by the app itself for engines that don't
// speak MCP (the OpenAI Completions engine, openai.ts); Claude and Codex connect to them on their own
// (mcp-servers.ts). Each server's tools become functions named `<server>__<tool>`; a server that can't
// be reached is left out, as the other engines do, and the run goes on without it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { PRODUCT } from "../product.js";
import type { CodexTool, ToolResultContent } from "./codex.js";
import { serverNames, type PersonServers } from "./mcp-servers.js";

/** How long a server may take to start and list its tools, and to answer one call. */
const CONNECT_MS = 30_000;
const CALL_MS = 10 * 60_000;
/** Chat Completions takes at most 128 functions; the canvas tools need a few of them. */
const MAX_TOOLS = 120;

/** A tool of an added server: what the model calls it, and its own name for the step card. */
export interface ServerTool extends CodexTool {
  /** The tool's own name, as Claude and Codex runs show it. */
  title: string;
}

export interface ConnectedServers {
  tools: Record<string, ServerTool>;
  close(): Promise<void>;
}

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);
const record = (v: unknown): Record<string, string> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined;

/** The transport a server's settings ask for: HTTP (or SSE with `type: "sse"`) for a url, else stdio. */
function transportFor(s: Record<string, unknown>): Transport {
  if (typeof s.url === "string") {
    const headers = record(s.headers);
    const requestInit = headers ? { headers } : undefined;
    const url = new URL(s.url);
    return s.type === "sse" ? new SSEClientTransport(url, { requestInit }) : new StreamableHTTPClientTransport(url, { requestInit });
  }
  return new StdioClientTransport({
    command: s.command as string,
    args: strings(s.args) ?? [],
    // Only the usual variables and the server's own: not the app's environment (or its keys).
    env: { ...getDefaultEnvironment(), ...record(s.env) },
    stderr: "ignore",
  });
}

/** A function name Chat Completions accepts (`^[A-Za-z0-9_-]{1,64}$`), unique among `taken`. */
export function functionName(server: string, tool: string, taken: Set<string>): string {
  let name = `${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (name.length > 64) name = name.slice(0, 64);
  for (let n = 2; taken.has(name); n++) name = `${name.slice(0, 64 - String(n).length - 1)}_${n}`;
  taken.add(name);
  return name;
}

const withTimeout = <T>(p: Promise<T>, ms: number, why: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(why)), ms).unref?.())]);

/** A server's tool result in the engine's terms: text and pictures, anything else as its JSON. */
function resultContent(content: unknown): ToolResultContent[] {
  return (Array.isArray(content) ? content : []).map((c: Record<string, unknown>) =>
    c.type === "text" ? { type: "text", text: String(c.text ?? "") }
      : c.type === "image" && typeof c.data === "string" ? { type: "image", data: c.data, mimeType: String(c.mimeType ?? "image/png") }
        : { type: "text", text: JSON.stringify(c) },
  );
}

/**
 * Connects to every usable added server at once and lists their tools. `onError` hears about a server
 * that was left out. Close the result when the run ends: it stops the servers this started.
 */
export async function connectServers(servers: PersonServers, onError?: (server: string, why: string) => void): Promise<ConnectedServers> {
  const clients: Client[] = [];
  const tools: Record<string, ServerTool> = {};
  const taken = new Set(["execute", "browser"]);
  const listed = await Promise.all(
    serverNames(servers).map(async (server) => {
      const client = new Client({ name: PRODUCT.slug, version: "0.0.1" });
      try {
        await withTimeout(client.connect(transportFor(servers[server]!)), CONNECT_MS, "It didn't answer in time.");
        clients.push(client);
        const found = [];
        let cursor: string | undefined;
        do {
          const page = await withTimeout(client.listTools(cursor ? { cursor } : {}), CONNECT_MS, "It didn't list its tools in time.");
          found.push(...page.tools);
          cursor = page.nextCursor;
        } while (cursor);
        return { server, client, found };
      } catch (e) {
        await client.close().catch(() => {});
        onError?.(server, e instanceof Error ? e.message : String(e));
        return { server, client, found: [] };
      }
    }),
  );
  // In the servers' order, so which tools fit under the limit doesn't depend on who answered first.
  for (const { server, client, found } of listed) {
    for (const t of found) {
      if (Object.keys(tools).length >= MAX_TOOLS) break;
      tools[functionName(server, t.name, taken)] = {
        title: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object" },
        async call(input) {
          const r = await client.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> }, undefined, { timeout: CALL_MS });
          return { content: resultContent(r.content) as Awaited<ReturnType<CodexTool["call"]>>["content"], ...(r.isError ? { isError: true } : {}) };
        },
      };
    }
  }
  return {
    tools,
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}
