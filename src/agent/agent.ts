// The designer agent: Claude, through the Claude Agent SDK and the person's own Claude login, with one
// tool (`execute`) and nothing else — no shell, files or web.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type * as Y from "yjs";
import { z } from "zod";
import { PRODUCT } from "../product.js";
import type { Engine } from "../engine.js";
import type { Sandbox } from "../sandbox/sandbox.js";
import { execute, type ExecuteResult } from "./execute.js";
import { INSTRUCTIONS } from "./instructions.js";
import { pickStartingPoints } from "./directions.js";
import { toTree } from "../doc/store.js";
import { DEFAULT_MODEL } from "./models.js";

const TOOL_NAME = `mcp__${PRODUCT.slug}__execute`;

export interface StepRecord {
  index: number;
  title: string;
  ok: boolean;
  error?: string;
  issues: number;
  issueKinds: Record<string, number>;
  pictures: number;
  scriptChars: number;
  timings: ExecuteResult["timings"];
  /** Seconds from the start of the run until this step finished. */
  at: number;
}

/** What a step card shows when opened: the script, what it returned, and any pictures. */
export interface StepDetail {
  script: string;
  output: string;
  pictures: { id: string; png: Uint8Array; width: number; height: number }[];
}

export type AgentEvent =
  | { type: "started"; directions: string[]; name: string; model: string; prompt: string }
  /** Time the model spent before its next action (shown as "Thought for Ns"). */
  | { type: "thought"; seconds: number }
  | { type: "step-start"; index: number; title: string }
  | { type: "step-end"; step: StepRecord; detail: StepDetail; focus?: ExecuteResult["focus"]; frames: string[] }
  | { type: "text"; text: string }
  | { type: "done"; stats: AgentStats }
  | { type: "error"; message: string };

export interface AgentStats {
  ok: boolean;
  reply: string;
  durationMs: number;
  apiMs: number;
  turns: number;
  costUsd: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  steps: StepRecord[];
  directions: string[];
  model: string;
}

export interface AgentOptions {
  doc: Y.Doc;
  engine: Engine;
  sandbox: Sandbox;
  prompt: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** The agent's name, shown on its cursor and in the chat. */
  name?: string;
  recentDirections?: string[];
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}

function summarise(r: ExecuteResult): string {
  const lines: string[] = [];
  if (!r.ok) {
    lines.push(`FAILED — nothing from this script was kept.`);
    lines.push(`${r.error?.name ?? "Error"}${r.error?.line ? ` at line ${r.error.line}` : ""}: ${r.error?.message}`);
  } else {
    lines.push("Done — the change is on the canvas.");
    if (r.value !== undefined && r.value !== null) {
      const v = JSON.stringify(r.value);
      lines.push(`Returned: ${v.length > 6000 ? v.slice(0, 6000) + " …(cut)" : v}`);
    }
    if (Object.keys(r.refs).length) lines.push(`Refs: ${JSON.stringify(r.refs)}`);
  }
  if (r.logs.length) lines.push(`Log:\n${r.logs.join("\n")}`);
  if (r.ok) {
    if (r.issues.length) {
      lines.push(`Automatic check — ${r.issues.length} issue(s):`);
      for (const i of r.issues) lines.push(`- [${i.kind}] ${i.name ? `"${i.name}" ` : ""}(${i.id}) ${i.message}`);
    } else {
      lines.push("Automatic check: no problems found.");
    }
    if (r.pictures.length) lines.push(`Pictures attached: ${r.pictures.map((p) => p.id).join(", ")}.`);
  }
  return lines.join("\n");
}

function canvasSummary(doc: Y.Doc): string {
  const frames = toTree(doc).children;
  if (!frames.length) return "The canvas is empty.";
  return `On the canvas: ${frames.map((f) => `"${f.props.name ?? f.type}" (${f.id})`).join(", ")}.`;
}

