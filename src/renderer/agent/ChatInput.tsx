// The chat input island under the left panel: the prompt (with canvas references) and footer controls.
import { useRef, useState } from "react";
import { PromptEditor, type PromptEditorHandle } from "./PromptEditor.js";
import { ParallelAgents, Variants } from "./RunOptions.js";
import { ArrowUp, Plus, Square } from "lucide-react";
import { ModelPicker } from "./ModelPicker.js";
import { bridge, currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { findNode } from "../../render/screenshot.js";
import type { TreeNode } from "../../doc/schema.js";
import type { ChipRef } from "./prompt-doc.js";
import { sendPrompt } from "./chat.js";

export function ChatInput() {
  const footer = useRef<HTMLDivElement>(null);
  const status = useEditor((s) => s.agentStatus);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const tree = currentScene()?.tree;
  const nodes = tree ? selection.map((id) => findNode(tree, id)).filter((n) => !!n) : [];
  const one = (n: TreeNode) => ({ id: n.id, name: n.props.name ?? n.type[0]!.toUpperCase() + n.type.slice(1), kind: n.type });
  // Several selected nodes share one chip, "3 nodes", as in the reference.
  const ref: ChipRef | null =
    nodes.length > 1 ? { id: nodes.map((n) => n.id).join(","), name: `${nodes.length} nodes`, kind: "nodes", members: nodes.map(one) } : nodes[0] ? one(nodes[0]) : null;
  const editor = useRef<PromptEditorHandle>(null);
  const [canSend, setCanSend] = useState(false);
  const send = () => {
    const p = editor.current?.read();
    if (!p || p.isEmpty) return;
    // A prompt of references only asks the agent to work on them.
    const forAgent = p.hasText ? p.forAgent : `${p.forAgent}\nImprove this.`;
    sendPrompt(p.shown, forAgent);
    editor.current!.clear();
  };
  return (
    <Island className="flex max-h-[calc(50%-4px)] min-h-[91px] shrink-0 flex-col pt-[14px] pb-2 pl-3 pr-[11px]">
      {/* The prompt, with canvas references inline (PromptEditor). Grows with its text up to the box's
          maximum, then scrolls. */}
      <div className="mb-1 flex min-h-0 flex-1 overflow-y-auto">
        <PromptEditor ref={editor} selection={ref} placeholder="Design anything..." onSubmit={send} onChange={setCanSend} />
      </div>
      <div ref={footer} className="mt-auto flex h-6 items-center text-[11px] text-muted-foreground">
        <button type="button" aria-label="Add to context" className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/5">
          <Plus size={14} strokeWidth={1.5} />
        </button>
        <ParallelAgents anchor={footer} />
        <Variants anchor={footer} />
        <ModelPicker />
        <button
          type="button"
          aria-label={status ? "Stop" : "Send"}
          onClick={() => (status ? void bridge.stopAgent() : send())}
          disabled={!status && !canSend}
          className="ml-[10px] flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background disabled:bg-send-off disabled:text-send-off-icon data-[running=true]:bg-send-off data-[running=true]:text-foreground"
          data-running={!!status}
        >
          {status ? <Square size={9} strokeWidth={2} /> : <ArrowUp size={12} strokeWidth={2.25} />}
        </button>
      </div>
    </Island>
  );
}
