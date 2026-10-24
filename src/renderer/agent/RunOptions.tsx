// The prompt footer's run options: parallel agents (⚡) and "let it cook" variants (▦). Layout measured
// from the reference: a 300px popover over the chat box, 6px above the footer row, chips 44px wide.
// Only one agent and no variants exist yet, so the other choices are shown but disabled.
import { useState, type ReactNode, type RefObject } from "react";
import { Popover as P } from "radix-ui";
import { LayoutGrid, Zap } from "lucide-react";
import { cx } from "../ui/kit.js";

const LABEL = "mb-[5px] pl-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase";

function Chip({ children, selected, disabled }: { children: ReactNode; selected?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? "Not available yet" : undefined}
      className={cx(
        "flex h-[26px] min-w-[44px] items-center justify-center gap-1 rounded-[6px] px-2 text-[11px] font-semibold",
        selected ? "bg-amber-500/15 text-amber-500" : "border border-dashed border-input text-muted-foreground/60",
      )}
    >
      {children}
    </button>
  );
}

function Card({ title, text, selected }: { title: string; text: string; selected?: boolean }) {
  return (
    <button
      type="button"
      disabled={!selected}
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
}: {
  anchor: RefObject<HTMLDivElement | null>;
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
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
          className="z-50 w-[300px] rounded-[10px] border border-border bg-popover px-2 pt-[11px] pb-3 shadow-island outline-none"
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export function ParallelAgents({ anchor }: { anchor: RefObject<HTMLDivElement | null> }) {
  return (
    <OptionPopover
      anchor={anchor}
      trigger={(open) => (
        <button
          type="button"
          aria-label="Parallel agents"
          className={cx("ml-auto flex h-6 items-center gap-[3px] rounded-[6px] px-1 font-semibold text-amber-500", open && "bg-amber-500/10")}
        >
          <Zap size={12} strokeWidth={1.75} /> 1x
        </button>
      )}
    >
      <div className={LABEL}>Parallel agents</div>
      <div className="flex gap-1">
        <Chip selected>
          <Zap size={11} strokeWidth={1.75} /> 1x
        </Chip>
        {[2, 3, 4, 5, 6].map((n) => (
          <Chip key={n} disabled>
            {n}x
          </Chip>
        ))}
      </div>
      <div className="mt-[13px] flex gap-1">
        <Card title="Split Work" text="Several agents work on different tasks" selected />
        <Card title="Side by Side" text="Several agents work on the same task" />
      </div>
    </OptionPopover>
  );
}

export function Variants({ anchor }: { anchor: RefObject<HTMLDivElement | null> }) {
  return (
    <OptionPopover
      anchor={anchor}
      trigger={(open) => (
        <button type="button" aria-label="Let it cook" className={cx("ml-[6px] flex h-6 items-center gap-[3px] rounded-[6px] px-1", open && "bg-foreground/5")}>
          <LayoutGrid size={12} strokeWidth={1.5} /> 1x
        </button>
      )}
    >
      <div className={LABEL}>Iteration mode</div>
      <div className="flex gap-1">
        <Card title="Layout" text="Different arrangements" selected />
        <Card title="Style" text="Different looks" />
      </div>
      <div className={cx(LABEL, "mt-[11px]")}>Variants</div>
      <div className="flex gap-1">
        <Chip selected>Don’t iterate</Chip>
        {[2, 3, 4, 5, 6].map((n) => (
          <Chip key={n} disabled>
            {n}
          </Chip>
        ))}
      </div>
    </OptionPopover>
  );
}
