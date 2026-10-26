// Shared picker for the Dashboard and editor: static Claude choices plus a live Codex catalog.
import { useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ChevronDown, ChevronRight, Image as ImageIcon, Plus, Search } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { store, useEditor } from "../store.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator, SubMenu } from "../ui/menu.js";
import { refreshCodexModels } from "./model-catalog.js";

export function ModelPicker() {
  const model = useEditor((s) => s.model);
  const models = useEditor((s) => s.codexModels);
  return (
    <M.Root onOpenChange={(open) => { if (open) void refreshCodexModels(); }}>
      <M.Trigger asChild>
        <button type="button" aria-label={`Model: ${modelLabel(model, models)}`} className="ml-[7px] flex min-w-0 items-center gap-1 rounded-md hover:text-foreground">
          <span className="max-w-[180px] truncate">{modelLabel(model, models)}</span> <ChevronDown size={12} strokeWidth={1.5} />
        </button>
      </M.Trigger>
      <ModelMenu model={model} />
    </M.Root>
  );
}

/** Catalog refresh never hides cached models or the configured-default fallback. */
function ModelMenu({ model }: { model: string }) {
  const [query, setQuery] = useState("");
  const models = useEditor((s) => s.codexModels);
  const state = useEditor((s) => s.codexModelsState);
  const error = useEditor((s) => s.codexModelsError);
  const effort = useEditor((s) => s.effort);
  const search = query.trim().toLowerCase();
  const matches = (m: { id: string; label: string }) => `${m.label} ${m.id}`.toLowerCase().includes(search);
  const claude = MODELS.filter((m) => m.provider === "claude" && matches(m));
  const codex = [...MODELS.filter((m) => m.provider === "codex"), ...models].filter(matches);
  const selected = models.find((m) => m.id === model);
  return (
    <MenuContent side="top" align="end" sideOffset={8} className="w-[260px] max-w-[calc(100vw-24px)] text-[12px]">
      <div className="flex h-7 items-center gap-2 px-2 text-muted-foreground">
        <Search size={13} strokeWidth={1.5} />
        <input
          autoFocus
          aria-label="Search models"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search models..."
          className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <MenuSeparator />
      <div className="max-h-[min(320px,45vh)] overflow-y-auto">
        {claude.length > 0 && <>
          <MenuLabel>Anthropic</MenuLabel>
          {claude.map((m) => (
            <MenuItem key={m.id} label={m.label} current={m.id === model} onSelect={() => store.set({ model: m.id, effort: undefined })} />
          ))}
        </>}
        <MenuLabel>OpenAI</MenuLabel>
        {codex.map((m) => (
          <MenuItem
            key={m.id}
            label={<span className="block max-w-[210px] truncate">{m.label}</span>}
            current={m.id === model}
            onSelect={() => {
              const metadata = models.find((entry) => entry.id === m.id);
              store.set({ model: m.id, effort: metadata?.defaultEffort });
            }}
          />
        ))}
        {state === "loading" && <div role="status" className="px-2 py-1.5 text-muted-foreground">{models.length ? "Refreshing models…" : "Loading Codex models…"}</div>}
        {state === "ready" && models.length === 0 && <div role="status" className="px-2 py-1.5 whitespace-normal text-muted-foreground">No Codex models returned. Use Codex (default) or reopen to refresh.</div>}
        {state === "error" && <>
          <div role="status" className="px-2 py-1.5 whitespace-normal text-muted-foreground">{error}{models.length > 0 ? " Showing cached models." : " Codex (default) remains available."}</div>
          <M.Item
            className="cursor-default rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-input"
            onSelect={(e) => { e.preventDefault(); void refreshCodexModels(); }}
          >Retry model discovery</M.Item>
        </>}
        {state === "ready" && model.startsWith("codex:") && !selected && <div role="status" className="px-2 py-1.5 whitespace-normal text-muted-foreground">Selected model unavailable. Choose another model.</div>}
        {claude.length === 0 && codex.length === 0 && <MenuLabel>No matching models</MenuLabel>}
      </div>
      {/* Only the selected model's reported efforts can be chosen; default delegates back to Codex. */}
      {selected && selected.efforts.length > 0 && <>
        <MenuSeparator />
        <SubMenu label={`Reasoning effort: ${effort ?? "Default"}`}>
          <MenuItem label="Default" checked={effort === undefined} onSelect={() => store.set({ effort: undefined })} />
          {selected.efforts.map((e) => (
            <MenuItem key={e.id} label={<span title={e.description}>{e.id}</span>} checked={effort === e.id} onSelect={() => store.set({ effort: e.id })} />
          ))}
        </SubMenu>
      </>}
      <MenuSeparator />
      <MenuItem icon={<ImageIcon size={13} strokeWidth={1.5} />} label="Image model" hint={<>Not set <ChevronRight size={12} strokeWidth={1.5} /></>} disabled />
      <MenuItem icon={<Plus size={13} strokeWidth={1.5} />} label="Add more providers" />
    </MenuContent>
  );
}
