// The app's MCP server, as Pen's: outside agents (Claude Code, Codex, Claude Desktop…) design in the
// open files through the same tools the app's own agents use. They start the connector
// (mcp/connector.ts), which reaches this server over a local pipe (mcp/pipe.ts); each connection is
// one agent, named by the connector's first line.
import { existsSync, rmSync } from "node:fs";
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PRODUCT } from "../product.js";
import type { Engine } from "../engine.js";
import type { Sandbox, Globals } from "../sandbox/sandbox.js";
import { AgentChange, PersonEdits } from "../doc/live.js";
import { nodesOf, toTree } from "../doc/store.js";
import { execute } from "../agent/execute.js";
import { FailedScripts } from "../agent/patches.js";
import { notRun, summarise } from "../agent/agent.js";
import { runBrowser, browserSchema } from "../agent/browser-tool.js";
import { pipePath, type Hello } from "../mcp/pipe.js";
import { EXT } from "./files.js";
import type { Editor } from "./editor.js";

export interface McpHost {
  engine: Engine;
  sandbox: Sandbox;
  /** The file tab shown, if any. */
  shown(): Editor | undefined;
  /** Every open file tab. */
  editors(): Editor[];
  /** Opens `path` in a tab (or shows its tab). */
  open(path: string): Editor | undefined;
  log(msg: string): void;
}

/** The agents the connector is started for (its --agent flag), by the names they are shown under. */
export const AGENT_NAMES: Record<string, string> = {
  claudeCodeCLI: "Claude Code",
  codexCLI: "Codex",
  geminiCLI: "Gemini",
  antigravity: "Antigravity",
  openCodeCLI: "OpenCode",
  kiroCLI: "Kiro",
  claudeDesktop: "Claude",
};

const INSTRUCTIONS = `This MCP server is for interacting with ${PRODUCT.name} and .pen design files (web/mobile apps and websites). Use it to read, generate, and validate designs.

While ${PRODUCT.name} has a .pen file open it keeps its own copy and saves over the file: change open files only through these tools, never by writing the file.

Make sure you are aware of the .pen schema and the instructions for the execute tool (read_skill).`;

const EXECUTE_DESCRIPTION = `Run a JavaScript snippet against a .pen document open in ${PRODUCT.name} (Insert, Copy, Update, Replace, Move, Delete, Get, SetVariables, GetVariables, FindEmptySpace, Print, TakeScreenshot). The person sees each change on the canvas. All-or-nothing: if it throws, everything it did is removed and the result gives an editId. Use read_skill if you don't have execute documentation.`;

/** What one agent has going in one document: its failed scripts, its globals and its steps. */
interface Session {
  failed: FailedScripts;
  globals: Globals;
  steps: number;
  personEdits: PersonEdits;
}

const sameFile = (a: string, b: string) => {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/** The Markdown get_app_state answers with (as Pen's). */
export function appState(host: McpHost): string {
  const editor = host.shown();
  const lines = ["# Current App State", "", "Use your best judgement based on the app state whether the user task relates to the canvas, the browser or both.", "", "## Canvas Editor", ""];
  if (!editor) {
    lines.push("- Currently active canvas editor: none (Home is shown)");
    const open = host.editors().filter((e) => e.path);
    lines.push(`- Open files: ${open.length ? open.map((e) => `\`${e.path}\``).join(", ") : "none"}`);
  } else {
    const nodes = nodesOf(editor.doc);
    const label = (id: string) => {
      const n = nodes.get(id);
      return n ? `\`${id}\` (${n.get("type")}): ${n.get("name") ?? n.get("type")}` : `\`${id}\``;
    };
    const top = toTree(editor.doc).children;
    const components = [...nodes].filter(([, n]) => n.get("reusable") === true).map(([id]) => id);
    lines.push(
      `- Currently active canvas editor: ${editor.path ? `\`${editor.path}\`` : `a new file, not saved yet (pass "" as filePath)`}`,
      `- Selected nodes: ${editor.selection.length ? editor.selection.map(label).join(", ") : "No nodes are selected"}`,
      `- Top-level nodes: ${top.length ? top.map((n) => label(n.id)).join(", ") : "The canvas is empty"}`,
      `- Reusable components: ${components.length ? components.map(label).join(", ") : "No reusable components found"}`,
    );
  }
  lines.push("", "## Integrated Browser", "");
  const side = editor?.pages.state();
  const pick = side?.pick;
  const path = pick ? pick.crumbs.slice(0, pick.index + 1).map((c) => [c.tag, ...c.classes].join(".")).join(" > ") : undefined;
  const browserNodes = editor ? [...nodesOf(editor.doc)].filter(([, n]) => n.get("type") === "browser") : [];
  lines.push(
    `- Currently loaded URL: \`${side?.url ?? "no URL loaded in the browser"}\``,
    `- Selected element path in the browser: ${path ? `\`${path}\`` : "no element selected in the browser"}`,
    browserNodes.length
      ? `- Browser nodes on the canvas (type "browser"), driven by passing their node id as the browser tool's "nodeId": ${browserNodes.map(([id, n]) => `\`${id}\` "${n.get("name") ?? "Browser"}" at ${n.get("url") || "no address"}`).join(", ")}`
      : `- Browser nodes on the canvas (type "browser") are driven by passing their node id as the browser tool's "nodeId".`,
  );
  return lines.join("\n");
}

