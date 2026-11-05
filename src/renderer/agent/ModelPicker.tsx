// Shared picker for the Dashboard and editor: static Claude choices, a live Codex catalog, and the
// models of every AI provider a person has connected. As Pen's (4 Nov 2026): rows highlight grey; a
// built-in provider without its key shows its models greyed at the end, each offering "Setup" while
// hovered; a model's row picks it at its default effort, and one that takes a reasoning effort opens
// its levels from a chevron on the row. At most 587px tall, the list scrolling between the search and
// the footer.
import { Fragment, useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { ChevronDown, ChevronRight, Image as ImageIcon, Plus, Search } from "lucide-react";
import { MODELS, modelLabel } from "../../agent/models.js";
import { providerModelId } from "../../agent/providers.js";
import { store, useEditor } from "../store.js";
import { MENU_PANEL as PANEL, MENU_ROW_SUBTLE as ROW, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTone } from "../ui/menu.js";
import { FOOTER_BUTTON, cx } from "../ui/kit.js";
import { effortChoices, refreshCodexModels, refreshProviders } from "./model-catalog.js";

export function ModelPicker() {
  const model = useEditor((s) => s.model);
  const models = useEditor((s) => s.codexModels);
  const providers = useEditor((s) => s.providers);
  const label = modelLabel(model, models, providers);
  return (
    <M.Root onOpenChange={(open) => { if (open) { void refreshCodexModels(); void refreshProviders(); } }}>
      <M.Trigger asChild>
        {/* Pen's: no tooltip; its name brightens a little while hovered. */}
        <button
          type="button"
          aria-label={`Model: ${label}`}
          className={cx(FOOTER_BUTTON, "ml-[3px] flex h-6 min-w-0 items-center gap-1 rounded-[7px] px-1 hover:text-[#9b9ca0]")}
        >
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
  const ready = providerGroups.filter((g) => !g.locked);
  const notSetUp = providerGroups.filter((g) => g.locked);
  return (
    <MenuContent side="top" align="end" sideOffset={8} className="flex max-h-[min(587px,var(--radix-dropdown-menu-content-available-height))] w-[237px] max-w-[calc(100vw-24px)] flex-col text-[12px]">
      {/* Keep subtle highlights through portaled effort menus. */}
      <MenuTone.Provider value="subtle">
        <div className="flex h-7 shrink-0 items-center gap-2 px-2 text-muted-foreground">
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
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
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
                className="cursor-default rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-nav-active"
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
          {ready.map((g) => (
            <Fragment key={g.id}>
              <MenuSeparator />
              <MenuLabel>{g.name}</MenuLabel>
              {g.models.map((m) => {
                const id = providerModelId(g.id, m.id);
                return <ModelRow key={id} id={id} label={m.label ?? m.id} model={model} />;
              })}
            </Fragment>
          ))}
          {/* Providers without their key: their models greyed, together at the end; "Setup" takes you there. */}
          {notSetUp.length > 0 && <MenuSeparator />}
          {notSetUp.flatMap((g) =>
            g.models.map((m) => (
              <M.Item
                key={providerModelId(g.id, m.id)}
                className={cx(ROW, "group data-[highlighted]:!bg-nav-active")}
                onSelect={() => store.set({ settingsOpen: true, settingsPage: { page: "agents", provider: g.id } })}
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground/60">{m.label ?? m.id}</span>
                <span className="hidden text-[11px] text-foreground group-data-[highlighted]:inline">Setup</span>
              </M.Item>
            )),
          )}
          {claude.length === 0 && codex.length === 0 && providerGroups.length === 0 && <MenuLabel>No matching models</MenuLabel>}
        </div>
        {/* The footer keeps its height; the list above gives way. */}
        <div className="shrink-0">
          <MenuSeparator />
          <MenuItem grey icon={<ImageIcon size={13} strokeWidth={1.5} />} label="Image model" hint={<>Not set <ChevronRight size={12} strokeWidth={1.5} /></>} disabled />
          <MenuItem
            grey
            icon={<Plus size={13} strokeWidth={1.5} />}
            label="Add more providers"
            onSelect={() => store.set({ settingsOpen: true, settingsPage: { page: "agents" } })}
          />
        </div>
      </MenuTone.Provider>
    </MenuContent>
  );
}

/** Effort names as people read them, as in Pen ("xhigh" → "Very high"). */
const effortLabel = (id: string) => (id === "xhigh" ? "Very high" : id === "xlow" ? "Extra low" : id[0]!.toUpperCase() + id.slice(1));

/**
 * One model. Picking the row picks the model at its default effort. One that takes a reasoning
 * effort has its own chevron button, shown while the row is hovered or focused (Pen): hovering or
 * clicking it opens the levels, and picking a level picks the model with it. The level the next run
 * uses is filled in on the selected model: the chosen one, else the model's own default.
 */
function ModelRow({ id, label, model }: { id: string; label: string; model: string }) {
  const codexModels = useEditor((s) => s.codexModels);
  const providers = useEditor((s) => s.providers);
  const effort = useEditor((s) => s.effort);
  const [open, setOpen] = useState(false);
  const { levels, fallback } = effortChoices(id, codexModels, providers);
  const current = id === model;
  // The selected model's name is dimmer than the others' (Pen).
  const name = <span className={cx("block max-w-[180px] truncate", current && "text-muted-foreground group-data-[highlighted]:text-foreground")}>{label}</span>;
  const pick = () => store.set({ model: id, effort: undefined });
  if (!levels.length) return <MenuItem grey label={name} current={current} plain onSelect={pick} />;
  const shown = current ? (effort ?? fallback) : undefined;
  const descriptions = codexModels.find((m) => m.id === id)?.efforts;
  return (
    // The row lights up while either half is highlighted, or while its levels are open.
    <div
      className={cx(
        "group/row relative rounded-[6px]",
        current && "bg-input",
        "has-[[data-highlighted]]:bg-nav-active has-[[data-state=open]]:bg-nav-active",
      )}
    >
      <M.Item
        className={cx(ROW, "pr-8 data-[highlighted]:bg-transparent")}
        onSelect={pick}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1">{name}</span>
      </M.Item>
      <M.Sub open={open} onOpenChange={setOpen}>
        <M.SubTrigger
          aria-label={`${label} effort`}
          // Shown on the selected model and on a hovered one (Pen).
          className={cx(
            "absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-muted-foreground outline-none group-hover/row:opacity-100 group-has-[[data-highlighted]]/row:opacity-100 data-[highlighted]:bg-foreground/10 data-[highlighted]:text-foreground data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground data-[state=open]:opacity-100",
            current ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(true)}
        >
          <ChevronRight size={12} strokeWidth={1.5} />
        </M.SubTrigger>
        <M.Portal>
          <M.SubContent sideOffset={4} className={cx(PANEL, "min-w-[120px]")}>
            <MenuLabel>Effort</MenuLabel>
            {/* The level the next run uses keeps its selected fill while hovered. */}
            {levels.map((level) => (
              <MenuItem
                key={level}
                grey
                plain
                label={<span title={descriptions?.find((e) => e.id === level)?.description}>{effortLabel(level)}</span>}
                selected={shown === level}
                onSelect={() => store.set({ model: id, effort: level })}
              />
            ))}
          </M.SubContent>
        </M.Portal>
      </M.Sub>
    </div>
  );
}
