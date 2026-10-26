// Shared picker for the Dashboard and editor: static Claude choices plus a live Codex catalog.
import { useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ChevronDown, ChevronRight, Image as ImageIcon, Plus, Search } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { store, useEditor } from "../store.js";
import { MENU_PANEL as PANEL, MENU_ROW as ROW, MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";
import { cx } from "../ui/kit.js";
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

/** Effort names as people read them ("xhigh" → "Extra high"). */
const effortLabel = (id: string) => (id === "xhigh" ? "Extra high" : id === "xlow" ? "Extra low" : id[0]!.toUpperCase() + id.slice(1));

/**
 * The menu (Pen's capture 14): search, models grouped by provider, then image model and providers.
 * Codex's models come from Codex itself; until they have, "Codex (default)" lets Codex choose. A
 * selected model's options open from its own row, as in Pen (for Codex: the reasoning effort).
 */
function ModelMenu({ model }: { model: string }) {
  const [query, setQuery] = useState("");
  const models = useEditor((s) => s.codexModels);
  const state = useEditor((s) => s.codexModelsState);
  const error = useEditor((s) => s.codexModelsError);
  const effort = useEditor((s) => s.effort);
  const search = query.trim().toLowerCase();
  const matches = (m: { id: string; label: string }) => `${m.label} ${m.id}`.toLowerCase().includes(search);
  const claude = MODELS.filter((m) => m.provider === "claude" && matches(m));
  // The configured default is only offered while Codex's own list isn't there (it is one of them).
  const fallback = models.length ? [] : MODELS.filter((m) => m.provider === "codex");
  const codex = [...fallback, ...models].filter(matches);
  const selected = models.find((m) => m.id === model);
  return (
    <MenuContent side="top" align="end" sideOffset={8} className="w-[228px] max-w-[calc(100vw-24px)] text-[12px]">
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
      {/* Pen shows the whole list; it scrolls only when the window is too short for it. */}
      <div className="max-h-[calc(var(--radix-dropdown-menu-content-available-height)-120px)] overflow-x-hidden overflow-y-auto">
        {claude.length > 0 && (
          <>
            <MenuLabel>Anthropic</MenuLabel>
            {claude.map((m) => (
              <MenuItem key={m.id} label={<span className="font-medium">{m.label}</span>} current={m.id === model} onSelect={() => store.set({ model: m.id, effort: undefined })} />
            ))}
          </>
        )}
        {claude.length > 0 && codex.length > 0 && <MenuSeparator />}
        {codex.length > 0 && <MenuLabel>OpenAI</MenuLabel>}
        {codex.map((m) =>
          m.id === model && selected && selected.efforts.length > 0 ? (
            <M.Sub key={m.id}>
              <M.SubTrigger className={cx(ROW, "group bg-input")}>
                <span className="flex-1 truncate font-medium">{m.label}</span>
                <span className="text-muted-foreground group-data-[highlighted]:text-white/80 group-data-[state=open]:text-white/80">{effort ? effortLabel(effort) : ""}</span>
                <ChevronRight size={12} strokeWidth={1.5} className="text-muted-foreground group-data-[highlighted]:text-white/80" />
              </M.SubTrigger>
              <M.Portal>
                <M.SubContent sideOffset={4} className={PANEL}>
                  <MenuLabel>Reasoning effort</MenuLabel>
                  <MenuItem label="Default" checked={effort === undefined} onSelect={() => store.set({ effort: undefined })} />
                  {selected.efforts.map((e) => (
                    <MenuItem key={e.id} label={<span title={e.description}>{effortLabel(e.id)}</span>} checked={effort === e.id} onSelect={() => store.set({ effort: e.id })} />
                  ))}
                </M.SubContent>
              </M.Portal>
            </M.Sub>
          ) : (
            <MenuItem
              key={m.id}
              label={<span className="block max-w-[180px] truncate font-medium">{m.label}</span>}
              current={m.id === model}
              onSelect={() => store.set({ model: m.id, effort: models.find((entry) => entry.id === m.id)?.defaultEffort })}
            />
          ),
        )}
        {state === "loading" && !models.length && <div role="status" className="px-2 py-1.5 text-muted-foreground">Loading Codex models…</div>}
        {state === "error" && (
          <>
            <div role="status" className="px-2 py-1.5 whitespace-normal text-muted-foreground">
              {error}
            </div>
            <M.Item
              className="cursor-default rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-input"
              onSelect={(e) => {
                e.preventDefault();
                void refreshCodexModels(true);
              }}
            >
              Try again
            </M.Item>
          </>
        )}
        {state === "ready" && model.startsWith("codex:") && !selected && (
          <div role="status" className="px-2 py-1.5 whitespace-normal text-muted-foreground">The selected model isn't offered any more. Choose another.</div>
        )}
        {claude.length === 0 && codex.length === 0 && <MenuLabel>No matching models</MenuLabel>}
      </div>
      <MenuSeparator />
      <MenuItem icon={<ImageIcon size={13} strokeWidth={1.5} />} label="Image model" hint={<>Not set <ChevronRight size={12} strokeWidth={1.5} /></>} disabled />
      <MenuItem icon={<Plus size={13} strokeWidth={1.5} />} label="Add more providers" />
    </MenuContent>
  );
}