/** Starts listening; returns a function that stops. */
export function startMcpServer(host: McpHost): () => void {
  const path = pipePath(PRODUCT.slug);
  // A socket file left by an app that didn't close cleanly would refuse the new one (not on Windows).
  if (process.platform !== "win32" && existsSync(path)) rmSync(path);
  const connections = new Set<() => void>();
  const server: NetServer = createServer((socket) => {
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const nl = head.indexOf(0x0a);
      if (nl < 0) return;
      socket.off("data", onData);
      let hello: Hello;
      try {
        hello = JSON.parse(head.subarray(0, nl).toString("utf8")) as Hello;
      } catch {
        socket.destroy();
        return;
      }
      if (nl + 1 < head.length) socket.unshift(head.subarray(nl + 1));
      void serve(host, socket, hello, connections);
    };
    socket.on("data", onData);
    socket.on("error", () => {});
  });
  server.on("error", (e) => host.log(`mcp server: ${e.message}`));
  server.listen(path, () => host.log(`mcp server on ${path}`));
  return () => {
    for (const end of connections) end();
    server.close();
  };
}

async function serve(host: McpHost, socket: Socket, hello: Hello, connections: Set<() => void>): Promise<void> {
  const agent = AGENT_NAMES[hello.agent] ?? (hello.agent || "Agent");
  host.log(`mcp: ${agent} connected`);
  const sessions = new Map<Editor, Session>();
  const sessionOf = (editor: Editor): Session => {
    let s = sessions.get(editor);
    if (!s) sessions.set(editor, (s = { failed: new FailedScripts(), globals: {}, steps: 0, personEdits: new PersonEdits(editor.doc) }));
    return s;
  };
  /** The tab for `filePath`: an open one, else the file opened now; "" is the tab shown. */
  const editorFor = (filePath: string | undefined): Editor => {
    if (!filePath) {
      const shown = host.shown();
      if (!shown) throw new Error(`No file is shown in ${PRODUCT.name}. Pass the filePath of a .pen file.`);
      return shown;
    }
    const open = host.editors().find((e) => e.path && sameFile(e.path, filePath));
    if (open) return open;
    if (!filePath.toLowerCase().endsWith(EXT)) throw new Error(`"${filePath}" isn't a ${EXT} file.`);
    if (!existsSync(filePath)) throw new Error(`There is no file at "${filePath}".`);
    const opened = host.open(resolve(filePath));
    if (!opened) throw new Error(`${PRODUCT.name} couldn't open "${filePath}".`);
    return opened;
  };
  const failure = (e: unknown) => ({ content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }], isError: true });

  const mcp = new McpServer({ name: PRODUCT.slug, version: "0.0.1" }, { instructions: INSTRUCTIONS });

  mcp.registerTool(
    "get_app_state",
    { description: `Get info about the current state of the ${PRODUCT.name} app, current user selections and other essential information to get started on a task.`, inputSchema: {} },
    async () => ({ content: [{ type: "text", text: appState(host) }] }),
  );

  mcp.registerTool(
    "execute",
    {
      description: EXECUTE_DESCRIPTION,
      inputSchema: {
        description: z.string().optional().describe('Shown to the user as the label of this call. Write it first, before `input` or `edits`. A short, specific phrase of 3-8 words starting with an imperative verb that says what this call does to the design, e.g. "Add pricing section with 3 tiers". No trailing period.'),
        input: z.string().optional().describe("The JavaScript snippet to execute. Required unless `edits` is provided."),
        editId: z.string().optional().describe("The id of the failed snippet to patch, as printed in that call's failure message. Send it only together with `edits`."),
        edits: z
          .array(z.object({ find: z.string().describe("Exact text in the failed snippet to replace. Must match exactly once unless `all` is true."), replace: z.string().describe("The replacement text."), all: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match.") }))
          .optional()
          .describe("When an execute call fails, ALWAYS retry with this instead of resending the snippet in `input`. Each edit replaces `find` with `replace` in the failed snippet, then the patched snippet re-runs from scratch. Requires `editId`; omit `input` when using it."),
        filePath: z.string().describe(`The path of the .pen file to work on (from get_app_state); "" for the file shown.`),
      },
    },
    async ({ input, editId, edits, filePath }) => {
      let editor: Editor;
      try {
        editor = editorFor(filePath);
      } catch (e) {
        return failure(e);
      }
      const s = sessionOf(editor);
      const origin = new AgentChange(agent, ++s.steps);
      let script = input ?? "";
      let problem: string | undefined;
      try {
        if (editId) script = s.failed.patch(editId, edits ?? []);
        else if (!input) problem = "Send `input`, or `edits` with the `editId` of a failed snippet.";
      } catch (e) {
        problem = (e as Error).message;
      }
      const r = problem ? notRun(problem, s.globals) : await execute(editor.doc, host.engine, host.sandbox, script, origin, s.personEdits.peek(), s.globals);
      let failedId: string | undefined;
      if (r.ok) {
        s.globals = r.globals;
        if (editId) s.failed.done(editId);
      } else if (r.timings.attempts) failedId = s.failed.keep(script, editId);
      else failedId = editId;
      s.personEdits.take();
      return {
        content: [
          { type: "text" as const, text: summarise(r, failedId) },
          ...r.pictures.map((p) => ({ type: "image" as const, data: Buffer.from(p.png).toString("base64"), mimeType: "image/png" })),
        ],
        ...(r.ok ? {} : { isError: true }),
      };
    },
  );

  mcp.registerTool(
    "browser",
    {
      description: `Interact with a real website loaded in the app's integrated browser (a sidebar beside the canvas) or in a browser node on the canvas: open a URL, reproduce a page (or one element) as editable canvas layers, screenshot it, or pull its DOM/screenshot back into the conversation. Call action "load-page" before the other actions so a page is loaded.`,
      inputSchema: { ...browserSchema.shape, filePath: z.string().describe(`The path of the .pen file whose browser to use (from get_app_state); "" for the file shown.`) },
    },
    async ({ filePath, ...input }) => {
      let editor: Editor;
      try {
        editor = editorFor(filePath);
      } catch (e) {
        return failure(e);
      }
      const s = sessionOf(editor);
      const r = await runBrowser(input, { pages: editor.pages, doc: editor.doc, engine: host.engine, origin: new AgentChange(agent, ++s.steps) });
      s.personEdits.take();
      return { content: r.content, ...(r.ok ? {} : { isError: true }) };
    },
  );

  const transport = new StdioServerTransport(socket, socket);
  const end = () => {
    connections.delete(end);
    for (const s of sessions.values()) s.personEdits.dispose();
    sessions.clear();
    void mcp.close().catch(() => {});
    socket.destroy();
  };
  connections.add(end);
  socket.once("close", () => {
    host.log(`mcp: ${agent} disconnected`);
    end();
  });
  await mcp.connect(transport);
}
