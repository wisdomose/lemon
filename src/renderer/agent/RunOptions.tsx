// The prompt footer's run options: parallel agents (⚡) and "let it cook" variants (▦). Layout measured
// from the reference: a 300px popover over the chat box (⚡'s from its button), chips 44px wide.
// Parallel agents work (team.ts), and so do variants (agent.ts, "Let it cook").
import { useState, type ReactNode, type RefObject } from "react";
import { HoverCard as H, Popover as P } from "radix-ui";
import techLanding from "./styles/dark-tech-landing.webp";
import techWeb from "./styles/dark-tech-web.webp";
import techMobile from "./styles/dark-tech-mobile.webp";
import editorialWeb from "./styles/editorial-magazine-web.webp";
import brutalWeb from "./styles/neo-brutalism-web.webp";
import calmWeb from "./styles/scandi-calm-web.webp";
import { LayoutGrid, Zap } from "lucide-react";
import { FOOTER_BUTTON, Tip, cx } from "../ui/kit.js";
import { MAX_AGENTS } from "../../agent/models.js";
import { store, useEditor } from "../store.js";

const LABEL = "mb-[5px] pl-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase";

function Chip({ children, selected, disabled, onClick }: { children: ReactNode; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? "Not available yet" : undefined}
      className={cx(
        "flex h-[26px] min-w-[44px] items-center justify-center gap-1 rounded-[6px] px-2 text-[11px] font-semibold",
        selected
          ? "bg-amber-500/15 text-amber-500"
          : disabled
            ? "border border-dashed border-input text-muted-foreground/60"
            : "border border-input text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Card({ title, text, selected, onClick }: { title: string; text: string; selected?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={!selected && !onClick}
      onClick={onClick}
      className={cx(
        "flex h-[46px] flex-1 flex-col items-center justify-center rounded-[6px] border px-2 text-center",
        selected ? "border-transparent bg-input" : "border-input",
      )}
    >
      <span className="text-[11px] leading-[14px] font-semibold text-foreground">{title}</span>
      <span className="mt-px text-[10px] leading-[10px] text-muted-foreground">{text}</span>
    </button>
  );
}

function OptionPopover({
  anchor,
  trigger,
  children,
  className = "w-[300px] px-2 pt-[11px] pb-3",
  sideOffset = 1,
  fromTrigger,
  tip,
}: {
  /** Its button's tooltip (Pen's words). */
  tip: string;
  anchor: RefObject<HTMLDivElement | null>;
  /** Lined up with its button's left edge rather than the footer's (Pen's ⚡). */
  fromTrigger?: boolean;
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
  /** Width and padding. */
  className?: string;
  /** Gap below it, above the footer row. */
  sideOffset?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      {!fromTrigger && <P.Anchor virtualRef={anchor as RefObject<HTMLDivElement>} />}
      <Tip label={tip} side="top" hoverOnly>
        <P.Trigger asChild>{trigger(open)}</P.Trigger>
      </Tip>
      <P.Portal>
        <P.Content
          side="top"
          align="start"
          sideOffset={sideOffset}
          alignOffset={fromTrigger ? -4 : -20}
          avoidCollisions={false}
          className={cx("z-50 rounded-[10px] border border-border bg-popover shadow-island outline-none", className)}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export function ParallelAgents({ anchor }: { anchor: RefObject<HTMLDivElement | null> }) {
  const team = useEditor((s) => s.team);
  const set = (patch: Partial<typeof team>) => store.set((s) => ({ team: { ...s.team, ...patch } }));
  return (
    <OptionPopover
      anchor={anchor}
      fromTrigger
      tip="Set parallel agents"
      // Pen's button looks the same while its popover is open.
      trigger={() => (
        <button
          type="button"
          aria-label="Parallel agents"
          className={cx(FOOTER_BUTTON, "ml-auto flex h-6 items-center gap-[3px] rounded-[6px] px-1 font-semibold text-amber-500 hover:bg-amber-500/15")}
        >
          <Zap size={12} strokeWidth={1.75} /> {team.count}x
        </button>
      )}
    >
      <div className={LABEL}>Parallel agents</div>
      <div className="flex gap-1">
        {Array.from({ length: MAX_AGENTS }, (_, i) => i + 1).map((n) => (
          <Chip key={n} selected={team.count === n} onClick={() => set({ count: n })}>
            {n === 1 && <Zap size={11} strokeWidth={1.75} />}
            {n}x
          </Chip>
        ))}
      </div>
      <div className="mt-[13px] flex gap-1">
        <Card title="Split Work" text="Multiple agents work on different tasks" selected={team.mode === "split"} onClick={() => set({ mode: "split" })} />
        <Card title="Side by Side" text="Multiple agents work on the same task" selected={team.mode === "side"} onClick={() => set({ mode: "side" })} />
      </div>
      {team.count > 1 && <p className="mt-2 pl-1 text-[10px] text-muted-foreground">Each agent uses your subscription separately.</p>}
    </OptionPopover>
  );
}

/**
 * A choice in "Let it cook": filled grey when picked, outlined otherwise, and dimmed when it can't be
 * picked (the modes, while there are no variations) — Pen, 26 Oct and 2 Nov 2026 screenshots.
 */
function CookOption({ children, selected, disabled, onClick }: { children: ReactNode; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-8 items-center justify-center rounded-[8px] text-[12px]",
        selected ? "bg-input font-semibold text-foreground" : "border border-input text-muted-foreground",
        disabled && "cursor-not-allowed border-input/50 text-muted-foreground/50",
      )}
    >
      {children}
    </button>
  );
}

const COOK_LABEL = "text-[10px] leading-[14px] font-semibold tracking-wide text-muted-foreground uppercase";

/**
 * What a mode does, on a card above it while hovered (Pen, 3 Nov 2026: a picture, a title, a line).
 * Pen's pictures are its own; Lemon's are made of its style previews: one look laid out three ways for
 * Layout, three looks for Style.
 */
const MODES = {
  layout: {
    title: "Layout iteration",
    text: "Explore various layout directions while preserving visual style in each iteration.",
    pictures: [techLanding, techWeb, techMobile],
  },
  style: {
    title: "Style iteration",
    text: "Explore various visual styles with a new design direction in each iteration.",
    pictures: [editorialWeb, brutalWeb, calmWeb],
  },
} as const;

function ModeCard({ mode, children }: { mode: keyof typeof MODES; children: ReactNode }) {
  const m = MODES[mode];
  return (
    <H.Root openDelay={200} closeDelay={0}>
      {/* A wrapper, so the card shows over a mode that can't be picked yet too (disabled buttons get no pointer events). */}
      <H.Trigger asChild>
        <div className="grid">{children}</div>
      </H.Trigger>
      <H.Portal>
        <H.Content side="top" sideOffset={8} className="z-50 w-[228px] rounded-[8px] bg-popover p-2 shadow-island outline-none">
          <div className="relative h-[94px] overflow-hidden rounded-[4px] bg-[#e7e7ea]">
            {m.pictures.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                className="absolute rounded-[3px] object-cover object-top shadow-md"
                style={
                  mode === "layout" && i === 2
                    ? { left: 168, top: 14, width: 38, height: 82 }
                    : { left: 10 + i * 58, top: 12 + (i % 2) * 8, width: mode === "layout" && i === 0 ? 60 : 96, height: mode === "layout" && i === 0 ? 90 : 60 }
                }
              />
            ))}
          </div>
          <div className="mt-[9px] px-1 text-[12px] leading-4 font-semibold text-foreground">{m.title}</div>
          <div className="mt-[3px] px-1 pb-1 text-[11px] leading-[15px] text-muted-foreground">{m.text}</div>
        </H.Content>
      </H.Portal>
    </H.Root>
  );
}

