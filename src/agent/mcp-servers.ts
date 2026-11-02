// The MCP servers the person added in Settings → MCP (`{ "mcpServers": { name: { command | url, … } } }`,
// as Pen's), handed to the app's own agents in each provider's terms. A server with a `url` is reached
// over HTTP (or SSE with `type: "sse"`); one with a `command` is started.
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { PRODUCT } from "../product.js";

export type PersonServers = Record<string, Record<string, unknown>>;

const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);
const record = (v: unknown): Record<string, string> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined;

/** The servers that can be used: each needs a url or a command, and none may take the canvas tools' name. */
function usable(servers: PersonServers): [string, Record<string, unknown>][] {
  return Object.entries(servers).filter(([name, s]) => name !== PRODUCT.slug && /^[\w-]+$/.test(name) && (typeof s.url === "string" || typeof s.command === "string"));
}

export function serverNames(servers: PersonServers): string[] {
  return usable(servers).map(([name]) => name);
}

/** For the Claude Agent SDK's `mcpServers`. */
export function forClaude(servers: PersonServers): Record<string, McpServerConfig> {
  return Object.fromEntries(
    usable(servers).map(([name, s]): [string, McpServerConfig] => {
      const headers = record(s.headers);
      if (typeof s.url === "string") return [name, { type: s.type === "sse" ? "sse" : "http", url: s.url, ...(headers ? { headers } : {}) }];
      const args = strings(s.args);
      const env = record(s.env);
      return [name, { type: "stdio", command: s.command as string, ...(args ? { args } : {}), ...(env ? { env } : {}) }];
    }),
  );
}

/** For Codex: config overrides (`mcp_servers.<name>.…`), turned on over whatever the person's own config says. */
export function forCodex(servers: PersonServers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, s] of usable(servers)) {
    const key = `mcp_servers.${name}`;
    out[`${key}.enabled`] = true;
    if (typeof s.url === "string") out[`${key}.url`] = s.url;
    else {
      out[`${key}.command`] = s.command;
      const args = strings(s.args);
      const env = record(s.env);
      if (args) out[`${key}.args`] = args;
      if (env) out[`${key}.env`] = env;
    }
  }
  return out;
}
