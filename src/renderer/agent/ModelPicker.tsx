// The prompt footer's model picker (chat input and Dashboard): the current model, opening a menu with
// search, models grouped by provider, then image model and providers.
import { useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ChevronDown, ChevronRight, Image as ImageIcon, Plus, Search } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { store, useEditor } from "../store.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";

export function ModelPicker() {
  const model = useEditor((s) => s.model);
  return (
    <M.Root>
      <M.Trigger asChild>
        <button type="button" className="ml-[7px] flex items-center gap-1 rounded-md hover:text-foreground">
          {modelLabel(model)} <ChevronDown size={12} strokeWidth={1.5} />
        </button>
      </M.Trigger>
      <ModelMenu model={model} />
    </M.Root>
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
