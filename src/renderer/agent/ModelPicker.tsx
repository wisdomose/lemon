// Shared picker for the Dashboard and editor: static Claude choices, a live Codex catalog, and the
// models of every AI provider a person has connected. A built-in without its key shows its models
// locked, with a row to go set it up. A model that takes a reasoning effort opens it from its row.
import { Fragment, useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ChevronDown, ChevronRight, Image as ImageIcon, Lock, Plus, Search } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { providerModelId } from "../../agent/providers.js";
import { store, useEditor } from "../store.js";
import { MENU_PANEL as PANEL, MENU_ROW as ROW, MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";
import { cx } from "../ui/kit.js";
import { effortChoices, refreshCodexModels, refreshProviders } from "./model-catalog.js";

export function ModelPicker() {
  const model = useEditor((s) => s.model);
  const models = useEditor((s) => s.codexModels);
  const providers = useEditor((s) => s.providers);
  const label = modelLabel(model, models, providers);
  return (
    <M.Root onOpenChange={(open) => { if (open) { void refreshCodexModels(); void refreshProviders(); } }}>
      <M.Trigger asChild>
        <button type="button" aria-label={`Model: ${label}`} className="ml-[7px] flex min-w-0 items-center gap-1 rounded-md hover:text-foreground">
          <span className="max-w-[180px] truncate">{label}</span> <ChevronDown size={12} strokeWidth={1.5} />
        </button>
      </M.Trigger>
      <ModelMenu model={model} />
    </M.Root>
  );
}

/**
 * The menu (Pen's capture 14): search, models grouped by provider, then image model and providers.
 * Codex's models come from Codex itself; until they have, "Codex (default)" lets Codex choose.
 */
function ModelMenu({ model }: { model: string }) {
  const [query, setQuery] = useState("");
  const models = useEditor((s) => s.codexModels);
  const state = useEditor((s) => s.codexModelsState);
  const error = useEditor((s) => s.codexModelsError);
  const providers = useEditor((s) => s.providers);
  const search = query.trim().toLowerCase();
  const matches = (m: { id: string; label: string }) => `${m.label} ${m.id}`.toLowerCase().includes(search);
  const claude = MODELS.filter((m) => m.provider === "claude" && matches(m));
  // The configured default is only offered while Codex's own list isn't there (it is one of them).
  const fallback = models.length ? [] : MODELS.filter((m) => m.provider === "codex");
  const codex = [...fallback, ...models].filter(matches);
  const selected = models.find((m) => m.id === model);
  // Each connected provider is its own group; a model runs under whichever provider offers it. A
  // built-in that needs its key (a custom provider's is optional) shows its models locked.
  const providerGroups = providers
    .filter((p) => p.models.length && `${p.name} ${p.models.map((m) => `${m.label ?? ""} ${m.id}`).join(" ")}`.toLowerCase().includes(search))
    .map((p) => ({ id: p.id, name: p.name, models: p.models, locked: !!p.builtIn && !p.keyMasked }));
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
              <ModelRow key={m.id} id={m.id} label={m.label} model={model} />
            ))}
          </>
        )}
        {claude.length > 0 && codex.length > 0 && <MenuSeparator />}
        {codex.length > 0 && <MenuLabel>OpenAI</MenuLabel>}
        {codex.map((m) => (
          <ModelRow key={m.id} id={m.id} label={m.label} model={model} />
        ))}
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
        {providerGroups.map((g) => (
          <Fragment key={g.id}>
            <MenuSeparator />
            <MenuLabel>{g.name}</MenuLabel>
            {g.models.map((m) => {
              const id = providerModelId(g.id, m.id);
              return g.locked ? (
                // Without its key the provider can't run: the row stays, but locked.
                <MenuItem
                  key={id}
                  disabled
                  label={<span className="block max-w-[180px] truncate font-medium">{m.label ?? m.id}</span>}
                  current={id === model}
                  plain
                  hint={<Lock size={12} strokeWidth={1.5} />}
                />
              ) : (
                <ModelRow key={id} id={id} label={m.label ?? m.id} model={model} />
              );
            })}
            {g.locked && (
              <MenuItem
                label={`Set up ${g.name} to use`}
                hint={<ChevronRight size={12} strokeWidth={1.5} />}
                onSelect={() => store.set({ settingsOpen: true, settingsPage: { page: "agents", provider: g.id } })}
              />
            )}
          </Fragment>
        ))}
        {claude.length === 0 && codex.length === 0 && providerGroups.length === 0 && <MenuLabel>No matching models</MenuLabel>}
      </div>
      <MenuSeparator />
      <MenuItem icon={<ImageIcon size={13} strokeWidth={1.5} />} label="Image model" hint={<>Not set <ChevronRight size={12} strokeWidth={1.5} /></>} disabled />
      <MenuItem
        icon={<Plus size={13} strokeWidth={1.5} />}
        label="Add more providers"
        onSelect={() => store.set({ settingsOpen: true, settingsPage: { page: "agents" } })}
      />
    </MenuContent>
  );
}

/** Effort names as people read them, as in Pen ("xhigh" → "Very high"). */
const effortLabel = (id: string) => (id === "xhigh" ? "Very high" : id === "xlow" ? "Extra low" : id[0]!.toUpperCase() + id.slice(1));

/**
 * One model. One that takes a reasoning effort opens its levels from its row (Pen); picking a level
 * picks the model with it. The level the next run uses is ticked on the selected model: the chosen
 * one, else the model's own default.
 */
function ModelRow({ id, label, model }: { id: string; label: string; model: string }) {
  const codexModels = useEditor((s) => s.codexModels);
  const providers = useEditor((s) => s.providers);
  const effort = useEditor((s) => s.effort);
  const { levels, fallback } = effortChoices(id, codexModels, providers);
  const current = id === model;
  const name = <span className="block max-w-[180px] truncate font-medium">{label}</span>;
  if (!levels.length) return <MenuItem label={name} current={current} plain onSelect={() => store.set({ model: id, effort: undefined })} />;
  const shown = current ? (effort ?? fallback) : undefined;
  const descriptions = codexModels.find((m) => m.id === id)?.efforts;
  return (
    <M.Sub>
      <M.SubTrigger className={cx(ROW, "group", current && "bg-input")}>
        <span className="min-w-0 flex-1">{name}</span>
        <ChevronRight size={12} strokeWidth={1.5} className="text-muted-foreground group-data-[highlighted]:text-white/80 group-data-[state=open]:text-white/80" />
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent sideOffset={4} className={cx(PANEL, "min-w-[120px]")}>
          <MenuLabel>Effort</MenuLabel>
          {levels.map((level) => (
            <MenuItem
              key={level}
              label={<span title={descriptions?.find((e) => e.id === level)?.description}>{effortLabel(level)}</span>}
              checked={shown === level}
              onSelect={() => store.set({ model: id, effort: level })}
            />
          ))}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  );
}
