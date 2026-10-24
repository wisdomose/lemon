// Dropdown and context menus in the reference's style: popover fill, right-aligned muted shortcuts,
// small-caps section labels, destructive items in red.
import type { ReactNode } from "react";
import { ContextMenu as C, DropdownMenu as M } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "./kit.js";

// Measured from the reference: 28px rows, 12px text, blue highlight inset 4px, 9px between groups.
const PANEL = "z-50 min-w-[180px] rounded-[8px] bg-popover p-1 text-[12px] whitespace-nowrap text-foreground shadow-island";
const ROW =
  "relative flex h-[28px] cursor-default select-none items-center gap-2 rounded-[6px] px-2 outline-none data-[highlighted]:bg-[#3b82f6] data-[highlighted]:text-white data-[state=open]:bg-[#3b82f6] data-[state=open]:text-white data-[disabled]:opacity-40";

/** A shortcut as the reference shows it: compact, muted, Shift as ⇧ ("Ctrl⇧R", "CtrlAltK"). */
function Keys({ keys }: { keys: string }) {
  const text = keys.replace(/Shift\s?/g, "⇧").replace(/\s+/g, "");
  return <span className="ml-4 text-[11px] tracking-[0.04em] text-muted-foreground group-data-[highlighted]:text-white/80">{text}</span>;
}

export function MenuContent({ children, className, ...rest }: M.DropdownMenuContentProps) {
  return (
    <M.Portal>
      <M.Content sideOffset={6} className={cx(PANEL, className)} {...rest}>
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  label,
  keys,
  checked,
  current,
  plain,
  hint,
  danger,
  icon,
  onSelect,
  disabled,
}: {
  label: ReactNode;
  keys?: string;
  checked?: boolean;
  /** The active choice: a grey row, with a chevron unless `plain` (as in the reference's history list). */
  current?: boolean;
  plain?: boolean;
  /** Muted text on the right, e.g. the current value of a submenu. */
  hint?: ReactNode;
  danger?: boolean;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <M.Item className={cx(ROW, "group", current && "bg-input", danger && "text-destructive")} onSelect={onSelect} disabled={disabled}>
      {icon}
      <span className="flex-1">{label}</span>
      {checked && <Check size={14} strokeWidth={1.5} />}
      {current && !plain && <ChevronRight size={12} strokeWidth={1.5} className="text-muted-foreground" />}
      {hint && <span className="flex items-center gap-1 text-muted-foreground">{hint}</span>}
      {keys && <Keys keys={keys} />}
    </M.Item>
  );
}

/** A group label: small caps in pickers (model list), sentence case in lists (history). */
export function MenuLabel({ children, caps = true }: { children: ReactNode; caps?: boolean }) {
  return (
    <M.Label className={cx("px-2 text-[11px] font-semibold text-[#71717a]", caps ? "pt-1.5 pb-1 tracking-wide uppercase" : "pt-1 pb-0")}>
      {children}
    </M.Label>
  );
}

export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-input" />;

export function SubMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <M.Sub>
      <M.SubTrigger className={ROW}>
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} strokeWidth={1.5} />
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent sideOffset={4} className={PANEL}>
          {children}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  );
}

// ---- Context menu (same look) ----
export const ContextRoot = C.Root;
export const ContextTrigger = C.Trigger;

export function ContextContent({ children }: { children: ReactNode }) {
  return (
    <C.Portal>
      <C.Content className={cx(PANEL, "w-[186px]")}>{children}</C.Content>
    </C.Portal>
  );
}

export function ContextItem({ label, keys, danger, onSelect }: { label: string; keys?: string; danger?: boolean; onSelect?: () => void }) {
  return (
    <C.Item className={cx(ROW, "group", danger && "text-destructive")} onSelect={onSelect}>
      <span className="flex-1">{label}</span>
      {keys && <Keys keys={keys} />}
    </C.Item>
  );
}

export const ContextSeparator = () => <C.Separator className="-mx-1 my-1 h-px bg-input" />;

export function ContextSub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <C.Sub>
      <C.SubTrigger className={ROW}>
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} strokeWidth={1.5} />
      </C.SubTrigger>
      <C.Portal>
        <C.SubContent sideOffset={8} className={PANEL}>
          {children}
        </C.SubContent>
      </C.Portal>
    </C.Sub>
  );
}
