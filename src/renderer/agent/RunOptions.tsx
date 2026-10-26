// The prompt footer's run options: parallel agents (⚡) and "let it cook" variants (▦). Layout measured
// from the reference: a 300px popover over the chat box, 6px above the footer row, chips 44px wide.
// Parallel agents work (team.ts); variants don't exist yet, so their choices are shown but disabled.
import { useState, type ReactNode, type RefObject } from "react";
import { Popover as P } from "radix-ui";
import { LayoutGrid, Zap } from "lucide-react";
import { cx } from "../ui/kit.js";
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
}: {
  anchor: RefObject<HTMLDivElement | null>;
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
  /** Width and padding. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor virtualRef={anchor as RefObject<HTMLDivElement>} />
      <P.Trigger asChild>{trigger(open)}</P.Trigger>
      <P.Portal>
        <P.Content
          side="top"
          align="start"
          sideOffset={1}
          alignOffset={-20}
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
      trigger={(open) => (
        <button
          type="button"
          aria-label="Parallel agents"
          className={cx("ml-auto flex h-6 items-center gap-[3px] rounded-[6px] px-1 font-semibold text-amber-500", open && "bg-amber-500/10")}
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
        <Card title="Split Work" text="Several agents work on different tasks" selected={team.mode === "split"} onClick={() => set({ mode: "split" })} />
        <Card title="Side by Side" text="Several agents work on the same task" selected={team.mode === "side"} onClick={() => set({ mode: "side" })} />
      </div>
      {team.count > 1 && <p className="mt-2 pl-1 text-[10px] text-muted-foreground">Each agent uses your subscription separately.</p>}
    </OptionPopover>
  );
}

/** A choice in "Let it cook": filled grey when picked, outlined otherwise (Pen, 26 Oct 2026 screenshot). */
function CookOption({ children, selected, disabled }: { children: ReactNode; selected?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Coming with Let it cook" : undefined}
      className={cx(
        "flex h-8 items-center justify-center rounded-[8px] text-[12px]",
        selected ? "bg-input font-semibold text-foreground" : "border border-input text-muted-foreground",
        disabled && "cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

const COOK_LABEL = "text-[10px] leading-[14px] font-semibold tracking-wide text-muted-foreground uppercase";

/**
 * "Let it cook": the iteration mode and how many variants, measured from Pen (260px wide). Variants
 * aren't built yet, so only the defaults are picked and the rest can't be chosen.
 */
export function Variants({ anchor }: { anchor: RefObject<HTMLDivElement | null> }) {
  return (
    <OptionPopover
      anchor={anchor}
      className="w-[260px] px-[13px] pt-[9px] pb-[10px]"
      trigger={(open) => (
        <button type="button" aria-label="Let it cook" className={cx("ml-[6px] flex h-6 items-center gap-[3px] rounded-[6px] px-1", open && "bg-foreground/5")}>
          <LayoutGrid size={12} strokeWidth={1.5} /> 1x
        </button>
      )}
    >
      <div className="text-[12px] leading-4 font-semibold text-foreground">Let it cook</div>
      <div className="mt-[3px] text-[12px] leading-4 text-muted-foreground">
        Iterate on designs{" "}
        <span className="underline decoration-dotted underline-offset-2" title="Several versions of your design are made for you to compare.">
          automatically
        </span>
      </div>
      <div className={cx(COOK_LABEL, "mt-[12px]")}>Iteration mode</div>
      <div className="mt-[7px] grid grid-cols-2 gap-1">
        <CookOption selected>Layout</CookOption>
        <CookOption disabled>Style</CookOption>
      </div>
      <div className={cx(COOK_LABEL, "mt-[13px]")}>Variants</div>
      <div className="mt-[7px] grid grid-cols-2 gap-x-1 gap-y-1">
        <CookOption selected>Don’t iterate</CookOption>
        {[2, 3, 4, 5, 6].map((n) => (
          <CookOption key={n} disabled>
            {n}
          </CookOption>
        ))}
      </div>
    </OptionPopover>
  );
}
