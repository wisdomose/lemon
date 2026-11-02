// The MCP server outside agents start (over stdio), as Pen's connector: it lists the tools on its own
// and passes each call to the running app (main/mcp.ts) over the local pipe. The app is reached at the
// first call, and again after it was closed; when it isn't running, the call fails after a few tries.
// Run with the app's own executable in Node mode: `<app> <this file> --agent claudeCodeCLI`.
import { connect } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { PRODUCT } from "../product.js";
import { pipePath, type Hello } from "./pipe.js";
import { INSTRUCTIONS, TOOLS, type ToolName } from "./tools.js";
import { answerLocally } from "./content.js";

const TRIES = 3;
const RETRY_MS = 1000;
const CALL_TIMEOUT_MS = 10 * 60_000;

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const agent = flag("agent") ?? "";

/** The pipe as an MCP transport: the hello line first, then newline-delimited JSON-RPC (as stdio). */
function pipeTransport(): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipePath(PRODUCT.slug));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      let buffer = "";
      const t: Transport = {
        async start() {
          socket.setEncoding("utf8");
          socket.on("data", (chunk: string) => {
            buffer += chunk;
            for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
              const line = buffer.slice(0, nl).replace(/\r$/, "");
              buffer = buffer.slice(nl + 1);
              if (line) t.onmessage?.(JSON.parse(line) as JSONRPCMessage);
            }
          });
          socket.on("error", (e) => t.onerror?.(e));
          socket.on("close", () => t.onclose?.());
        },
        async send(message) {
          socket.write(JSON.stringify(message) + "\n");
        },
        async close() {
          socket.end();
        },
      };
      socket.write(JSON.stringify({ agent } satisfies Hello) + "\n");
      resolve(t);
    });
  });
}

let app: Promise<Client> | undefined;

/** The connection to the running app, made now if there is none. */
function reachApp(): Promise<Client> {
  app ??= (async () => {
    let last: unknown;
    for (let i = 0; i < TRIES; i++) {
      if (i) await new Promise((r) => setTimeout(r, RETRY_MS));
      try {
        const client = new Client({ name: `${PRODUCT.slug}-connector`, version: "0.0.1" });
        client.onclose = () => (app = undefined);
        await client.connect(await pipeTransport());
        return client;
      } catch (e) {
        last = e;
      }
    }
    app = undefined;
    throw new Error(`Failed to connect to running ${PRODUCT.name} app after ${TRIES} retries: is ${PRODUCT.name} open? (${last instanceof Error ? last.message : String(last)})`);
  })();
  return app;
}

const server = new McpServer({ name: PRODUCT.slug, version: "1.0.0" }, { instructions: INSTRUCTIONS });
for (const name of Object.keys(TOOLS) as ToolName[]) {
  server.registerTool(name, TOOLS[name], async (args: Record<string, unknown>) => {
    const local = answerLocally(name, args);
    if (local) return local;
    const client = await reachApp();
    // Designing can take a while (layout, pictures): far longer than the client's default wait.
    return (await client.callTool({ name, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS })) as { content: [] };
  });
}
await server.connect(new StdioServerTransport());
