// The MCP tools outside agents get, as Pen's: their names, descriptions, inputs and hints. Shared by
// the connector (mcp/connector.ts), which lists them without the app, and the app's server
// (main/mcp.ts), which runs them. Kept free of the app's own code so the connector stays small.
import { z } from "zod";
import { PRODUCT } from "../product.js";

export const INSTRUCTIONS = `This MCP server is for interacting with ${PRODUCT.name} and .pen design files (web/mobile apps and websites). Use it to read, generate, and validate designs.

While ${PRODUCT.name} has a .pen file open it keeps its own copy and saves over the file: change open files only through these tools, never by writing the file. Follow each tool's input schema exactly.

Make sure you are aware of the .pen schema and the instructions for the execute tool.`;

const filePath = z.string().describe("An optional file path to access a .pen file.");

export const TOOLS = {
  execute: {
    description: "Use get_app_state if you don't have execute documentation",
    annotations: { title: `Edit ${PRODUCT.name} design`, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      description: z
        .string()
        .optional()
        .describe('Shown to the user as the label of this call. Write it first, before `input` or `edits`. A short, specific phrase of 3-8 words starting with an imperative verb that says what this call does to the design, e.g. "Add pricing section with 3 tiers", "Fix header alignment". No trailing period.'),
      editId: z
        .string()
        .optional()
        .describe("The id of the failed snippet to patch, as printed in that call's failure message. Send it only together with `edits`, and always use a valid editId that is referencing a failed execute call. Never send it alongside `input`."),
      edits: z
        .array(
          z.object({
            all: z.boolean().optional().describe("Replace every occurrence instead of requiring a unique match."),
            find: z.string().describe("Exact text in the failed snippet to replace. Must match exactly once unless `all` is true."),
            replace: z.string().describe("The replacement text."),
          }),
        )
        .optional()
        .describe("When an execute call fails, ALWAYS retry with this instead of resending the snippet in `input`. Each edit replaces `find` with `replace` in the failed snippet, then the patched snippet re-runs from scratch. Edits apply in order: each `find` must match the snippet as already modified by the preceding edits. Requires `editId`; omit `input` when using it. If the patched snippet fails again, keep fixing it with further `edits` under the same editId - `find` must then match the already-patched snippet."),
      filePath,
      input: z.string().optional().describe("The JavaScript snippet to execute. Required unless `edits` is provided."),
    },
  },
  get_app_state: {
    description: `Get info about the current state of the ${PRODUCT.name} app, current user selections and other essential information to get started on a task.`,
    annotations: { title: `Get ${PRODUCT.name} app state`, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {},
  },
  browser: {
    description: `Interact with a real website loaded in the app's integrated browser: open a URL, reproduce a page (or one element) as editable canvas layers, screenshot it, or pull its DOM/screenshot back into the conversation.

Parameters:
- action (required): "load-page" loads "url" (opening the browser sidebar if closed and no "nodeId" is given); "import-to-canvas" reproduces the target as editable layers on the canvas; "screenshot-to-canvas" places a screenshot of the target on the canvas as an image; "return-element" returns the target element's DOM and computed styles as text; "return-screenshot" returns a screenshot of the target as an image; "cdp" sends one Chrome DevTools Protocol command ("method" + "params") to the page and returns its result.
- nodeId: the id of a browser node in the document to drive. When omitted, the tool drives the browser sidebar's own page. Find browser node ids with get_app_state.
- target (default "full-page"): "full-page", "selection" (the element the user picked with the browser's element picker), or "query" (the element "querySelector" resolves).

Usage:
- Call action "load-page" before the other actions so a page is loaded and visible.
- Prefer target "query" or "selection" over "full-page" to keep imports and reads focused. A whole page's DOM can be huge: query a specific section, or use "return-screenshot" to view the whole page cheaply.
- Imported pages land as normal canvas nodes: edit them with the execute tool like any other content.
- Only the DOM, Input, Page, Runtime, Emulation, CSS and Accessibility CDP domains are available. Do not send Escape: the editor intercepts it.`,
    annotations: { title: `Use ${PRODUCT.name} browser`, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      action: z.enum(["load-page", "import-to-canvas", "screenshot-to-canvas", "return-element", "return-screenshot", "cdp"]).describe("What to do: load-page, import-to-canvas, screenshot-to-canvas, return-element, return-screenshot, or cdp."),
      filePath,
      method: z.string().optional().describe('A Chrome DevTools Protocol method, e.g. "Input.dispatchMouseEvent". Required when action is "cdp".'),
      nodeId: z.string().optional().describe("Id of a browser node in the document to drive. Omit to drive the browser sidebar's own page."),
      params: z.record(z.string(), z.unknown()).optional().describe('The CDP command\'s parameters for "method", e.g. {"expression": "document.title", "returnByValue": true} for Runtime.evaluate. Used when action is "cdp".'),
      querySelector: z.string().optional().describe('A CSS selector executed in the page. Required when target is "query".'),
      target: z.enum(["full-page", "selection", "query"]).optional().describe("What to act on (default full-page)."),
      url: z.string().optional().describe('An http(s) or file URL to load. Used when action is "load-page".'),
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
