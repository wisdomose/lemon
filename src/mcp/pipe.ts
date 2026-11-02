// Where the running app listens for outside agents (its MCP server, main/mcp.ts) and where the
// connector they start (mcp/connector.ts) reaches it: a named pipe on Windows, a socket elsewhere.
// One per user, so two people on one computer each reach their own app.
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

export function pipePath(slug: string): string {
  const user = userInfo().username.replace(/[^\w.-]/g, "_");
  return process.platform === "win32" ? `\\\\.\\pipe\\${slug}-mcp-${user}` : join(tmpdir(), `${slug}-mcp-${user}.sock`);
}

/** The connector's first line on the pipe, before the MCP messages: which agent it serves. */
export interface Hello {
  agent: string;
}