/**
 * "Let it cook": the iteration mode and how many variants, measured from Pen (260px wide). With
 * variants the agent designs more variations after the first, each in its own turn (agent/agent.ts);
 * the button then shows the count in Pen's blue. The count goes back to "Don't iterate" once a request
 * is sent; the mode is kept.
 */
export function Variants({ anchor }: { anchor: RefObject<HTMLDivElement | null> }) {
  const cook = useEditor((s) => s.cook);
  const set = (patch: Partial<typeof cook>) => store.set((s) => ({ cook: { ...s.cook, ...patch } }));
  const on = cook.count > 1;
  return (
    <OptionPopover
      anchor={anchor}
      className="w-[260px] px-[13px] pt-[9px] pb-[10px]"
      sideOffset={4}
      tip="Let it cook"
      // Pen's button looks the same while its popover is open.
      trigger={() => (
        <button
          type="button"
          aria-label="Let it cook"
          className={cx(FOOTER_BUTTON, "ml-[6px] flex h-6 items-center gap-[3px] rounded-[6px] px-1 hover:bg-white/10", on && "text-[#8485f2]")}
        >
          <LayoutGrid size={12} strokeWidth={1.5} /> {cook.count}x
        </button>
      )}
    >
      <div className="text-[12px] leading-4 font-semibold text-foreground">Let it cook</div>
      <div className="mt-[5px] text-[12px] leading-4 text-muted-foreground">
        Iterate on designs{" "}
        <Tip label={"Leave the agent running after a design is done.\nIt will keep generating new variations on its own."} side="top">
          <span className="cursor-default underline decoration-dotted underline-offset-2">automatically</span>
        </Tip>
      </div>
      <div className={cx(COOK_LABEL, "mt-[9px]")}>Iteration mode</div>
      <div className="mt-[5px] grid grid-cols-2 gap-1">
        <ModeCard mode="layout">
          <CookOption selected={on && cook.mode === "layout"} disabled={!on} onClick={() => set({ mode: "layout" })}>
            Layout
          </CookOption>
        </ModeCard>
        <ModeCard mode="style">
          <CookOption selected={on && cook.mode === "style"} disabled={!on} onClick={() => set({ mode: "style" })}>
            Style
          </CookOption>
        </ModeCard>
      </div>
      <div className={cx(COOK_LABEL, "mt-[12px]")}>Variants</div>
      <div className="mt-[5px] grid grid-cols-2 gap-x-1 gap-y-1">
        <CookOption selected={!on} onClick={() => set({ count: 1 })}>
          Don’t iterate
        </CookOption>
        {[2, 3, 4, 5, 6].map((n) => (
          <CookOption key={n} selected={cook.count === n} onClick={() => set({ count: n })}>
            {n}
          </CookOption>
        ))}
      </div>
    </OptionPopover>
  );
}
