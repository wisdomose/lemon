import { describe, expect, it } from "vitest";
import { forClaude, forCodex, serverNames } from "../src/agent/mcp-servers.js";

const servers = {
  linear: { url: "https://mcp.linear.app/mcp" },
  old: { type: "sse", url: "https://example.com/sse", headers: { Authorization: "Bearer x" } },
  local: { command: "node", args: ["server.js", 3], env: { DEBUG: 1 } },
  lemon: { command: "takes the canvas tools' name" },
  broken: { note: "no command or url" },
};

describe("the person's MCP servers", () => {
  it("leave out what can't be used: no command or url, or the canvas tools' own name", () => {
    expect(serverNames(servers)).toEqual(["linear", "old", "local"]);
  });

  it("reach Claude as http, sse or stdio servers", () => {
    expect(forClaude(servers)).toEqual({
      linear: { type: "http", url: "https://mcp.linear.app/mcp" },
      old: { type: "sse", url: "https://example.com/sse", headers: { Authorization: "Bearer x" } },
      local: { type: "stdio", command: "node", args: ["server.js", "3"], env: { DEBUG: "1" } },
    });
  });

  it("reach Codex as config overrides, turned on", () => {
    expect(forCodex(servers)).toEqual({
      "mcp_servers.linear.enabled": true,
      "mcp_servers.linear.url": "https://mcp.linear.app/mcp",
      "mcp_servers.old.enabled": true,
      "mcp_servers.old.url": "https://example.com/sse",
      "mcp_servers.old.http_headers": { Authorization: "Bearer x" },
      "mcp_servers.local.enabled": true,
      "mcp_servers.local.command": "node",
      "mcp_servers.local.args": ["server.js", "3"],
      "mcp_servers.local.env": { DEBUG: "1" },
    });
  });
});
