// The chat input island under the left panel: the prompt (with canvas references) and footer controls.
import { useRef, useState } from "react";
import { PromptEditor, type PromptEditorHandle } from "./PromptEditor.js";
import { ParallelAgents, Variants } from "./RunOptions.js";
import { DropdownMenu as M } from "radix-ui";
import { ArrowUp, ChevronDown, ChevronRight, Image as ImageIcon, Plus, Search, Square } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { bridge, currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";
import { findNode } from "../../render/screenshot.js";
import { sendPrompt } from "./chat.js";

export function ChatInput() {
  const footer = useRef<HTMLDivElement>(null);
  const status = useEditor((s) => s.agentStatus);
  const model = useEditor((s) => s.model);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const node = selection ? findNode(currentScene()?.tree ?? { id: "", type: "frame", props: {}, children: [] }, selection) : undefined;
  const ref = node ? { id: node.id, name: node.props.name ?? node.type[0]!.toUpperCase() + node.type.slice(1), kind: node.type } : null;
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
