// What read_skill and get_style answer, as Pen's: the skill (SKILL.md and the files it points to) and
// the style archetypes (the art-direction library). Fixed text, so the connector answers these itself,
// with or without the app running.
import { PRODUCT } from "../product.js";
import { CRAFT, NODES, RESEARCH, canvasWork, newDesign } from "../agent/skill.js";
import { DIRECTIONS, type Direction } from "../agent/directions.js";

const STYLES = `# Styles

For a new design with no brand or style direction from the person, take a style archetype from the
\`get_style\` tool: \`get_style()\` lists them, \`get_style({ name })\` loads one, described by its ingredients
(composition, type, colour, imagery, details). Take one as the main direction or cross two or three —
the composition of one with the type of another and the colour of a third — and commit; a cautious
average is worse than any one of them. If the person names a style, that wins. Make the business fit
the direction, not the other way round.

Your habits are the enemy of variety. Unless a direction or the person calls for them, don't reach for:
Inter, DM Sans, Bricolage Grotesque or Fraunces; cream backgrounds with deep green or terracotta; a split
hero with a phone mockup; a "three steps" row of cards; a row of three testimonial cards; a centred
final call-to-action band.`;

const SKILL = `---
name: ${PRODUCT.slug}
description: Create high-quality visual designs — websites, app screens, dashboards — on the ${PRODUCT.name} canvas, or use the canvas as a whiteboard to research, plan, and compare with live browser nodes. Use when the task involves generating designs or working out a task on the canvas.
---

# ${PRODUCT.name}

${PRODUCT.name} is a design tool with an infinite canvas. Its documents are .pen files (Pen's format): a
tree of nodes, changed with the \`execute\` tool.

## Quick reference

| Topic | When to use | Reference |
| --- | --- | --- |
| \`.pen schema\` | The nodes and their properties. Required to read. | [pen-schema.md](./pen-schema.md) |
| \`execute\` | How to use the \`execute\` MCP tool to design on the canvas, and its API. Required to read. | [execute.md](./execute.md) |
| \`whiteboard\` | Research, evaluation, and planning work done on the canvas with live \`browser\` nodes. Required when the user asks you to research, compare, evaluate, plan, or prep something. | [whiteboard.md](./whiteboard.md) |

## General instructions

- Call \`get_app_state\` first: it gives the open file (pass it as \`filePath\`), what the person has
  selected, the top-level frames and the components.
- The person may change the document while you work, so what you remember may be stale. If a node is
  missing or no longer matches what you expected, read it again instead of recreating it, and don't undo
  their changes.
- Only do what's asked. For removing, moving, reordering or copying things, or a question, do just that.

${newDesign("mcp")}

${CRAFT}

${STYLES}`;

/** The skill's files by path, as read_skill serves them. */
export const SKILL_FILES: Record<string, string> = {
  "SKILL.md": SKILL,
  "execute.md": canvasWork("mcp"),
  "pen-schema.md": NODES.replace(/^## /, "# "),
  "whiteboard.md": RESEARCH,
};

export function readSkill(path?: string): string {
  const name = (path ?? "SKILL.md").replace(/^\.?\//, "");
  const file = SKILL_FILES[name];
  if (file === undefined) throw new Error(`There is no "${path}" in the skill. Its files: ${Object.keys(SKILL_FILES).join(", ")}.`);
  return file;
}

const describe = (d: Direction) =>
  `# ${d.name}\n\n${d.idea}\n\n- Composition: ${d.composition}\n- Type: ${d.type}\n- Colour: ${d.colour}\n- Imagery: ${d.imagery}\n- Details: ${d.details}`;

/** The styles listed, or one loaded by name (or id). Lemon's styles take no params. */
export function getStyle(name?: string): string {
  if (!name) return `# Available Styles\n\nCall get_style again with a style name\n\n## Styles\n\n${DIRECTIONS.map((d) => `- "${d.name}": ${d.idea}`).join("\n")}`;
  const key = name.trim().toLowerCase();
  const style = DIRECTIONS.find((d) => d.name.toLowerCase() === key || d.id === key);
  if (!style) throw new Error(`There is no style "${name}". Call get_style() for the list.`);
  return describe(style);
}

/** read_skill and get_style answered here; undefined for the tools the app runs. */
export function answerLocally(tool: string, args: Record<string, unknown>): { content: { type: "text"; text: string }[]; isError?: true } | undefined {
  if (tool !== "read_skill" && tool !== "get_style") return undefined;
  try {
    const text = tool === "read_skill" ? readSkill(args.path as string | undefined) : getStyle(args.name as string | undefined);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}
