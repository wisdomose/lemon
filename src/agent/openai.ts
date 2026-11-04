// The OpenAI Completions protocol for API-key providers: streaming chat with the canvas tools (execute,
// and browser when there is one), looping until the model replies in text; "Let it cook" then asks for
// the next variation on the same conversation, as Codex's turns do. Tool arguments arrive complete (as with Codex), so steps
// run as whole scripts; text streams as it lands. A tool message can only hold text, so the pictures
// a step takes follow its results as a user message — for models that read pictures.
import type { CodexTool, ToolResultContent } from "./codex.js";
import type { ServerTool } from "./mcp-client.js";
import { chatContent, type Attachment } from "./attachments.js";

export interface OpenAIResult {
  reply: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  durationMs: number;
}

/** How many execute calls one run may make, as the other engines allow. */
const MAX_CALLS = 60;

/** A chat choice as it streams; only the fields the loop reads are declared. */
interface StreamChunk {
  choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

const url = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;

/** Reads one SSE body, handing each `data:` payload to `on` until [DONE] or the stream ends. */
async function readSSE(body: ReadableStream<Uint8Array>, on: (payload: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const at = buffer.indexOf("\n\n");
      if (at < 0) break;
      const event = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      for (const line of event.split("\n")) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (data && data !== "[DONE]") on(data);
      }
    }
  }
}

/** The run's one cancellation message, wherever the abort lands. */
const ensureLive = (o: { signal?: AbortSignal }): void => {
  if (o.signal?.aborted) throw new Error("The run was cancelled.");
};

/**
 * One design run (or tool-free planning turn) against an OpenAI-compatible endpoint. Every request
 * carries only the system prompt, the conversation and the canvas tools — nothing else is asked of it.
 */
export async function runOpenAICompat(o: {
  system: string;
  prompt: string;
  /** Files attached to the prompt, sent before it. */
  attachments?: Attachment[];
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  maxTokens?: number;
  /** The model reads pictures; otherwise it is told a picture was taken. */
  images?: boolean;
  signal?: AbortSignal;
  /** The canvas tools by name (execute, browser); a call to any other name is refused to the model. */
  tools?: Record<string, CodexTool>;
  /** Asked when the model is done: another message to send in the same conversation, or undefined. */
  followUp?: () => string | undefined;
  /** Tools of the MCP servers the person added (mcp-client.ts), offered beside the canvas tools. */
  serverTools?: Record<string, ServerTool>;
  /** A call to one of those starts, and ends (as runCodex reports them). */
  onServerTool?: (e: { id: string; tool: string; input: unknown } | { id: string; ok: boolean; content: ToolResultContent[] }) => void;
  onText?: (text: string, streamId: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<OpenAIResult> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const started = performance.now();
  type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
  const messages: { role: string; content: string | Part[] | null; tool_calls?: unknown; tool_call_id?: string }[] = [
    { role: "system", content: o.system },
    { role: "user", content: o.attachments?.length ? chatContent(o.attachments, o.prompt, !!o.images) : o.prompt },
  ];
  const result: OpenAIResult = { reply: "", durationMs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let calls = 0;
  let streamId = 0;
  const tools: [string, CodexTool][] = [...Object.entries(o.tools ?? {}), ...Object.entries(o.serverTools ?? {})];

  for (;;) {
    ensureLive(o);
    let response: Response;
    try {
      response = await fetchImpl(url(o.baseUrl, "/chat/completions"), {
        method: "POST",
        signal: o.signal,
        headers: {
          "content-type": "application/json",
          ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}),
          ...o.headers,
        },
        body: JSON.stringify({
          model: o.model,
          messages,
          stream: true,
          ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
          stream_options: { include_usage: true },
          ...(tools.length
            ? { tools: tools.map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.inputSchema } })), tool_choice: "auto" }
            : {}),
        }),
      });
    } catch (e) {
      if (o.signal?.aborted) throw new Error("The run was cancelled.");
      throw new Error(`Could not reach the provider: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(`The provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : "."}`);
    }

    let text = "";
    const pending = new Map<number, PendingCall>();
    let finish: string | undefined;
    await readSSE(response.body, (payload) => {
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        return;
      }
      if (chunk.error?.message) throw new Error(chunk.error.message);
      // Usage is per request; a run is every request of its tool loop.
      if (chunk.usage) {
        result.tokens.input += chunk.usage.prompt_tokens ?? 0;
        result.tokens.output += chunk.usage.completion_tokens ?? 0;
      }
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        if (delta?.content) {
          text += delta.content;
          o.onText?.(delta.content, `reply-${streamId}`);
        }
        for (const call of delta?.tool_calls ?? []) {
          const seen = pending.get(call.index) ?? { id: "", name: "", args: "" };
          if (call.id) seen.id = call.id;
          if (call.function?.name) seen.name = call.function.name;
          if (call.function?.arguments) seen.args += call.function.arguments;
          pending.set(call.index, seen);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    });
    streamId++;

    const completed = finish === "tool_calls" && pending.size > 0;
    if (!completed || !tools.length) {
      result.reply = text;
      // The model is done; "Let it cook" may ask for another design in the same conversation. The
      // reply is the last turn's, and the step limit is for each turn.
      const next = o.followUp?.();
      if (next === undefined) break;
      messages.push({ role: "assistant", content: text || null }, { role: "user", content: next });
      calls = 0;
      continue;
    }
    // The model asked for the canvas: run each call, then let it read the results.
    messages.push({ role: "assistant", content: text || null, tool_calls: [...pending.values()].map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) });
    const pictures: Part[] = [];
    for (const call of pending.values()) {
      if (++calls > MAX_CALLS) throw new Error(`The agent reached the ${MAX_CALLS}-step limit.`);
      let content: string;
      try {
        const server = o.serverTools?.[call.name];
        const tool = server ?? o.tools?.[call.name];
        if (!tool) throw new Error(`There is no "${call.name}" tool.`);
        const input: unknown = JSON.parse(call.args || "null");
        if (server) o.onServerTool?.({ id: call.id, tool: server.title, input });
        let r: Awaited<ReturnType<CodexTool["call"]>>;
        try {
          r = await tool.call(input);
        } catch (e) {
          if (server) o.onServerTool?.({ id: call.id, ok: false, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] });
          throw e;
        }
        if (server) o.onServerTool?.({ id: call.id, ok: !r.isError, content: r.content });
        content = r.content.map((c) => {
          if (c.type === "text") return c.text;
          if (!o.images) return "(a picture was taken; this model can't see pictures)";
          pictures.push({ type: "image_url", image_url: { url: `data:${c.mimeType};base64,${c.data}` } });
          return `(picture ${pictures.length} follows)`;
        }).join("\n") || "(no output)";
      } catch (e) {
        // A malformed call or a failed script goes back to the model as the tool's result, so it can retry.
        content = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    if (pictures.length) messages.push({ role: "user", content: [{ type: "text", text: "The pictures from the steps above:" }, ...pictures] });
    text = "";
  }

  ensureLive(o);
  result.durationMs = performance.now() - started;
  return result;
}
