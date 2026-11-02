import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Launch } from "../src/main/mcp-settings.js";
import { parseServers } from "../src/mcp/settings.js";

// The agents' config files live in the home folder: a fresh one for these tests.
const home = mkdtempSync(join(tmpdir(), "lemon-mcp-home-"));
let m: typeof import("../src/main/mcp-settings.js");
beforeAll(async () => {
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("APPDATA", join(home, "AppData", "Roaming"));
  m = await import("../src/main/mcp-settings.js");
});

const launch: Launch = { command: "C:\\Apps\\Lemon\\lemon.exe", args: (a) => ["C:\\Apps\\Lemon\\connector.js", "--agent", a], env: { ELECTRON_RUN_AS_NODE: "1" } };

describe("an outside agent's config", () => {
  it("gets the connector beside what is there, and loses it again", () => {
    const path = join(home, ".claude.json");
    writeFileSync(path, JSON.stringify({ theme: "dark", mcpServers: { pencil: { command: "pen.exe" } } }));
    m.configure("claudeCodeCLI", true, launch);
    const on = JSON.parse(readFileSync(path, "utf8"));
    expect(on.theme).toBe("dark");
    expect(on.mcpServers.pencil).toEqual({ command: "pen.exe" });
    expect(on.mcpServers.lemon).toEqual({ command: launch.command, args: launch.args("claudeCodeCLI"), env: launch.env, type: "stdio" });
    m.configure("claudeCodeCLI", false, launch);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ theme: "dark", mcpServers: { pencil: { command: "pen.exe" } } });
  });

  it("writes OpenCode's own shape, and makes the file when there is none", () => {
    m.configure("openCodeCLI", true, launch);
    const entry = JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")).mcp.lemon;
    expect(entry).toMatchObject({ type: "local", command: [launch.command, ...launch.args("openCodeCLI")], environment: launch.env, enabled: true });
  });

  it("leaves a file that isn't plain JSON alone", () => {
    const dir = join(home, ".kiro", "settings");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.json"), "{ // comment\n}");
    expect(() => m.configure("kiroCLI", true, launch)).toThrow(/isn't plain JSON/);
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toBe("{ // comment\n}");
  });

  it("puts a table in Codex's config.toml, replaces it, and takes it out with its env table", () => {
    const dir = join(home, ".codex");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "config.toml");
    const theirs = 'model = "gpt-5"\n\n[mcp_servers.pencil]\ncommand = "pen.exe"\n';
    writeFileSync(path, theirs);
    m.configure("codexCLI", true, launch);
    m.configure("codexCLI", true, launch);
    const on = readFileSync(path, "utf8");
    expect(on.match(/\[mcp_servers\.lemon\]/g)).toHaveLength(1);
    expect(on).toContain('command = "C:\\\\Apps\\\\Lemon\\\\lemon.exe"');
    expect(on).toContain('[mcp_servers.lemon.env]\nELECTRON_RUN_AS_NODE = "1"');
    m.configure("codexCLI", false, launch);
    expect(readFileSync(path, "utf8").trimEnd()).toBe(theirs.trimEnd());
  });
});

describe("the servers for the app's own agents", () => {
  it("takes { mcpServers } with a command or url for each", () => {
    expect(parseServers('{"mcpServers":{"linear":{"url":"https://mcp.linear.app/mcp"}}}')).toHaveProperty("linear");
    expect(() => parseServers('{"servers":{}}')).toThrow(/mcpServers/);
    expect(() => parseServers('{"mcpServers":{"x":{}}}')).toThrow(/"x" needs/);
    expect(() => parseServers("{")).toThrow();
  });
});
