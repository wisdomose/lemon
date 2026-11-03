// The prompt box: a small ProseMirror editor, so canvas references (chips) sit inline in the text as
// in the reference app. Enter sends, Shift+Enter breaks the line; pasted content arrives as plain text.
import "prosemirror-view/style/prosemirror.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import { Box, Circle, createElement, Frame, Globe, Image, Layers, Palette, Square, Type, type IconNode } from "lucide";
import { followSelection, promptSchema, promptText, type ChipRef } from "./prompt-doc.js";

const ICONS: Record<string, IconNode> = { frame: Frame, text: Type, rect: Square, ellipse: Circle, image: Image, nodes: Layers, browser: Globe, skill: Box, style: Palette };

/** A skill's chip is filled purple (Pen, 3 Nov 2026); the others are outlined. */
const CHIP_LOOK: Record<string, string> = {
  skill: "bg-[#3c1e58] text-[#d2b3f0]",
};

/**
 * How a chip looks (measured from the reference: 21px tall, 1px border, 10px muted text). It is anchored
 * to the top of its line and overhangs 2px below without taking space, so lines with chips stay as tall
 * as lines without (19.5px) and the chip's middle meets the middle of the capitals around it.
 */
class ChipView implements NodeView {
  dom: HTMLElement;
  constructor(node: PMNode) {
    const el = document.createElement("span");
    el.className = `mx-px inline-flex h-[21px] max-w-[200px] items-center gap-[3px] rounded-[4px] px-[5px] mb-[-2px] align-top text-[10px] leading-none select-none ${
      CHIP_LOOK[node.attrs.kind as string] ?? "border border-input text-muted-foreground"
    }`;
    el.contentEditable = "false";
    const icon = createElement(ICONS[node.attrs.kind as string] ?? Frame, { width: 11, height: 11, "stroke-width": 1.5 });
    icon.classList.add("shrink-0");
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = node.attrs.name as string;
    el.append(icon, label);
    this.dom = el;
  }
  ignoreMutation() {
    return true;
  }
}

/** Marks the editor empty (no text, no chips) so the placeholder shows. */
const emptyClass = new Plugin({
  props: {
    attributes: (state): Record<string, string> => (state.doc.firstChild?.childCount ? {} : { class: "is-empty" }),
  },
});

export interface PromptEditorHandle {
  /** The prompt's contents. */
  read(): ReturnType<typeof promptText>;
  clear(): void;
  focus(): void;
  /** Types `text` at the caret (at the end if the prompt isn't being typed in) and focuses the prompt. */
  type(text: string): void;
  /** Puts a chip (and a space after it) in place of `range` (the "/word" a list was opened by), or at the caret. */
  insertChip(chip: ChipRef, range?: { from: number; to: number }): void;
}

/** A "/word" just before the caret: the list of skills is open for it. */
export interface Slash {
  /** What's typed after the "/". */
  query: string;
  from: number;
  to: number;
}

/** The "/word" ending at the caret, if any: "/" at the start or after a space, then no spaces. */
export function slashAt(state: EditorState): Slash | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $at = selection.$from;
  // Chips read as one character that can't be part of the word; a line break as a space.
  const before = $at.parent.textBetween(0, $at.parentOffset, undefined, (leaf) => (leaf.type.name === "hard_break" ? "\n" : "￼"));
  const m = /(?:^|\s)\/([^\s/￼]*)$/.exec(before);
  return m ? { query: m[1]!, from: $at.pos - m[1]!.length - 1, to: $at.pos } : null;
}

export const PromptEditor = forwardRef<
  PromptEditorHandle,
  {
    selection: ChipRef | null;
    placeholder: string;
    onSubmit: () => void;
    onChange: (hasContent: boolean) => void;
    /** Files pasted into the prompt (they are attached, not typed). */
    onFiles?: (files: File[]) => void;
    /** A "/word" was typed (or changed, or is gone: null), for the list of skills. */
    onSlash?: (slash: Slash | null) => void;
    /** A key pressed while the list of skills is open: true if the list used it. */
    onListKey?: (key: string) => boolean;
    large?: boolean;
  }
