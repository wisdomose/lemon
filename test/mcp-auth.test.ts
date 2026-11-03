import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpAuth } from "../src/main/mcp-auth.js";

// A stand-in MCP server that wants an OAuth sign-in, with its own authorization server: discovery,
// registration, an authorize page that sends the browser straight back, and a token endpoint.
let server: Server;
let base = "";
const issued = { code: "code-1", tokens: 0 };
const valid = new Set<string>();
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", base);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => (res.writeHead(status, { "Content-Type": "application/json", ...headers }), res.end(JSON.stringify(body)));
    let body = "";
    for await (const chunk of req) body += chunk;
    if (u.pathname === "/mcp") {
      // Like Linear's: only "Bearer <token>" is read.
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (token && valid.has(token)) return json(200, { jsonrpc: "2.0", id: 1, result: {} });
      return json(401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
    }
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp") return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (u.pathname === "/.well-known/oauth-authorization-server")
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (u.pathname === "/register") return json(201, { ...JSON.parse(body), client_id: "client-1" });
    if (u.pathname === "/authorize") {
      const back = new URL(u.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", issued.code);
      back.searchParams.set("state", u.searchParams.get("state")!);
      return void (res.writeHead(302, { Location: back.toString() }), res.end());
    }
    if (u.pathname === "/token") {
      const form = new URLSearchParams(body);
      const ok = form.get("grant_type") === "authorization_code" ? form.get("code") === issued.code && !!form.get("code_verifier") : form.get("refresh_token") === "refresh-1";
      if (!ok) return json(400, { error: "invalid_grant" });
      const access = `access-${++issued.tokens}`;
      valid.add(access);
      // The first token runs out at once, so the next use refreshes it.
      return json(200, { access_token: access, token_type: "Bearer", expires_in: issued.tokens === 1 ? 1 : 3600, refresh_token: "refresh-1" });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => void server.close());

// "The browser": follows the sign-in page's redirect back to the app's page on this computer.
const browser = (url: string) => void fetch(url, { redirect: "follow" });
const dir = mkdtempSync(join(tmpdir(), "lemon-mcp-auth-"));
const vault = { available: () => true, encrypt: (t: string) => Buffer.from(`sealed:${t}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, "") };

describe("signing in to an added MCP server", () => {
  it("shows a server that wants it as needing a sign-in, and gives the agents no token yet", async () => {
    const a = new McpAuth(join(dir, "a"), vault, browser, () => {});
    expect(await a.status({ s: { url: `${base}/mcp` } })).toEqual({ s: { state: "needs-sign-in" } });
    expect(await a.forAgents({ s: { url: `${base}/mcp` } })).toEqual({ s: { url: `${base}/mcp` } });
  });

  it("signs in through the browser, keeps the token sealed, refreshes it, and signs out", async () => {
    const file = join(dir, "b");
    const a = new McpAuth(file, vault, browser, () => {});
    const servers = { s: { url: `${base}/mcp` } };
    await a.signIn(`${base}/mcp`);
    expect((await a.status(servers)).s).toEqual({ state: "signed-in" });
    expect(readFileSync(file, "utf8")).toMatch(/^sealed:/);

    // The first token has already run out: the agents get a refreshed one, which the server takes.
    const agents = await a.forAgents(servers);
    expect(agents.s!.headers).toEqual({ Authorization: "Bearer access-2" });
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: agents.s!.headers as Record<string, string> });
    expect(res.status).toBe(200);

    // Read back by a new start of the app.
    const again = new McpAuth(file, vault, browser, () => {});
    expect((await again.forAgents(servers)).s!.headers).toEqual({ Authorization: "Bearer access-2" });

    again.signOut(`${base}/mcp`);
    expect((await again.status(servers)).s).toEqual({ state: "needs-sign-in" });
  });

  it("signs in as an agent starts, as Pen's does, and asks about each server only once", async () => {
    const opened: string[] = [];
    const a = new McpAuth(join(dir, "d"), vault, (u) => (opened.push(u), browser(u)), () => {});
    const servers = { s: { url: `${base}/mcp` }, keyed: { url: `${base}/mcp`, headers: { Authorization: "Bearer x" } }, local: { command: "node" } };
    expect(await a.wanted(servers)).toEqual([{ name: "s", url: `${base}/mcp` }]);
    await a.signInForAgent(`${base}/mcp`);
    expect(opened).toHaveLength(1);
    expect((await a.forAgents(servers)).s!.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer access-/) });
    // Signed out again: the next agent doesn't open the browser by itself; Settings → MCP signs in.
    a.signOut(`${base}/mcp`);
    expect(await a.wanted(servers)).toEqual([]);
  });

  it("leaves a server with its own key alone, and says when the server turns the key down", async () => {
    const a = new McpAuth(join(dir, "c"), vault, browser, () => {});
    valid.add("mine");
    const keyed = { s: { url: `${base}/mcp`, headers: { Authorization: "Bearer mine" } } };
    expect((await a.status(keyed)).s).toEqual({ state: "api-key" });
    expect(await a.forAgents(keyed)).toEqual(keyed);
    // A key without "Bearer " (the usual slip), and a wrong key.
    expect((await a.status({ s: { url: `${base}/mcp`, headers: { Authorization: "mine" } } })).s).toEqual({
      state: "key-rejected",
      error: `Its server didn't accept the key. The Authorization header usually reads "Bearer <key>".`,
    });
    expect((await a.status({ s: { url: `${base}/mcp`, headers: { Authorization: "Bearer wrong" } } })).s).toEqual({ state: "key-rejected", error: "Its server didn't accept the key in its headers." });
  });
});
