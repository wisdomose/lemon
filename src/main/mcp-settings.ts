// Settings → MCP, as Pen's. Two things, kept in the app's data folder (mcp.json):
// - the MCP servers the person adds for the app's own agents (a `{ "mcpServers": {…} }` text), and
// - which outside agents may design in the app: each one turned on gets the connector
//   (mcp/connector.ts) in its own MCP config, written again each time the app starts; turned off, it is
//   taken out again. The config files are the ones Pen writes for the same agents.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PRODUCT } from "../product.js";
import { EMPTY_SERVERS, MCP_CLIENTS, parseServers, type McpPage, type McpSettings } from "../mcp/settings.js";

export type { McpPage, McpSettings };

/** How the connector is started: the app's executable in Node mode, running connector.js. */
export interface Launch {
  command: string;
  args: (agent: string) => string[];
  env: Record<string, string>;
}

// ---- Outside agents' config files ------------------------------------------------------------------
const home = homedir();
const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
const claudeDesktopDir =
  process.platform === "win32" ? join(appData, "Claude") : process.platform === "darwin" ? join(home, "Library", "Application Support", "Claude") : join(home, ".config", "Claude");

/** Where each agent keeps its MCP servers, and how an entry is written there. */
const FILES: Record<string, { path: string; key: string; entry: (l: Launch, agent: string) => Record<string, unknown> } | { path: string; toml: true }> = {
  claudeCodeCLI: { path: join(home, ".claude.json"), key: "mcpServers", entry: (l, a) => ({ command: l.command, args: l.args(a), env: l.env, type: "stdio" }) },
  codexCLI: { path: join(home, ".codex", "config.toml"), toml: true },
  geminiCLI: { path: join(home, ".gemini", "settings.json"), key: "mcpServers", entry: (l, a) => ({ command: l.command, args: l.args(a), env: l.env }) },
  antigravity: { path: join(home, ".gemini", "antigravity", "mcp_config.json"), key: "mcpServers", entry: (l, a) => ({ command: l.command, args: l.args(a), env: l.env }) },
  // OpenCode waits 30 s for a call by default; designing can take longer.
  openCodeCLI: { path: join(home, ".config", "opencode", "opencode.json"), key: "mcp", entry: (l, a) => ({ type: "local", command: [l.command, ...l.args(a)], environment: l.env, enabled: true, timeout: 600_000 }) },
  kiroCLI: { path: join(home, ".kiro", "settings", "mcp.json"), key: "mcpServers", entry: (l, a) => ({ command: l.command, args: l.args(a), env: l.env }) },
  claudeDesktop: { path: join(claudeDesktopDir, "claude_desktop_config.json"), key: "mcpServers", entry: (l, a) => ({ command: l.command, args: l.args(a), env: l.env }) },
};

const NAME = PRODUCT.slug;

/** `[mcp_servers.<name>]` and its sub-tables taken out of a Codex config.toml. */
export function tomlWithout(text: string, name: string): string {
  const ours = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:${name}|"${name}")(?:\\.[^\\]]*)?\\s*\\]\\s*$`);
  const out: string[] = [];
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) skipping = ours.test(line);
    if (!skipping) out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function tomlEntry(name: string, l: Launch, agent: string): string {
  const str = (s: string) => JSON.stringify(s);
  return [
    `[mcp_servers.${name}]`,
    `command = ${str(l.command)}`,
    `args = [ ${l.args(agent).map(str).join(", ")} ]`,
    "",
    `[mcp_servers.${name}.env]`,
    ...Object.entries(l.env).map(([k, v]) => `${k} = ${str(v)}`),
    "",
  ].join("\n");
}

/** Puts the connector in (`on`) or takes it out of one agent's config; changes nothing that is already so. */
export function configure(agent: string, on: boolean, launch: Launch): void {
  const file = FILES[agent];
  if (!file) throw new Error(`Unknown agent "${agent}".`);
  const exists = existsSync(file.path);
  if (!on && !exists) return;
  const before = exists ? readFileSync(file.path, "utf8") : "";
  let after: string;
  if ("toml" in file) {
    const without = tomlWithout(before, NAME);
    after = on ? `${without.trimEnd()}${without.trim() ? "\n\n" : ""}${tomlEntry(NAME, launch, agent)}` : without;
  } else {
    let data: Record<string, unknown>;
    try {
      data = before.trim() ? (JSON.parse(before) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`${file.path} isn't plain JSON, so it was left alone.`);
    }
    const servers = { ...((data[file.key] as Record<string, unknown> | undefined) ?? {}) };
    const entry = file.entry(launch, agent);
    if (on ? JSON.stringify(servers[NAME]) === JSON.stringify(entry) : !(NAME in servers)) return;
    if (on) servers[NAME] = entry;
    else delete servers[NAME];
    after = JSON.stringify({ ...data, [file.key]: servers }, null, 2) + "\n";
  }
  if (after === before) return;
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, after);
}

/** The JSON that "Copy MCP config" gives, for any other MCP client. */
export function copyableConfig(launch: Launch): string {
  return JSON.stringify({ mcpServers: { [NAME]: { command: launch.command, args: launch.args("other"), env: launch.env } } }, null, 2);
}

// ---- The settings file ------------------------------------------------------------------------------
export class McpSettingsStore {
  private settings: McpSettings;
  private problems: Record<string, string> = {};

  constructor(
    private readonly file: string,
    private readonly launch: Launch,
    private readonly log: (msg: string) => void,
  ) {
    let saved: Partial<McpSettings> = {};
    try {
      saved = JSON.parse(readFileSync(file, "utf8")) as Partial<McpSettings>;
    } catch {
      // No settings yet.
    }
    this.settings = { servers: saved.servers ?? EMPTY_SERVERS, clients: saved.clients ?? {} };
  }

  page(): McpPage {
    return { ...this.settings, problems: { ...this.problems } };
  }

  /** The servers for the app's own agents (none when the text doesn't parse). */
  servers(): Record<string, Record<string, unknown>> {
    try {
      return parseServers(this.settings.servers);
    } catch {
      return {};
    }
  }

  /** Saves the servers' text; throws (saving nothing) when it isn't a `{ "mcpServers": … }` object. */
  setServers(text: string): McpPage {
    parseServers(text);
    this.settings.servers = text;
    this.save();
    return this.page();
  }

  /** Turns an outside agent on or off, writing its config now. */
  setClient(agent: string, on: boolean): McpPage {
    this.settings.clients[agent] = on;
    this.save();
    this.apply(agent);
    return this.page();
  }

  /** Writes every turned-on agent's config again (as the app starts). */
  applyAll(): void {
    for (const c of MCP_CLIENTS) if (this.settings.clients[c.id]) this.apply(c.id);
  }

  private apply(agent: string): void {
    try {
      configure(agent, !!this.settings.clients[agent], this.launch);
      delete this.problems[agent];
    } catch (e) {
      this.problems[agent] = e instanceof Error ? e.message : String(e);
      this.log(`mcp config for ${agent}: ${this.problems[agent]}`);
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
  }
}