export async function runAgent(o: AgentOptions): Promise<AgentStats> {
  const model = o.model ?? DEFAULT_MODEL;
  const emit = o.onEvent ?? (() => {});
  const started = performance.now();
  const steps: StepRecord[] = [];
  const directions = pickStartingPoints(o.recentDirections);
  emit({ type: "started", directions: directions.map((d) => d.id), name: o.name ?? "agent", model, prompt: o.prompt });
  // "Thought for Ns": time from the last thing the agent did to its next action.
  let lastActivity = performance.now();
  const thought = () => {
    const seconds = Math.round((performance.now() - lastActivity) / 1000);
    if (seconds >= 1) emit({ type: "thought", seconds });
  };

  const executeTool = tool(
    "execute",
    "Run a JavaScript script against the design document (global `doc`). All-or-nothing: if it throws, nothing is kept. Returns the result, ref ids, log lines, the automatic layout check and any pictures requested with doc.screenshot().",
    {
      title: z.string().describe("A short plain-language name for this step, shown to the person."),
      script: z.string().describe("The script: a function body; `return` a value to get it back."),
    },
    async ({ title, script }) => {
      const index = steps.length + 1;
      thought();
      emit({ type: "step-start", index, title });
      const r = await execute(o.doc, o.engine, o.sandbox, script, { agent: o.name ?? "agent" });
      const issueKinds: Record<string, number> = {};
      for (const i of r.issues) issueKinds[i.kind] = (issueKinds[i.kind] ?? 0) + 1;
      const step: StepRecord = {
        index,
        title,
        ok: r.ok,
        ...(r.error ? { error: r.error.message } : {}),
        issues: r.issues.length,
        issueKinds,
        pictures: r.pictures.length,
        scriptChars: script.length,
        timings: r.timings,
        at: (performance.now() - started) / 1000,
      };
      steps.push(step);
      const output = summarise(r);
      emit({
        type: "step-end",
        step,
        detail: { script, output, pictures: r.pictures },
        ...(r.focus ? { focus: r.focus } : {}),
        frames: r.frames,
      });
      lastActivity = performance.now();
      return {
        content: [
          { type: "text" as const, text: output },
          ...r.pictures.map((p) => ({
            type: "image" as const,
            data: Buffer.from(p.png).toString("base64"),
            mimeType: "image/png",
          })),
        ],
        ...(r.ok ? {} : { isError: true }),
      };
    },
  );

  const server = createSdkMcpServer({ name: PRODUCT.slug, version: "0.0.1", tools: [executeTool] });
  const abort = new AbortController();
  o.signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const cwd = join(tmpdir(), `${PRODUCT.slug}-agent`);
  mkdirSync(cwd, { recursive: true });

  const message = [
    o.prompt.trim(),
    "",
    `<canvas>${canvasSummary(o.doc)}</canvas>`,
    `<starting-points>For a new design, start from: ${directions.map((d) => `${d.name} (${d.id})`).join("; ")}.</starting-points>`,
  ].join("\n");

  const stats: AgentStats = {
    ok: false,
    reply: "",
    durationMs: 0,
    apiMs: 0,
    turns: 0,
    costUsd: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    steps,
    directions: directions.map((d) => d.id),
    model,
  };

  try {
    for await (const m of query({
      prompt: message,
      options: {
        model,
        ...(o.effort ? { effort: o.effort } : {}),
        systemPrompt: INSTRUCTIONS,
        tools: [], // no built-in tools at all
        mcpServers: { [PRODUCT.slug]: server },
        strictMcpConfig: true, // ignore MCP servers configured on this machine
        allowedTools: [TOOL_NAME],
        permissionMode: "dontAsk", // anything not allowed above is refused, never asked
        settingSources: [], // ignore the person's Claude settings and memory files
        persistSession: false,
        maxTurns: 60,
        cwd,
        abortController: abort,
      },
    })) {
      if (m.type === "assistant" && !m.parent_tool_use_id) {
        for (const block of m.message.content) {
          if (block.type === "text" && block.text.trim()) {
            thought();
            emit({ type: "text", text: block.text });
            lastActivity = performance.now();
          }
        }
      } else if (m.type === "result") {
        stats.ok = m.subtype === "success" && !m.is_error;
        stats.reply = m.subtype === "success" ? m.result : `Stopped: ${m.subtype}`;
        stats.apiMs = m.duration_api_ms;
        stats.turns = m.num_turns;
        stats.costUsd = m.total_cost_usd;
        for (const u of Object.values(m.modelUsage)) {
          stats.tokens.input += u.inputTokens;
          stats.tokens.output += u.outputTokens;
          stats.tokens.cacheRead += u.cacheReadInputTokens;
          stats.tokens.cacheWrite += u.cacheCreationInputTokens;
        }
      }
    }
  } catch (e) {
    emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    stats.reply = stats.reply || `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
  stats.durationMs = performance.now() - started;
  emit({ type: "done", stats });
  return stats;
}
