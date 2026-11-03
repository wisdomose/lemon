// Signing in to the MCP servers added in Settings → MCP that want it (Notion, Mobbin, Linear without
// an API key), as other MCP clients do: the server's sign-in page opens in the browser, comes back
// to a page on this computer, and the app keeps the token. The agents then get it as an
// `Authorization: Bearer` header, the same way an API key reaches them, so Claude and Codex need
// nothing of their own. The OAuth steps (discovery, registration, PKCE, refresh) are the MCP SDK's.
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { PRODUCT } from "../product.js";
import type { PersonServers } from "../agent/mcp-servers.js";
import type { ServerStatus, SignInState } from "../mcp/settings.js";

/** What the secrets file can do: the app encrypts with the system's keychain (Electron safeStorage). */
export interface Vault {
  available: () => boolean;
  encrypt: (text: string) => Buffer;
  decrypt: (data: Buffer) => string;
}

interface Saved {
  clients: Record<string, OAuthClientInformationMixed & { redirect?: string }>;
  tokens: Record<string, OAuthTokens & { savedAt: number }>;
}

/** The page the browser comes back to (tried first; another free one if it's taken). */
const CALLBACK_PORT = 38517;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** A token this close to running out is refreshed before an agent gets it. */
const REFRESH_EARLY_MS = 60_000;

const hasAuthHeader = (s: Record<string, unknown>) =>
  !!s.headers && typeof s.headers === "object" && Object.keys(s.headers).some((k) => k.toLowerCase() === "authorization");

export class McpAuth {
  private saved: Saved = { clients: {}, tokens: {} };
  private errors = new Map<string, string>();
  private signingIn = new Map<string, Promise<void>>();

  constructor(
    private readonly file: string,
    private readonly vault: Vault,
    private readonly openUrl: (url: string) => void,
    private readonly log: (msg: string) => void,
  ) {
    try {
      const raw = readFileSync(file);
      const text = raw[0] === 0x7b ? raw.toString("utf8") : vault.decrypt(raw);
      this.saved = { clients: {}, tokens: {}, ...(JSON.parse(text) as Partial<Saved>) };
    } catch {
      // Nothing saved yet, or written by another system account: sign in again.
    }
  }

  /** Each server's state; servers that might want a sign-in are asked (briefly) whether they do. */
  async status(servers: PersonServers): Promise<Record<string, ServerStatus>> {
    const out: Record<string, ServerStatus> = {};
    await Promise.all(
      Object.entries(servers).map(async ([name, s]) => {
        const error = typeof s.url === "string" ? this.errors.get(s.url) : undefined;
        const state = await this.stateOf(s);
        out[name] = { state, ...(error && state !== "signed-in" ? { error } : {}) };
      }),
    );
    return out;
  }

  private async stateOf(s: Record<string, unknown>): Promise<SignInState> {
    if (typeof s.url !== "string") return "local";
    if (hasAuthHeader(s)) return "api-key";
    if (this.saved.tokens[s.url]) return "signed-in";
    return probe(s.url);
  }

  /** Signs in to the server: its page opens in the browser; done once the browser comes back. */
  signIn(url: string): Promise<void> {
    const running = this.signingIn.get(url);
    if (running) return running;
    const run = this.runSignIn(url).finally(() => this.signingIn.delete(url));
    this.signingIn.set(url, run);
    return run;
  }

