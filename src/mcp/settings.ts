// Settings → MCP's data, shared by the main process (main/mcp-settings.ts) and the Settings window.

/** An outside agent the connector can be set up for; `id` is its --agent flag (main/mcp.ts names it). */
export interface McpClient {
  id: string;
  label: string;
}

export const MCP_CLIENTS: McpClient[] = [
  { id: "claudeCodeCLI", label: "Claude Code CLI" },
  { id: "codexCLI", label: "Codex CLI" },
  { id: "geminiCLI", label: "Gemini CLI" },
  { id: "antigravity", label: "Antigravity 2.0" },
  { id: "openCodeCLI", label: "OpenCode CLI" },
  { id: "kiroCLI", label: "Kiro CLI" },
  { id: "claudeDesktop", label: "Claude Desktop" },
];

/** The popular servers offered under the text, as Pen's. */
export const POPULAR_SERVERS: Record<string, { label: string; config: { url: string } }> = {
  linear: { label: "Linear", config: { url: "https://mcp.linear.app/mcp" } },
  notion: { label: "Notion", config: { url: "https://mcp.notion.com/mcp" } },
  mobbin: { label: "Mobbin", config: { url: "https://api.mobbin.com/mcp" } },
};

export const EMPTY_SERVERS = `{\n  "mcpServers": {}\n}`;

export interface McpSettings {
  /** The servers for the app's own agents, as the person wrote them. */
  servers: string;
  /** Outside agents turned on, by id. */
  clients: Record<string, boolean>;
}

/** What the page shows: the settings, and a problem writing an agent's config, by its id. */
export interface McpPage extends McpSettings {
  problems: Record<string, string>;
}

/** The MCP servers in a `{ "mcpServers": {…} }` text; throws when it isn't one. */
export function parseServers(text: string): Record<string, Record<string, unknown>> {
  const parsed = JSON.parse(text) as unknown;
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (!parsed || typeof parsed !== "object" || !servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error('Expected { "mcpServers": { … } }.');
  }
  for (const [name, s] of Object.entries(servers)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`"${name}" should be an object.`);
    const v = s as Record<string, unknown>;
    if (typeof v.command !== "string" && typeof v.url !== "string") throw new Error(`"${name}" needs a "command" or a "url".`);
  }
  return servers as Record<string, Record<string, unknown>>;
}
