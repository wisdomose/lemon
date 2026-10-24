// Shared UI pieces, styled from the design tokens (theme.css).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip as T } from "radix-ui";
import type { LucideIcon } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** A floating panel on the canvas. */
export function Island({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("island pointer-events-auto", className)} {...rest}>
      {children}
    </div>
  );
}

/** Icon size and stroke used across the chrome (Lucide, as Pen uses). */
export const ICON = { size: 16, strokeWidth: 1.5 } as const;

/** White pill tooltip with an optional key badge, as in Pen. */
export function Tip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: string;
  keys?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={0}
          className="z-50 flex h-[27px] items-center gap-[11px] rounded-[10px] bg-white px-3 text-[12px] leading-4 text-zinc-900 shadow-md"
        >
          {label}
          {keys && <span className="text-zinc-400">{keys}</span>}
          <T.Arrow className="fill-white" width={10} height={5} />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TipProvider = T.Provider;

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  active?: boolean;
  round?: boolean;
  size?: number;
};

/** A square (or round) icon-only button. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, active, round, size = 28, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        "inline-flex shrink-0 items-center justify-center transition-colors duration-150 ease-[var(--ease-ui)]",
        round ? "rounded-full" : "rounded-md",
        active ? "bg-rail-active ring-1 ring-inset ring-input" : "hover:bg-foreground/5",
        className ?? "text-foreground",
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon {...ICON} />
    </button>
  );
});

export function Divider({ className }: { className?: string }) {
  return <span className={cx("inline-block h-[15px] w-px shrink-0 bg-input", className)} />;
}
