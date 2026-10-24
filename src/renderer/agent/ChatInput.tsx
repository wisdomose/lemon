// The chat input island under the left panel: selection chip, prompt box and footer controls.
import { useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ArrowUp, ChevronDown, ChevronRight, Frame, Image as ImageIcon, LayoutGrid, Plus, Search, Square, Zap } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { bridge, currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";
import { findNode } from "../../render/screenshot.js";
import { sendPrompt } from "./chat.js";

export function ChatInput() {
  const [text, setText] = useState("");
  const status = useEditor((s) => s.agentStatus);
  const model = useEditor((s) => s.model);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const node = selection ? findNode(currentScene()?.tree ?? { id: "", type: "frame", props: {}, children: [] }, selection) : undefined;
  const send = () => {
    sendPrompt(text);
    setText("");
  };
  return (
    <Island className="absolute left-2 bottom-2 flex min-h-[91px] w-[378px] flex-col px-3 pt-[14px] pb-2">
      {node && (
        <span className="mb-1 inline-flex h-6 max-w-[200px] items-center gap-1 self-start rounded-md bg-foreground/5 px-2 text-[12px] text-foreground">
          <Frame size={12} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">{node.props.name ?? node.type}</span>
        </span>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={2}
        placeholder="Design anything..."
        className="w-full resize-none bg-transparent text-[13px] leading-5 text-foreground outline-none placeholder:text-[#71717a]"
      />
      <div className="mt-auto flex h-6 items-center text-[11px] text-muted-foreground">
        <button type="button" aria-label="Add to context" className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/5">
          <Plus size={14} strokeWidth={1.5} />
        </button>
        <span className="ml-auto flex items-center gap-[3px] font-semibold text-amber-500">
          <Zap size={12} strokeWidth={1.75} /> 1x
        </span>
        <span className="ml-[14px] flex items-center gap-[3px]">
          <LayoutGrid size={12} strokeWidth={1.5} /> 1x
        </span>
        <M.Root>
          <M.Trigger asChild>
            <button type="button" className="ml-[11px] flex items-center gap-1 rounded-md hover:text-foreground">
              {modelLabel(model)} <ChevronDown size={12} strokeWidth={1.5} />
            </button>
          </M.Trigger>
          <ModelMenu model={model} />
        </M.Root>
        <button
          type="button"
          aria-label={status ? "Stop" : "Send"}
          onClick={() => (status ? void bridge.stopAgent() : send())}
          disabled={!status && !text.trim()}
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
