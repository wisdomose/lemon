// The designer agent: Claude, through the Claude Agent SDK and the person's own Claude login, with one
// tool (`execute`) and nothing else — no shell, files or web.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer, query, tool, type SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type * as Y from "yjs";
import { z } from "zod";
import { PRODUCT } from "../product.js";
import type { Engine } from "../engine.js";
import type { Sandbox } from "../sandbox/sandbox.js";
import { execute, LiveRun, type ExecuteResult, type Focus } from "./execute.js";
import { AgentChange, PersonEdits } from "../doc/live.js";
import { INSTRUCTIONS } from "./instructions.js";
import { pickStartingPoints } from "./directions.js";
import { exists, nodesOf, toTree } from "../doc/store.js";
import { partialField, scriptTarget, type Target } from "./live-script.js";
import { FailedScripts } from "./patches.js";
import type { Globals } from "../sandbox/sandbox.js";
import { DEFAULT_MODEL } from "./models.js";

const TOOL_NAME = `mcp__${PRODUCT.slug}__execute`;
/** How often the script being written is re-read for where it will work next. */
const READ_EVERY_MS = 100;

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
  /** The agent has begun writing a step's script (sent once its title is written). */
  | { type: "step-writing"; index: number; title: string }
  /** Where the script being written will work next, read from the unfinished script. */
  | { type: "step-target"; index: number; target: Target }
  /** A statement of the script being written has landed on the document; `focus` is where it worked. */
  | { type: "step-progress"; index: number; focus: Focus }
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

/** A step that never ran (its edits didn't fit the failed script). */
function notRun(message: string, globals: Globals): ExecuteResult {
  return {
    ok: false,
    error: { name: "EditError", message },
    globals,
    refs: {},
    logs: [],
    leftAlone: [],
    issues: [],
    frames: [],
    pictures: [],
    timings: { totalMs: 0, scriptMs: 0, layoutMs: 0, picturesMs: 0, fontsMs: 0, attempts: 0 },
  };
}

