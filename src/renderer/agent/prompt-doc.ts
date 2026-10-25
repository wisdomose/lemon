// The prompt's document: text with inline references (chips) to things on the canvas, and the rules
// for how the selection chip follows the canvas selection (agreed with the maintainer from the
// reference app's behaviour):
//   1. A chip is an inline item: text can go before and after it; Backspace deletes it.
//   2. A chip is "live" while it is the last thing in the prompt (spaces don't count; a line break
//      does). A live chip follows the canvas selection: another selection replaces it, deselecting
//      removes it.
//   3. Anything after a chip fixes it; deleting that again makes it live again.
//   4. When there is no live chip, a new selection adds a chip at the caret (if typing in the prompt)
//      or at the end.
import { Schema, type Node as PMNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { NodeType as LemonNodeType } from "../../doc/schema.js";

export const promptSchema = new Schema({
  nodes: {
    doc: { content: "paragraph" },
    paragraph: { content: "inline*", toDOM: () => ["p", 0], parseDOM: [{ tag: "p" }] },
    text: { group: "inline" },
    /** Shift+Enter. */
    hard_break: { inline: true, group: "inline", selectable: false, toDOM: () => ["br"], parseDOM: [{ tag: "br" }] },
    /** A reference to a node on the canvas. Drawn by the editor's node view. */
    chip: {
      inline: true,
      group: "inline",
      atom: true,
      selectable: false,
      attrs: { id: {}, name: {}, kind: { default: "frame" } },
      toDOM: (n) => ["span", { "data-chip": n.attrs.id }, n.attrs.name],
    },
  },
});

export interface ChipRef {
  id: string;
  name: string;
  kind: LemonNodeType;
}

/** The last chip, with its position, if nothing but spaces follows it. */
export function liveChip(doc: PMNode): { pos: number; node: PMNode } | null {
  let last: { pos: number; node: PMNode } | null = null;
  doc.descendants((node, pos) => {
    if (node.type.name === "chip") last = { pos, node };
    else if (node.type.name === "hard_break") last = null;
    else if (node.isText && /\S/.test(node.text ?? "")) last = null;
    return true;
  });
  return last;
}

/**
 * The change that applies a new canvas selection (`ref`, or null for nothing selected) to the prompt,
 * or null if nothing changes. `focused` says whether the person is typing in the prompt.
 */
export function followSelection(state: EditorState, ref: ChipRef | null, focused: boolean): Transaction | null {
  const live = liveChip(state.doc);
  if (live) {
    if (!ref) return state.tr.delete(live.pos, live.pos + 1);
    if (live.node.attrs.id === ref.id) return null;
    return state.tr.setNodeMarkup(live.pos, undefined, { ...ref });
  }
  if (!ref) return null;
  const chip = promptSchema.nodes.chip!.create({ ...ref });
  const at = focused ? state.selection.from : state.doc.content.size - 1;
  const tr = state.tr.insert(at, chip);
  // Keep typing after the new chip.
  if (focused) tr.setSelection(TextSelection.create(tr.doc, at + 1));
  return tr;
}

/** The prompt as the chat shows it (chips as their names) and as the agent gets it (chips as references). */
export function promptText(doc: PMNode): { shown: string; forAgent: string; refs: ChipRef[]; isEmpty: boolean; hasText: boolean } {
  let shown = "";
  let forAgent = "";
  let typed = "";
  const refs: ChipRef[] = [];
  doc.descendants((node) => {
    if (node.isText) {
      shown += node.text;
      forAgent += node.text;
      typed += node.text;
    } else if (node.type.name === "hard_break") {
      shown += "\n";
      forAgent += "\n";
    } else if (node.type.name === "chip") {
      const ref = node.attrs as ChipRef;
      refs.push(ref);
      shown += `[${ref.name}]`;
      forAgent += `<ref id="${ref.id}" type="${ref.kind}">${ref.name}</ref>`;
    }
    return true;
  });
  return { shown: shown.trim(), forAgent: forAgent.trim(), refs, isEmpty: !shown.trim(), hasText: !!typed.trim() };
}
