// The chat input island under the left panel: selection chip, prompt box and footer controls.
import { useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ArrowUp, ChevronDown, Frame, LayoutGrid, Plus, Search, Square, Zap } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { bridge, currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuLabel } from "../ui/menu.js";
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
        <span className="mb-1 inline-flex h-6 max-w-[200px] items-center gap-1 self-start rounded-md bg-white/5 px-2 text-[12px] text-[#d4d4d8]">
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
        className="w-full resize-none bg-transparent text-[13px] leading-5 text-[#e4e4e7] outline-none placeholder:text-[#71717a]"
      />
      <div className="mt-auto flex h-6 items-center text-[11px] text-muted-foreground">
        <button type="button" aria-label="Add to context" className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/5">
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
          <MenuContent side="top" align="end" className="w-[240px]">
            <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-muted-foreground">
              <Search size={14} strokeWidth={1.5} /> Search models...
            </div>
            <MenuLabel>Anthropic</MenuLabel>
            {MODELS.map((m) => (
              <MenuItem key={m.id} label={m.label} checked={m.id === model} onSelect={() => store.set({ model: m.id })} />
            ))}
          </MenuContent>
        </M.Root>
        <button
          type="button"
          aria-label={status ? "Stop" : "Send"}
          onClick={() => (status ? void bridge.stopAgent() : send())}
          disabled={!status && !text.trim()}
          className="ml-[10px] flex h-5 w-5 items-center justify-center rounded-full bg-[#e4e4e7] text-[#18181b] disabled:bg-[#3f3f46]"
          data-running={!!status}
        >
          {status ? <Square size={10} fill="currentColor" strokeWidth={0} /> : <ArrowUp size={12} strokeWidth={2.25} />}
        </button>
      </div>
    </Island>
  );
}