function summarise(r: ExecuteResult, editId?: string): string {
  const lines: string[] = [];
  if (!r.ok) {
    lines.push(`FAILED — nothing from this script was kept.`);
    lines.push(`${r.error?.name ?? "Error"}${r.error?.line ? ` at line ${r.error.line}` : ""}: ${r.error?.message}`);
    if (editId) lines.push(`Fix it with \`edits\` and editId "${editId}" — don't send the script again.`);
  } else {
    lines.push("Done — the change is on the canvas.");
    if (r.value !== undefined && r.value !== null) {
      const v = JSON.stringify(r.value);
      lines.push(`Returned: ${v.length > 6000 ? v.slice(0, 6000) + " …(cut)" : v}`);
    }
    if (Object.keys(r.refs).length) lines.push(`Refs: ${JSON.stringify(r.refs)}`);
    const kept = Object.keys(r.globals);
    if (kept.length) lines.push(`Globals kept for your next scripts: ${kept.join(", ")}.`);
    if (r.leftAlone.length) {
      lines.push(`Left alone — the person changed these while you were working, so their values stay:\n${r.leftAlone.map((l) => `- ${l}`).join("\n")}`);
    }
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
  // People's edits during this run: a step doesn't overwrite what the agent couldn't have seen.
  const personEdits = new PersonEdits(o.doc);
  const directions = pickStartingPoints(o.recentDirections);
  emit({ type: "started", directions: directions.map((d) => d.id), name: o.name ?? "agent", model, prompt: o.prompt });
  // "Thought for Ns": time from the last thing the agent did to its next action.
  let lastActivity = performance.now();
  const thought = () => {
    const seconds = Math.round((performance.now() - lastActivity) / 1000);
    if (seconds >= 1) emit({ type: "thought", seconds });
  };

  // The execute call the model is writing right now, read as it streams (see live-script.ts).
  let writing: { block: number; index: number; json: string; titled: boolean; target: string; readAt: number } | undefined;
  let blocksInMessage = 0;
  /** Steps whose card appeared while being written (their thinking time is already shown). */
  const announced = new Set<number>();
  /** Values the agent's scripts left on the global object, carried into its next script. */
  let globals: Globals = {};
  const failed = new FailedScripts();
  /** Each step's origin (its changes' label in the document), made when the step is first seen. */
  const origins = new Map<number, AgentChange>();
  const originOf = (index: number) => origins.get(index) ?? origins.set(index, new AgentChange(o.name ?? "agent", index)).get(index)!;
  /** Steps whose statements are landing while the model writes them, until their call arrives. */
  const live = new Map<number, LiveRun>();
  const onStream = (ev: SDKPartialAssistantMessage["event"]) => {
    if (ev.type === "message_start") blocksInMessage = 0;
    else if (ev.type === "content_block_start") {
      if (ev.content_block.type === "tool_use" && ev.content_block.name === TOOL_NAME) {
        writing = { block: ev.index, index: steps.length + 1 + blocksInMessage++, json: "", titled: false, target: "", readAt: 0 };
        // The same step written again (the model's reply was restarted): drop what the first try landed.
        void live.get(writing.index)?.cancel();
        live.delete(writing.index);
      }
    } else if (ev.type === "content_block_delta") {
      if (!writing || ev.index !== writing.block || ev.delta.type !== "input_json_delta") return;
      writing.json += ev.delta.partial_json;
      const title = writing.titled ? undefined : partialField(writing.json, "title");
      if (title?.done) {
        writing.titled = true;
        thought();
        announced.add(writing.index);
        emit({ type: "step-writing", index: writing.index, title: title.value });
      }
      const now = performance.now();
      if (!writing.titled || now - writing.readAt < READ_EVERY_MS) return;
      writing.readAt = now;
      const script = partialField(writing.json, "script")?.value;
      if (script === undefined) return;
      // Statements land as they are written: only for the step the agent is on (a second call in the
      // same message runs once it arrives, after the first).
      let run = live.get(writing.index);
      if (!run && writing.index === steps.length + 1) {
        const index = writing.index;
        run = new LiveRun(o.doc, o.engine, o.sandbox, originOf(index), personEdits.peek(), globals, (focus) =>
          emit({ type: "step-progress", index, focus }),
        );
        live.set(index, run);
      }
      run?.feed(script);
      // Until its first statement lands, the cursor goes where the script is about to work.
      if (run?.started) return;
      const target = scriptTarget(script, (id) => exists(o.doc, id), globals);
      const key = JSON.stringify(target ?? null);
      if (target && key !== writing.target) {
        writing.target = key;
        emit({ type: "step-target", index: writing.index, target });
      }
    } else if (ev.type === "content_block_stop" && ev.index === writing?.block) writing = undefined;
  };

  const executeTool = tool(
    "execute",
    "Run a JavaScript script against the design document (global `doc`). Each statement lands on the canvas as soon as it is written. All-or-nothing: if it throws, everything it did is removed and the result gives an editId; fix it by sending `edits` with that editId instead of a script. Returns the result, ref ids, log lines, the automatic layout check and any pictures requested with doc.screenshot().",
    {
      title: z.string().describe("A short plain-language name for this step, shown to the person."),
      script: z.string().optional().describe("The script: a function body; `return` a value to get it back. Leave out when sending edits."),
      editId: z.string().optional().describe("The editId of the failed script that `edits` fix."),
      edits: z
        .array(z.object({ find: z.string(), replace: z.string() }))
        .optional()
        .describe("Find-and-replace edits applied in order to the failed script; each `find` must match exactly once."),
    },
    async ({ title, script: written, editId, edits }) => {
      const index = steps.length + 1;
      // "Thought for Ns" was already shown when the agent began writing this step.
      if (!announced.has(index)) thought();
      emit({ type: "step-start", index, title });
      let script = written ?? "";
      let problem: string | undefined;
      try {
        if (editId) script = failed.patch(editId, edits ?? []);
        else if (!written) problem = "Send a `script`, or `edits` with the `editId` of a failed one.";
      } catch (e) {
        problem = (e as Error).message;
      }
      const run = live.get(index);
      live.delete(index);
      let r: ExecuteResult;
      if (problem) r = notRun(problem, globals);
      else if (run && !editId && run.writes(script)) r = await run.finish(script);
      else {
        await run?.cancel();
        r = await execute(o.doc, o.engine, o.sandbox, script, originOf(index), personEdits.peek(), globals);
      }
      let failedId: string | undefined;
      if (r.ok) {
        globals = r.globals;
        if (editId) failed.done(editId);
      } else if (r.timings.attempts) failedId = failed.keep(script, editId);
      else failedId = editId;
      // From here the agent has reported back; edits after this are ones its next script can't know about.
      personEdits.take();
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
      const output = summarise(r, failedId);
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
        includePartialMessages: true, // the script as it is written, for the live cursor
        cwd,
        abortController: abort,
      },
    })) {
      if (m.type === "stream_event" && !m.parent_tool_use_id) onStream(m.event);
      else if (m.type === "assistant" && !m.parent_tool_use_id) {
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
  // Steps whose call never came (the run stopped while the agent was writing): remove what landed.
  for (const run of live.values()) await run.cancel();
  // A frame the agent left marked as being built (it stopped, or forgot) is no longer being built.
  const marked = [...nodesOf(o.doc).entries()].filter(([, rec]) => rec.get("generating")).map(([id]) => id);
  if (marked.length) o.doc.transact(() => marked.forEach((id) => nodesOf(o.doc).get(id)!.delete("generating")), new AgentChange(o.name ?? "agent", steps.length));
  stats.durationMs = performance.now() - started;
  personEdits.dispose();
  emit({ type: "done", stats });
  return stats;
}
