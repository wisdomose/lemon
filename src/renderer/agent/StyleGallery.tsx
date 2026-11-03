// "Choose a style" ("+" menu): a full-window gallery of looks to give the agent, laid out as Pen's (3 Nov
// 2026): a header with the gallery's tabs, a Landing page / Web App / Mobile App switch that stays at the
// top while the cards scroll, and cards of each style drawn in that view, named underneath. Picking a
// style puts its chip in the prompt; the agent reads the style in the chip's place (directions.ts).
// Pictures are made by Lemon's agent (scripts/style-previews.ts); a style without them yet shows its idea.
import { useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { AppWindow, Globe, Smartphone, X } from "lucide-react";
import { DIRECTIONS, type Direction } from "../../agent/directions.js";
import { DESIGN_SYSTEMS } from "../../agent/design-systems.js";
import { bridge } from "../bridge.js";
import { SCRIPTS, type LibraryScript } from "../../agent/script-library.js";
import { doc, edit } from "../scene.js";
import { pageInView } from "../canvas/canvas.js";
import * as docStore from "../../doc/store.js";
import { ROOT_ID } from "../../doc/schema.js";
import { store } from "../store.js";
import { cx } from "../ui/kit.js";

export type GalleryTab = "featured" | "styles" | "design-systems" | "scripts" | "shaders";
const TABS: { id: GalleryTab; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "styles", label: "Styles" },
  { id: "design-systems", label: "Design Systems" },
  { id: "scripts", label: "Scripts" },
  { id: "shaders", label: "Shaders" },
];

type View = "landing" | "web" | "mobile";
const VIEWS: { id: View; label: string; icon: typeof Globe }[] = [
  { id: "landing", label: "Landing page", icon: Globe },
  { id: "web", label: "Web App", icon: AppWindow },
  { id: "mobile", label: "Mobile App", icon: Smartphone },
];
/** Cards per row and card width in each view (Pen's, measured); pictures are the frames' own shape, landing pages cut to 9:16. */
const GRID: Record<View, { columns: number; width: number; aspect: string }> = {
  landing: { columns: 3, width: 489, aspect: "9 / 16" },
  web: { columns: 2, width: 651, aspect: "1440 / 900" },
  mobile: { columns: 3, width: 290, aspect: "390 / 844" },
};

const PICTURES = import.meta.glob<string>("./styles/*.webp", { eager: true, query: "?url", import: "default" });
const SYSTEM_PICTURES = import.meta.glob<string>("./design-systems/*.webp", { eager: true, query: "?url", import: "default" });
const SCRIPT_PICTURES = import.meta.glob<string>("./scripts/*.webp", { eager: true, query: "?url", import: "default" });
/** The design systems whose files and pictures are there. */
const SYSTEMS = DESIGN_SYSTEMS.filter((s) => SYSTEM_PICTURES[`./design-systems/${s.id}.webp`]);
const picture = (d: Direction, view: View): string | undefined => PICTURES[`./styles/${d.id}-${view}.webp`];

/** Styles with pictures first (they show what they are), each group in the library's order. */
const ORDERED = [...DIRECTIONS.filter((d) => picture(d, "landing")), ...DIRECTIONS.filter((d) => !picture(d, "landing"))];

export function StyleGallery({
  open,
  onOpenChange,
  onStyle,
  focusPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStyle: (style: Direction) => void;
  focusPrompt: () => void;
}) {
  const [tab, setTab] = useState<GalleryTab>("styles");
  const [view, setView] = useState<View>("landing");
  const pick = (d: Direction) => {
    onOpenChange(false);
    onStyle(d);
  };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusPrompt();
          }}
          className="fixed inset-x-4 top-[66px] bottom-[60px] z-50 flex flex-col overflow-hidden rounded-[12px] border border-border bg-background text-foreground outline-none"
        >
          <div className="relative flex h-[57px] shrink-0 items-center border-b border-border px-4">
            <D.Title className="text-[17px] font-semibold">Choose a style</D.Title>
            <D.Description className="sr-only">Looks, design systems, scripts and shaders to give the agent.</D.Description>
            <Segmented className="absolute left-1/2 -translate-x-1/2" items={TABS} value={tab} onChange={setTab} />
            <D.Close aria-label="Close" className="ml-auto rounded-sm text-muted-foreground hover:text-foreground">
              <X size={16} strokeWidth={1.5} />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "featured" && <Featured onStyle={pick} onTab={setTab} onDone={() => onOpenChange(false)} />}
            {tab === "styles" && (
              <>
                <div className="sticky top-3 z-10 mt-[50px] flex justify-center">
                  <Segmented items={VIEWS} value={view} onChange={setView} />
                </div>
                <StyleGrid view={view} onStyle={pick} />
              </>
            )}
            {tab === "design-systems" && <DesignSystems onOpened={() => onOpenChange(false)} />}
            {tab === "scripts" && <Scripts onInserted={() => onOpenChange(false)} />}
            {tab === "shaders" && <Coming tab={tab} />}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Pen's pill switch: the chosen item filled, the rest plain. */
