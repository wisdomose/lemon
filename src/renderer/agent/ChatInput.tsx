// The chat input island under the left panel: selection chip, prompt box and footer controls.
import { useRef, useState } from "react";
import { ParallelAgents, Variants } from "./RunOptions.js";
import { DropdownMenu as M } from "radix-ui";
import { ArrowUp, ChevronDown, ChevronRight, Frame, Image as ImageIcon, Plus, Search, Square } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { bridge, currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";
import { findNode } from "../../render/screenshot.js";
import { sendPrompt } from "./chat.js";

export function ChatInput() {
  const [text, setText] = useState("");
  const footer = useRef<HTMLDivElement>(null);
  const status = useEditor((s) => s.agentStatus);
  const model = useEditor((s) => s.model);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const node = selection ? findNode(currentScene()?.tree ?? { id: "", type: "frame", props: {}, children: [] }, selection) : undefined;
  const nodeName = node ? (node.props.name ?? node.type) : undefined;
  // With something selected the prompt can be empty: the agent is asked about the selection.
  const canSend = !!text.trim() || !!nodeName;
  const send = () => {
    if (!canSend) return;
    const prompt = text.trim() || "Improve the selected design.";
    sendPrompt(prompt, nodeName ? `<selection>The person has selected "${nodeName}" (id ${node!.id}).</selection>` : undefined);
    setText("");
  };
  return (
    <Island className="flex max-h-[calc(50%-4px)] min-h-[91px] shrink-0 flex-col pt-[14px] pb-2 pl-3 pr-[11px]">
      {/* The selection sits inline at the start of the prompt, as in the reference: the box keeps its
          height and the placeholder goes away. */}
      <div className="mb-1 flex min-h-0 flex-1 flex-wrap content-start items-start gap-x-1.5 overflow-y-auto">
        {node && (
          <span className="mt-[1px] ml-1 inline-flex h-[21px] max-w-[200px] shrink-0 items-center gap-[3px] rounded-[4px] border border-input px-[5px] text-[10px] text-muted-foreground">
            <Frame size={11} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">{node.props.name ?? node.type}</span>
          </span>
        )}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Typing (or pasting) at the end keeps the end in view, as in the reference.
            const t = e.target;
            if (t.selectionEnd === t.value.length) requestAnimationFrame(() => t.parentElement?.scrollTo({ top: t.parentElement.scrollHeight }));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={node ? "" : "Design anything..."}
          // Grows with its text (CSS field-sizing); past the box's maximum the area around it scrolls.
          style={{ fieldSizing: "content" } as React.CSSProperties}
          className="min-h-10 min-w-[120px] flex-1 resize-none overflow-hidden bg-transparent text-[13px] leading-[1.5] text-foreground outline-none placeholder:text-[#71717a]"
        />
      </div>
      <div ref={footer} className="mt-auto flex h-6 items-center text-[11px] text-muted-foreground">
        <button type="button" aria-label="Add to context" className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/5">
          <Plus size={14} strokeWidth={1.5} />
        </button>
        <ParallelAgents anchor={footer} />
        <Variants anchor={footer} />
        <M.Root>
          <M.Trigger asChild>
            <button type="button" className="ml-[7px] flex items-center gap-1 rounded-md hover:text-foreground">
              {modelLabel(model)} <ChevronDown size={12} strokeWidth={1.5} />
            </button>
          </M.Trigger>
          <ModelMenu model={model} />
        </M.Root>
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

/** The model picker: search, models grouped by provider, then image model and providers. */
function ModelMenu({ model }: { model: string }) {
  const [query, setQuery] = useState("");
  const shown = MODELS.filter((m) => m.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <MenuContent side="top" align="end" sideOffset={8} className="w-[228px] text-[12px]">
      <div className="flex h-7 items-center gap-2 px-2 text-muted-foreground">
        <Search size={13} strokeWidth={1.5} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search models..."
          className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <MenuSeparator />
      <MenuLabel>Anthropic</MenuLabel>
      {shown.map((m) => (
        <MenuItem
          key={m.id}
          label={<span className="font-medium">{m.label}</span>}
          current={m.id === model}
          onSelect={() => store.set({ model: m.id })}
        />
      ))}
      <MenuSeparator />
      <MenuItem
        icon={<ImageIcon size={13} strokeWidth={1.5} />}
        label="Image model"
        hint={<>Not set <ChevronRight size={12} strokeWidth={1.5} /></>}
        disabled
      />
      <MenuItem icon={<Plus size={13} strokeWidth={1.5} />} label="Add more providers" />
    </MenuContent>
  );
}
