// The prompt box: a small ProseMirror editor, so canvas references (chips) sit inline in the text as
// in the reference app. Enter sends, Shift+Enter breaks the line; pasted content arrives as plain text.
import "prosemirror-view/style/prosemirror.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Plugin } from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import { Circle, createElement, Frame, Image, Square, Type, type IconNode } from "lucide";
import { followSelection, promptSchema, promptText, type ChipRef } from "./prompt-doc.js";

const ICONS: Record<string, IconNode> = { frame: Frame, text: Type, rect: Square, ellipse: Circle, image: Image };

/** How a chip looks (measured from the reference: 21px tall, 1px border, 10px muted text). */
class ChipView implements NodeView {
  dom: HTMLElement;
  constructor(node: PMNode) {
    const el = document.createElement("span");
    el.className =
      "mx-px inline-flex h-[21px] max-w-[200px] items-center gap-[3px] rounded-[4px] border border-input px-[5px] align-[-5px] text-[10px] leading-none text-muted-foreground select-none";
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
}

export const PromptEditor = forwardRef<
  PromptEditorHandle,
  { selection: ChipRef | null; placeholder: string; onSubmit: () => void; onChange: (hasContent: boolean) => void }
>(function PromptEditor({ selection, placeholder, onSubmit, onChange }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks, read from inside ProseMirror's handlers.
  const submit = useRef(onSubmit);
  const change = useRef(onChange);
  submit.current = onSubmit;
  change.current = onChange;

  useEffect(() => {
    const v = new EditorView(host.current!, {
      state: EditorState.create({
        schema: promptSchema,
        plugins: [
          history(),
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
      // Pasted content arrives as plain text; line breaks become Shift+Enter breaks.
      handlePaste(v, event) {
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
  }));

  return <div ref={host} className="prompt-editor min-w-0 flex-1" />;
});