  private async runSignIn(url: string): Promise<void> {
    this.errors.delete(url);
    const callback = await listen();
    try {
      const provider = this.provider(url, callback.redirect, true);
      if ((await auth(provider, { serverUrl: url })) === "AUTHORIZED") return;
      const code = await callback.code(provider.expectedState);
      await auth(provider, { serverUrl: url, authorizationCode: code });
      this.log(`mcp sign-in: signed in to ${url}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.errors.set(url, message);
      this.log(`mcp sign-in: ${url}: ${message}`);
      throw e;
    } finally {
      callback.close();
    }
  }

  signOut(url: string): void {
    delete this.saved.tokens[url];
    this.errors.delete(url);
    this.save();
  }

  /**
   * The servers as the agents get them: one the person signed in to carries its token (refreshed
   * when it is running out). A server that can't be refreshed is passed without, and shows as
   * needing a sign-in again.
   */
  async forAgents(servers: PersonServers): Promise<PersonServers> {
    const out: PersonServers = {};
    for (const [name, s] of Object.entries(servers)) {
      out[name] = s;
      if (typeof s.url !== "string" || hasAuthHeader(s)) continue;
      const token = await this.freshToken(s.url);
      if (token) out[name] = { ...s, headers: { ...((s.headers as Record<string, string> | undefined) ?? {}), Authorization: `Bearer ${token}` } };
    }
    return out;
  }

  private async freshToken(url: string): Promise<string | undefined> {
    const tokens = this.saved.tokens[url];
    if (!tokens) return undefined;
    const expiresAt = tokens.expires_in ? tokens.savedAt + tokens.expires_in * 1000 : Infinity;
    if (Date.now() < expiresAt - REFRESH_EARLY_MS) return tokens.access_token;
    if (!tokens.refresh_token) return (this.signOutWith(url, "The sign-in ran out. Sign in again."), undefined);
    try {
      // With a refresh token saved, auth() refreshes; it only asks for the browser if that fails.
      const result = await auth(this.provider(url, this.saved.clients[url]?.redirect ?? "", false), { serverUrl: url });
      if (result === "AUTHORIZED" && this.saved.tokens[url]) return this.saved.tokens[url]!.access_token;
    } catch (e) {
      this.log(`mcp sign-in: refreshing ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.signOutWith(url, "The sign-in ran out. Sign in again.");
    return undefined;
  }

  private signOutWith(url: string, error: string): void {
    this.signOut(url);
    this.errors.set(url, error);
  }

  /** The SDK's view of one server's saved sign-in. Only an interactive one opens the browser. */
  private provider(url: string, redirect: string, interactive: boolean): OAuthClientProvider & { expectedState: string } {
    const store = this;
    let verifier = "";
    const state = crypto.randomUUID();
    return {
      expectedState: state,
      get redirectUrl() {
        return redirect;
      },
      get clientMetadata(): OAuthClientMetadata {
        return {
          client_name: PRODUCT.name,
          redirect_uris: [redirect],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        };
      },
      state: () => state,
      // A registration made for another return address (the usual port was taken) can't be used.
      clientInformation: () => {
        const c = store.saved.clients[url];
        return c && (!interactive || c.redirect === redirect) ? c : undefined;
      },
      saveClientInformation: (info) => {
        store.saved.clients[url] = { ...info, redirect };
        store.save();
      },
      tokens: () => store.saved.tokens[url],
      saveTokens: (tokens) => {
        store.saved.tokens[url] = { ...tokens, savedAt: Date.now() };
        store.save();
      },
      redirectToAuthorization: (to) => {
        if (!interactive) throw new Error("Needs a sign-in in the browser.");
        store.openUrl(to.toString());
      },
      saveCodeVerifier: (v) => void (verifier = v),
      codeVerifier: () => verifier,
    };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const text = JSON.stringify(this.saved);
    writeFileSync(this.file, this.vault.available() ? this.vault.encrypt(text) : text);
  }
}

/** Asks an HTTP MCP server to start a session: 401 means it wants a sign-in. */
async function probe(url: string): Promise<SignInState> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: PRODUCT.slug, version: "0.0.1" } } }),
      signal: AbortSignal.timeout(8000),
    });
    void res.body?.cancel();
    return res.status === 401 ? "needs-sign-in" : res.ok ? "open" : "unreachable";
  } catch {
    return "unreachable";
  }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px system-ui;background:#1b1b1d;color:#eee;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#aaa">${text}</p></div>`;

/** The page on this computer the browser comes back to with the sign-in's code. */
async function listen(): Promise<{ redirect: string; code: (state: string) => Promise<string>; close: () => void }> {
  let deliver: (q: URLSearchParams) => void = () => {};
  const arrived = new Promise<URLSearchParams>((r) => (deliver = r));
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname !== "/callback") return void res.writeHead(404).end();
    const failed = u.searchParams.get("error");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(failed ? PAGE("Sign-in didn't finish", `You can close this tab and try again in ${PRODUCT.name}.`) : PAGE(`Signed in to ${PRODUCT.name}`, `You can close this tab and go back to ${PRODUCT.name}.`));
    deliver(u.searchParams);
  });
  const port = await new Promise<number>((resolve, reject) => {
    const tryPort = (p: number) => {
      server.once("error", (e: NodeJS.ErrnoException) => (p && e.code === "EADDRINUSE" ? tryPort(0) : reject(e)));
      server.listen(p, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    };
    tryPort(CALLBACK_PORT);
  });
  let timer: NodeJS.Timeout | undefined;
  return {
    redirect: `http://127.0.0.1:${port}/callback`,
    code: async (state) => {
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("The sign-in wasn't finished in the browser.")), SIGN_IN_TIMEOUT_MS)));
      const q = await Promise.race([arrived, timeout]);
      const error = q.get("error");
      if (error) throw new Error(q.get("error_description") ?? `The server said: ${error}`);
      if (q.get("state") !== state) throw new Error("The sign-in came back for another request.");
      const code = q.get("code");
      if (!code) throw new Error("The sign-in came back without a code.");
      return code;
    },
    close: () => (clearTimeout(timer), server.close()),
  };
}
