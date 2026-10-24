// Dropdown and context menus in Pen's style: popover fill, 14px rows, right-aligned muted shortcuts,
// small-caps section labels, destructive items in red.
import type { ReactNode } from "react";
import { ContextMenu as C, DropdownMenu as M } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { cx } from "./kit.js";

const PANEL = "z-50 min-w-[180px] rounded-[10px] bg-popover p-1 text-[14px] text-popover-foreground shadow-island";
const ROW =
  "relative flex h-[28px] cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-40";

export function MenuContent({ children, ...rest }: M.DropdownMenuContentProps) {
  return (
    <M.Portal>
      <M.Content sideOffset={6} className={PANEL} {...rest}>
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  label,
  keys,
  checked,
  danger,
  icon,
  onSelect,
  disabled,
}: {
  label: ReactNode;
  keys?: string;
  checked?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <M.Item className={cx(ROW, danger && "text-destructive")} onSelect={onSelect} disabled={disabled}>
      {icon}
      <span className="flex-1">{label}</span>
      {checked && <Check size={14} strokeWidth={1.5} />}
      {keys && <span className="ml-6 text-[13px] text-muted-foreground">{keys}</span>}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</M.Label>;
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-white/5" />;

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
      <C.Content className={cx(PANEL, "min-w-[184px]")}>{children}</C.Content>
    </C.Portal>
  );
}

export function ContextItem({ label, keys, danger, onSelect }: { label: string; keys?: string; danger?: boolean; onSelect?: () => void }) {
  return (
    <C.Item className={cx(ROW, danger && "text-destructive")} onSelect={onSelect}>
      <span className="flex-1">{label}</span>
      {keys && <span className="ml-6 text-[13px] text-muted-foreground">{keys}</span>}
    </C.Item>
  );
}

export const ContextSeparator = () => <C.Separator className="my-1 h-px bg-white/5" />;

export function ContextSub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <C.Sub>
      <C.SubTrigger className={ROW}>
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} strokeWidth={1.5} />
      </C.SubTrigger>
      <C.Portal>
        <C.SubContent sideOffset={4} className={PANEL}>
          {children}
        </C.SubContent>
      </C.Portal>
    </C.Sub>
  );
}