function Segmented<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: { id: T; label: string; icon?: typeof Globe }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx("flex h-[38px] items-center gap-0.5 rounded-[10px] bg-island p-1 shadow-island", className)}>
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={id === value}
          onClick={() => onChange(id)}
          className={cx(
            "flex h-[30px] items-center gap-2 rounded-[7px] px-3 text-[13px]",
            id === value ? "bg-input text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {Icon && <Icon size={15} strokeWidth={1.5} />}
          {label}
        </button>
      ))}
    </div>
  );
}

function StyleGrid({ view, onStyle }: { view: View; onStyle: (d: Direction) => void }) {
  const grid = GRID[view];
  return (
    <div
      className="mx-auto grid gap-x-[72px] gap-y-[56px] px-8 pt-[40px] pb-16"
      style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, ${grid.width}px))`, justifyContent: "center" }}
    >
      {ORDERED.map((d) => (
        <StyleCard key={d.id} style={d} view={view} aspect={grid.aspect} onStyle={onStyle} />
      ))}
    </div>
  );
}

function StyleCard({ style, view, aspect, onStyle }: { style: Direction; view: View; aspect: string; onStyle: (d: Direction) => void }) {
  const src = picture(style, view);
  return (
    <div className="flex flex-col items-center">
      <CopyToAgent onClick={() => onStyle(style)} label={`Use ${style.name}`}>
        <div className="w-full overflow-hidden rounded-[6px] bg-input" style={{ aspectRatio: aspect }}>
          {src ? (
            <img src={src} alt="" draggable={false} className="h-full w-full object-cover object-top" />
          ) : (
            // Until its pictures are made: the style's idea, as its card.
            <div className="flex h-full flex-col gap-2 p-5 text-left">
              <div className="text-[20px] leading-6 font-semibold text-foreground">{style.name}</div>
              <div className="text-[12px] leading-[17px] text-muted-foreground">{style.idea}</div>
            </div>
          )}
        </div>
      </CopyToAgent>
      <div className="mt-[14px] flex items-center gap-2 text-[13px] font-semibold">
        {style.name}
        <Badge>.md</Badge>
      </div>
    </div>
  );
}

/**
 * Design systems, five to a row as in Pen: a picture of each one's example screen, its name and ".pen".
 * Opening one opens a copy as a new draft.
 */
function DesignSystems({ onOpened }: { onOpened: () => void }) {
  return (
    <div className="grid grid-cols-5 gap-x-[24px] gap-y-[28px] px-[96px] pt-[10px] pb-16">
      {SYSTEMS.map((s) => (
        <div key={s.id}>
          <CopyToAgent
            hint="Open Document"
            label={`Open ${s.name}`}
            onClick={() => void bridge.openDesignSystem(s.id).then((ok) => ok && onOpened())}
          >
            <img src={SYSTEM_PICTURES[`./design-systems/${s.id}.webp`]} alt="" draggable={false} className="aspect-[5/3] w-full rounded-[6px] object-cover object-left-top" />
          </CopyToAgent>
          <div className="mt-[10px] flex items-center justify-between text-[13px] font-semibold">
            {s.name}
            <Badge>.pen</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Puts a library script on the canvas as Pen does: its file goes beside this one (scripts/<id>.js) and a
 * script node of the script's size, named after it, lands selected in the middle of the view.
 */
async function insertScript(script: LibraryScript): Promise<boolean> {
  const placed = await bridge.placeScript(script.id);
  if ("error" in placed) {
    window.alert(placed.error);
    return false;
  }
  const v = pageInView();
  let id = "";
  edit(() => {
    id = docStore.insert(doc, ROOT_ID, {
      type: "script",
      name: script.name,
      scriptUri: placed.uri,
      x: Math.round(v.x + v.w / 2 - script.width / 2),
      y: Math.round(v.y + v.h / 2 - script.height / 2),
      width: script.width,
      height: script.height,
    });
  });
  store.set({ selection: [id], tool: "move" });
  return true;
}

/** Scripts, four to a row as in Pen: what each draws, its name and ".js". */
function Scripts({ onInserted }: { onInserted: () => void }) {
  return (
    <div className="grid grid-cols-4 gap-x-[24px] gap-y-[28px] px-[108px] pt-[10px] pb-16">
      {SCRIPTS.map((s) => (
        <div key={s.id}>
          <CopyToAgent hint="Insert to Canvas" label={`Insert ${s.name}`} onClick={() => void insertScript(s).then((ok) => ok && onInserted())}>
            <img src={SCRIPT_PICTURES[`./scripts/${s.id}.webp`]} alt="" draggable={false} className="aspect-[5/3] w-full rounded-[6px] bg-white object-cover" />
          </CopyToAgent>
          <div className="mt-[10px] flex items-center justify-between text-[13px] font-semibold">
            {s.name}
            <Badge>.js</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-muted-foreground/60 px-1.5 text-[10px] leading-[15px] font-semibold text-muted-foreground">{children}</span>;
}

/**
 * A card that does its thing when clicked: outlined blue while hovered, with what it does by the pointer
 * (Pen's "Copy to Agent" for styles, "Open Document" for design systems).
 */
function CopyToAgent({ children, onClick, label, hint = "Copy to Agent" }: { children: ReactNode; onClick: () => void; label: string; hint?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setAt(null)}
      className="relative block w-full rounded-[7px] outline-none ring-[#3b82f6] hover:ring-2 focus-visible:ring-2"
    >
      {children}
      {at && (
        <span
          className="pointer-events-none absolute rounded-[5px] bg-[#27272a]/90 px-2 py-[3px] text-[11px] whitespace-nowrap text-white"
          style={{ left: at.x + 14, top: at.y + 14 }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

/** Pen's Featured tab: a row of each kind (its heading opens the kind's tab), each card doing what it does there. */
function Featured({ onStyle, onTab, onDone }: { onStyle: (d: Direction) => void; onTab: (t: GalleryTab) => void; onDone: () => void }) {
  const row = (tab: GalleryTab, cards: ReactNode) => (
    <section className="mb-7">
      <button type="button" onClick={() => onTab(tab)} className="mb-3 text-[13px] font-semibold text-foreground hover:underline">
        {TABS.find((t) => t.id === tab)!.label}
      </button>
      <div className="flex gap-3 overflow-x-auto pb-2">{cards}</div>
    </section>
  );
  return (
    <div className="px-4 pt-5 pb-10">
      {row(
        "styles",
        ORDERED.filter((d) => picture(d, "landing")).map((d) => (
          <div key={d.id} className="w-[165px] shrink-0">
            <CopyToAgent onClick={() => onStyle(d)} label={`Use ${d.name}`}>
              <img src={picture(d, "landing")} alt="" draggable={false} className="aspect-[9/16] w-full rounded-[6px] object-cover object-top" />
            </CopyToAgent>
          </div>
        )),
      )}
      {row(
        "scripts",
        SCRIPTS.map((s) => (
          <div key={s.id} className="w-[200px] shrink-0">
            <CopyToAgent hint="Insert to Canvas" label={`Insert ${s.name}`} onClick={() => void insertScript(s).then((ok) => ok && onDone())}>
              <img src={SCRIPT_PICTURES[`./scripts/${s.id}.webp`]} alt="" draggable={false} className="aspect-[5/3] w-full rounded-[6px] bg-white object-cover" />
            </CopyToAgent>
            <div className="mt-1.5 text-[12px] text-muted-foreground">{s.name}</div>
          </div>
        )),
      )}
      {SYSTEMS.length > 0 &&
        row(
          "design-systems",
          SYSTEMS.map((s) => (
            <div key={s.id} className="w-[260px] shrink-0">
              <CopyToAgent hint="Open Document" label={`Open ${s.name}`} onClick={() => void bridge.openDesignSystem(s.id).then((ok) => ok && onDone())}>
                <img src={SYSTEM_PICTURES[`./design-systems/${s.id}.webp`]} alt="" draggable={false} className="aspect-[5/3] w-full rounded-[6px] object-cover object-left-top" />
              </CopyToAgent>
              <div className="mt-1.5 text-[12px] text-muted-foreground">{s.name}</div>
            </div>
          )),
        )}
    </div>
  );
}

function Coming({ tab }: { tab: GalleryTab }) {
  return <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">{TABS.find((t) => t.id === tab)!.label} are on their way.</div>;
}