>(function PromptEditor({ selection, placeholder, onSubmit, onChange, onFiles, onSlash, onListKey, large }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks, read from inside ProseMirror's handlers.
  const submit = useRef(onSubmit);
  const change = useRef(onChange);
  const files = useRef(onFiles);
  const slash = useRef(onSlash);
  const listKey = useRef(onListKey);
  submit.current = onSubmit;
  change.current = onChange;
  files.current = onFiles;
  slash.current = onSlash;
  listKey.current = onListKey;
  /** The "/word" last reported, so only changes are. */
  const lastSlash = useRef("");

  useEffect(() => {
    const v = new EditorView(host.current!, {
      state: EditorState.create({
        schema: promptSchema,
        plugins: [
          history(),
          // While the list of skills is open, its keys (arrows, Enter, Tab, Escape) go to it first.
          new Plugin({
            props: {
              handleKeyDown: (v, event) =>
                !!slashAt(v.state) && ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key) && !!listKey.current?.(event.key),
            },
          }),
          keymap({
            Enter: () => (submit.current(), true),
            "Shift-Enter": (state, dispatch) => {
              dispatch?.(state.tr.replaceSelectionWith(promptSchema.nodes.hard_break!.create()).scrollIntoView());
              return true;
            },
            "Mod-z": undo,
            "Mod-Shift-z": redo,
            "Mod-y": redo,
          }),
          keymap(baseKeymap),
          emptyClass,
        ],
      }),
      nodeViews: { chip: (node) => new ChipView(node) },
      // Pasted files (a copied picture) are attached, as in Pen. Other pasted content arrives as plain
      // text; line breaks become Shift+Enter breaks.
      handlePaste(v, event) {
        const pasted = [...(event.clipboardData?.files ?? [])];
        if (pasted.length && files.current) {
          files.current(pasted);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        const { tr } = v.state;
        tr.deleteSelection();
        text.split(/\r?\n/).forEach((line, i) => {
          if (i > 0) tr.insert(tr.selection.from, promptSchema.nodes.hard_break!.create());
          if (line) tr.insertText(line);
        });
        v.dispatch(tr.scrollIntoView());
        return true;
      },
      dispatchTransaction(tr) {
        v.updateState(v.state.apply(tr));
        if (tr.docChanged) change.current(!promptText(v.state.doc).isEmpty);
        const s = v.hasFocus() || tr.docChanged ? slashAt(v.state) : null;
        const key = s ? `${s.from}:${s.query}` : "";
        if (key !== lastSlash.current) {
          lastSlash.current = key;
          slash.current?.(s);
        }
      },
      attributes: { spellcheck: "true", "aria-label": "Prompt", "data-placeholder": placeholder },
    });
    view.current = v;
    return () => v.destroy();
  }, []);

  // Rules 2–4 (prompt-doc.ts): the selection chip follows the canvas selection.
  const selectionKey = selection ? `${selection.id}|${selection.name}` : "";
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const tr = followSelection(v.state, selection, v.hasFocus());
    if (tr) v.dispatch(tr);
  }, [selectionKey]);

  useImperativeHandle(ref, () => ({
    read: () => promptText(view.current!.state.doc),
    clear() {
      const v = view.current!;
      v.dispatch(v.state.tr.delete(1, v.state.doc.content.size - 1));
    },
    focus: () => view.current?.focus(),
    type(text) {
      const v = view.current!;
      const tr = v.hasFocus() ? v.state.tr : v.state.tr.setSelection(TextSelection.atEnd(v.state.doc));
      v.focus();
      v.dispatch(tr.insertText(text).scrollIntoView());
    },
    insertChip(chip, range) {
      const v = view.current!;
      const { from, to } = range ?? v.state.selection;
      const tr = v.state.tr.replaceWith(from, to, [promptSchema.nodes.chip!.create({ ...chip }), promptSchema.text(" ")]);
      tr.setSelection(TextSelection.create(tr.doc, from + 2));
      v.focus();
      v.dispatch(tr.scrollIntoView());
    },
  }));

  return <div ref={host} className={`prompt-editor min-w-0 flex-1${large ? " large" : ""}`} />;
});
