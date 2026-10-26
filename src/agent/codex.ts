// Codex's local app server owns authentication; Lemon handles only canvas tools and public account data.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { CodexModel } from "./models.js";
import { PRODUCT } from "../product.js";

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message: string };
}

/** A local JSON-lines connection, with request deadlines and deterministic process cleanup. */
export class CodexConnection {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private failure?: Error;
  onMessage?: (message: RpcMessage) => void;
  onClose?: (error: Error) => void;

  constructor() {
    this.child = spawn("codex", ["app-server"], { stdio: "pipe", windowsHide: true });
    // Drain diagnostics without exposing potentially sensitive configuration in the UI.
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      let m: RpcMessage;
      try { m = JSON.parse(line) as RpcMessage; }
      catch { this.fail(new Error("Codex returned invalid JSON.")); return; }
      if (m.id !== undefined && !m.method) {
        const pending = this.pending.get(Number(m.id));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(Number(m.id));
        if (m.error) pending.reject(new Error(m.error.message));
        else pending.resolve(m.result);
      } else this.onMessage?.(m);
    });
    this.child.on("error", () => this.fail(new Error("Could not start Codex. Install Codex CLI and run `codex login`.")));
    this.child.on("exit", () => this.fail(new Error("Codex app server stopped.")));
    this.child.stdin.on("error", () => this.fail(new Error("Codex connection closed.")));
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onClose?.(error);
  }

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: PRODUCT.slug, title: PRODUCT.name, version: "0.0.1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.send({ method: "initialized", params: {} });
  }

  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.send({ id, method, params });
    });
  }

  send(message: RpcMessage) {
    if (!this.failure) this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  close() {
    this.fail(new Error("Codex connection closed."));
    this.child.stdin.end();
    this.child.kill();
  }
}

export interface ProviderStatus {
  loggedIn: boolean;
  email?: string;
  plan?: string;
}

/** Read account metadata through Codex, without opening its credential files. */
export async function codexStatus(): Promise<ProviderStatus> {
  const connection = new CodexConnection();
  try {
    await connection.initialize();
    const { account } = await connection.request<{ account: { email?: string; planType?: string } | null }>("account/read", { refreshToken: false });
    return { loggedIn: !!account, ...(account?.email ? { email: account.email } : {}), ...(account?.planType ? { plan: account.planType } : {}) };
  } catch {
    return { loggedIn: false };
  } finally {
    connection.close();
  }
}

// Validate the public protocol boundary; malformed or partial catalogs must not replace cached models.
const modelPage = z.object({
  data: z.array(z.object({
    model: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().default(""),
    hidden: z.boolean().default(false),
    supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string().min(1), description: z.string().default("") })).default([]),
    defaultReasoningEffort: z.string().nullable().optional(),
    isDefault: z.boolean().default(false),
  })),
  nextCursor: z.string().nullable().default(null),
});

/** Discover every picker-visible model through the signed-in CLI, without starting a model turn. */
export async function codexModels(): Promise<CodexModel[]> {
  const connection = new CodexConnection();
  try {
    await connection.initialize();
    const models = new Map<string, CodexModel>();
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = modelPage.parse(await connection.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }));
      for (const m of page.data) {
        if (m.hidden) continue;
        const efforts = [...new Map(m.supportedReasoningEfforts.map((e) => [e.reasoningEffort, { id: e.reasoningEffort, description: e.description }])).values()];
        const id = `codex:${m.model}`;
        models.set(id, {
          id, provider: "codex", label: m.displayName, description: m.description, efforts,
          ...(m.defaultReasoningEffort && efforts.some((e) => e.id === m.defaultReasoningEffort) ? { defaultEffort: m.defaultReasoningEffort } : {}),
          isDefault: m.isDefault,
        });
      }
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Codex repeated a model-list cursor. Try refreshing models.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return [...models.values()];
  } finally {
    connection.close();
  }
}

export interface CodexTool {
  description: string;
  inputSchema: Record<string, unknown>;
  call(input: unknown): Promise<{ content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean }>;
}

interface CodexResult {
  reply: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  durationMs: number;
}

