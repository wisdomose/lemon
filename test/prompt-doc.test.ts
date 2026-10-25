import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { followSelection, liveChip, promptSchema, promptText, type ChipRef } from "../src/renderer/agent/prompt-doc.js";

const A: ChipRef = { id: "a", name: "Hero", kind: "frame" };
const B: ChipRef = { id: "b", name: "Footer", kind: "frame" };
const s = promptSchema;
const chip = (r: ChipRef) => s.nodes.chip!.create({ ...r });
const text = (t: string) => s.text(t);
const br = () => s.nodes.hard_break!.create();

/** A prompt state from inline pieces, with the caret at `caret` (default: end). */
function state(pieces: ReturnType<typeof chip>[], caret?: number) {
  const doc = s.nodes.doc!.create(null, s.nodes.paragraph!.create(null, pieces));
  const st = EditorState.create({ doc });
  const at = caret ?? doc.content.size - 1;
  return st.apply(st.tr.setSelection(TextSelection.create(doc, at)));
}
/** Applies a selection change and lists the prompt as text with chips in brackets. */
function after(st: EditorState, ref: ChipRef | null, focused = false) {
  const tr = followSelection(st, ref, focused);
  const next = tr ? st.apply(tr) : st;
  return { next, shown: promptText(next.doc).shown, changed: !!tr };
}

describe("selection chip in the prompt", () => {
  it("adds a chip at the end when nothing is live and the prompt isn't being typed in", () => {
    expect(after(state([]), A).shown).toBe("[Hero]");
    expect(after(state([text("make it bold ")]), A).shown).toBe("make it bold [Hero]");
  });

  it("a last chip follows the selection: replaced by another, removed when deselected", () => {
    const one = after(state([]), A).next;
    expect(after(one, B).shown).toBe("[Footer]");
    expect(after(one, null).shown).toBe("");
    expect(after(one, A).changed).toBe(false);
  });

  it("spaces after a chip don't fix it; text and line breaks do", () => {
    expect(liveChip(state([chip(A), text("   ")]).doc)).not.toBeNull();
    expect(after(state([chip(A), text("  ")]), B).shown).toBe("[Footer]");
    expect(liveChip(state([chip(A), text(" x")]).doc)).toBeNull();
    expect(liveChip(state([chip(A), br()]).doc)).toBeNull();
  });

  it("a fixed chip is left alone; a new selection adds another chip", () => {
    const fixed = state([chip(A), text(" more")]);
    expect(after(fixed, null).changed).toBe(false);
    expect(after(fixed, B).shown).toBe("[Hero] more[Footer]");
    // Selecting the same frame again also adds a chip.
    expect(after(fixed, A).shown).toBe("[Hero] more[Hero]");
  });

  it("deleting the text after a chip makes it live again", () => {
    let st = state([chip(A), text(" more")]);
    st = st.apply(st.tr.delete(2, st.doc.content.size - 1)); // remove " more"
    expect(after(st, null).shown).toBe("");
  });

  it("text before a chip doesn't matter", () => {
    expect(after(state([text("nnnn k "), chip(A)]), B).shown).toBe("nnnn k [Footer]");
  });

  it("while typing, a new chip goes at the caret and the caret moves past it", () => {
    const st = state([text("make  bold")], 6); // caret between the two spaces
    const { next, shown } = after(st, A, true);
    expect(shown).toBe("make [Hero] bold");
    expect(next.selection.from).toBe(7);
  });

  it("sends chips to the agent as references and shows their names", () => {
    const p = promptText(state([text("restyle "), chip(A), br(), text("like "), chip(B)]).doc);
    expect(p.shown).toBe("restyle [Hero]\nlike [Footer]");
    expect(p.forAgent).toBe('restyle <ref id="a" type="frame">Hero</ref>\nlike <ref id="b" type="frame">Footer</ref>');
    expect(p.refs.map((r) => r.id)).toEqual(["a", "b"]);
    expect(promptText(state([chip(A)]).doc)).toMatchObject({ hasText: false, isEmpty: false });
  });
});