/** One ephemeral design turn; the same transport also runs tool-free team planning. */
export async function runCodex(o: {
  system: string;
  prompt: string;
  model: string;
  effort?: string;
  signal?: AbortSignal;
  tool?: CodexTool;
  onText?: (text: string, streamId: string) => void;
}): Promise<CodexResult> {
  o.signal?.throwIfAborted();
  const connection = new CodexConnection();
  const started = performance.now();
  let threadId: string | undefined;
  let turnId: string | undefined;
  let calls = 0;
  const activeCalls = new Set<Promise<void>>();
  let settled = false;
  const result: CodexResult = { reply: "", durationMs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let complete!: () => void;
  let reject!: (error: Error) => void;
  const done = new Promise<void>((resolve, fail) => { complete = resolve; reject = fail; });
  // Attach immediately: an exit during initialization must never cause an unhandled rejection.
  void done.catch(() => {});
  const abort = () => {
    if (threadId && turnId) void connection.request("turn/interrupt", { threadId, turnId }).catch(() => {});
    reject(new Error("Codex run cancelled."));
    connection.close();
  };
  connection.onClose = (error) => { if (!settled) reject(error); };
  connection.onMessage = (m) => {
    const p = m.params ?? {};
    if (m.method === "item/tool/call" && m.id !== undefined) {
      const id = m.id;
      // Reject every unregistered tool, including any future server-initiated approval flow.
      if (p.tool !== "execute" || !o.tool || ++calls > 60 || o.signal?.aborted) {
        connection.send({ id, result: { success: false, contentItems: [{ type: "inputText", text: "Tool unavailable or step limit reached." }] } });
        if (calls > 60) { reject(new Error("Codex reached the 60-step limit.")); connection.close(); }
        return;
      }
      const tool = o.tool;
      const call = Promise.resolve().then(() => tool.call(p.arguments)).then((r) => {
        connection.send({ id, result: {
          success: !r.isError,
          contentItems: r.content.map((c) => c.type === "text" ? { type: "inputText", text: c.text } : { type: "inputImage", imageUrl: `data:${c.mimeType};base64,${c.data}` }),
        } });
      }).catch((e: unknown) => connection.send({ id, result: { success: false, contentItems: [{ type: "inputText", text: String(e) }] } }));
      activeCalls.add(call);
      void call.finally(() => activeCalls.delete(call));
    } else if (m.id !== undefined && m.method) {
      connection.send({ id: m.id, error: { code: -32601, message: "Lemon only permits the canvas execute tool." } });
    } else if (m.method === "item/agentMessage/delta") {
      const text = typeof p.delta === "string" ? p.delta : "";
      result.reply += text;
      o.onText?.(text, String(p.itemId));
    } else if (m.method === "thread/tokenUsage/updated") {
      const total = (p.tokenUsage as { total?: { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteInputTokens?: number } })?.total;
      if (total) result.tokens = { input: total.inputTokens, output: total.outputTokens, cacheRead: total.cachedInputTokens, cacheWrite: total.cacheWriteInputTokens ?? 0 };
    } else if (m.method === "turn/started") {
      turnId = (p.turn as { id: string }).id;
    } else if (m.method === "turn/completed") {
      const turn = p.turn as { status: string; error?: { message: string } };
      if (turn.status === "completed") complete();
      else reject(new Error(turn.error?.message ?? `Codex turn ${turn.status}.`));
    }
  };
  o.signal?.addEventListener("abort", abort, { once: true });
  try {
    await connection.initialize();
    o.signal?.throwIfAborted();
    const cwd = join(tmpdir(), `${PRODUCT.slug}-agent`);
    mkdirSync(cwd, { recursive: true });
    // Disable inherited integrations explicitly: table overrides otherwise merge with user settings.
    const { config } = await connection.request<{ config: { mcp_servers?: Record<string, unknown> } }>("config/read", { includeLayers: false });
    const thread = await connection.request<{ thread: { id: string } }>("thread/start", {
      ...(o.model === "codex" ? {} : { model: o.model.replace(/^codex:/, "") }),
      cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
      baseInstructions: o.system,
      developerInstructions: "Use only execute to work on the canvas. Never use shell, files, web, or external integrations.",
      config: {
        "features.shell_tool": false, "features.hooks": false,
        "features.plugins": false, "features.remote_plugin": false, "features.apps": false,
        "features.browser_use": false, "features.computer_use": false,
        "features.image_generation": false, "features.view_image": false,
        "features.skip_host_skill_discovery": true,
        "agents.enabled": false, "tools.view_image": false, "web_search": "disabled",
        "project_doc_max_bytes": 0,
        ...Object.fromEntries(Object.keys(config.mcp_servers ?? {}).map((name) => [`mcp_servers.${name}.enabled`, false])),
      },
      dynamicTools: o.tool ? [{ type: "function", name: "execute", description: o.tool.description, inputSchema: o.tool.inputSchema }] : [],
    });
    threadId = thread.thread.id;
    o.signal?.throwIfAborted();
    const turn = await connection.request<{ turn: { id: string } }>("turn/start", {
      threadId, input: [{ type: "text", text: o.prompt, text_elements: [] }],
      ...(o.effort ? { effort: o.effort } : {}),
    });
    turnId = turn.turn.id;
    await done;
    result.durationMs = performance.now() - started;
    return result;
  } finally {
    settled = true;
    o.signal?.removeEventListener("abort", abort);
    connection.close();
    // Finish in-flight canvas work before runAgent clears marks and edit tracking.
    await Promise.allSettled(activeCalls);
  }
}
