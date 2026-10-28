// Pieces of the properties panel, as in Pen's (measured from Pen 27 Oct 2026): fields, sections,
// dropdowns, the fill and stroke lists, the effects list and its editor, and the font picker.
// Lists show their top item first (the last in the file's list is drawn on top, as in Pen).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DropdownMenu as M, Popover } from "radix-ui";
import {
  Blend,
  Check,
  ChevronDown,
  CircleDot,
  Droplet,
  Eye,
  EyeOff,
  GripVertical,
  Minus,
  Plus,
  Search,
  Square,
  SquareDashed,
  SquareSquare,
  type LucideIcon,
} from "lucide-react";
import type { Effect, Fill, GradientFill, NodeProps } from "../../doc/schema.js";
import * as store from "../../doc/store.js";
import { ColourPicker, toHex, toHsva, type PictureSource } from "../ui/ColourPicker.js";
import { MENU_PANEL, MENU_ROW } from "../ui/menu.js";
import { cx } from "../ui/kit.js";
import { doc, edit, fontFamilies } from "../scene.js";

// Measured: 24px fields on #37373a, 6px apart; sections pad 10px above the title and 15px below.
export const FIELD = "flex h-6 min-w-0 items-center gap-1 rounded-md bg-field px-2 text-[11px] text-foreground";

/** Changes every selected node (edits made with several selected apply to all of them). */
export function set(ids: string[], props: Partial<NodeProps>) {
  edit(() => ids.forEach((id) => store.exists(doc, id) && store.update(doc, id, props)));
}

/** The value shared by all of `ids`, or "Mixed" (as in Pen). */
export function shared(ids: string[], value: (id: string) => number | string): number | string {
  const values = ids.map(value);
  return values.every((v) => v === values[0]) ? values[0]! : "Mixed";
}

/** One item or a list, as a list; and back (one item stays one item, none is nothing). */
export const listOf = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
export const fromList = <T,>(list: T[]): T | T[] | null => (list.length === 0 ? null : list.length === 1 ? list[0]! : list);

/** A number field with a leading letter or icon; commits on Enter or when it loses focus. */
export function NumberField({
  lead,
  value,
  onCommit,
  suffix,
  disabled,
  className,
  title,
}: {
  lead: ReactNode;
  value: number | string;
  onCommit?: (n: number) => void;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && onCommit) onCommit(n);
    else setText(String(value));
  };
  return (
    <label title={title} className={cx(FIELD, "focus-within:ring-1 focus-within:ring-[#3b82f6] hover:ring-1 hover:ring-input", disabled && "pointer-events-none opacity-50", className)}>
      <span className="flex w-3 shrink-0 justify-center text-[11px] font-semibold text-muted-foreground">{lead}</span>
      <input
        value={text}
        disabled={disabled || !onCommit}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="w-full min-w-0 bg-transparent outline-none"
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );
}

export function Section({ title, action, children, last }: { title: ReactNode; action?: ReactNode; children?: ReactNode; last?: boolean }) {
  return (
    <section className={cx("pr-[13px] pl-[15px]", children ? "pt-[10px] pb-[15px]" : "py-[9px]", !last && "border-b border-line")}>
      <div className="flex h-5 items-center text-[11px] font-semibold text-foreground">
        {title}
        <span className="ml-auto flex items-center text-muted-foreground">{action}</span>
      </div>
      {children && <div className="mt-[6px] space-y-[6px]">{children}</div>}
    </section>
  );
}

export const Label = ({ children }: { children: ReactNode }) => <div className="h-4 text-[9px] leading-4 text-muted-foreground">{children}</div>;

export function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-4 cursor-default items-center gap-1 text-[10px] text-foreground">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border", checked ? "border-foreground bg-foreground text-background" : "border-input hover:border-muted-foreground")}
      >
        {checked && <Check size={12} strokeWidth={2.5} />}
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; icon: LucideIcon; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex h-6 rounded-md bg-field p-px">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.label}
          aria-label={o.label}
          onClick={() => onChange(o.value)}
          className={cx("flex flex-1 items-center justify-center rounded-[5px] text-foreground", o.value === value ? "bg-seg-active" : "hover:bg-foreground/5")}
        >
          <o.icon size={14} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

/** A row of icon buttons on one field (alignment, rotate and flips). */
export function ButtonGroup({ buttons, disabled }: { buttons: { icon: LucideIcon; label: string; onClick: () => void; on?: boolean }[]; disabled?: boolean }) {
  return (
    <div className={cx("flex h-6 flex-1 items-center justify-around rounded-md bg-field p-px text-muted-foreground", disabled && "pointer-events-none opacity-50")}>
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          title={b.label}
          aria-label={b.label}
          onClick={b.onClick}
          className={cx("flex h-full flex-1 items-center justify-center rounded-[5px] hover:bg-foreground/5 hover:text-foreground", b.on && "bg-seg-active text-foreground")}
        >
          <b.icon size={14} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

/** A small square toggle beside a field (per-side strokes, per-corner radii, per-side padding). */
export function SideToggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", on ? "bg-[#1d4ed8]/40 text-[#60a5fa]" : "text-muted-foreground hover:text-foreground")}
    >
      <Square size={14} strokeWidth={1.5} />
    </button>
  );
}

/** A dropdown field: the current choice, and a menu of choices (Pen's Position, Join, Cap, …). */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  className,
  iconOnly,
}: {
  value: T | undefined;
  options: { value: T; label: string; icon?: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  className?: string;
  /** Show only the choice's icon in the field (Join and Cap). */
  iconOnly?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <M.Root>
      <M.Trigger asChild>
        <button type="button" className={cx(FIELD, "w-full hover:ring-1 hover:ring-input data-[state=open]:ring-1 data-[state=open]:ring-[#3b82f6]", className)}>
          {iconOnly ? current?.icon : <span className="truncate">{current?.label ?? "Mixed"}</span>}
          <ChevronDown size={12} className="ml-auto shrink-0" />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content sideOffset={4} align="start" className={MENU_PANEL}>
          {options.map((o) => (
            <M.Item key={o.value} disabled={o.disabled} className={MENU_ROW} onSelect={() => onChange(o.value)}>
              {o.icon}
              <span className="flex-1">{o.label}</span>
              {o.value === value && <Check size={14} strokeWidth={1.5} />}
            </M.Item>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

// ---- Fills and strokes -------------------------------------------------------------------------------
const hex = (c: string) => c.replace(/^#/, "").toUpperCase();

/** A fill's colour, if it is one (a hex string or a colour fill). */
const solidOf = (f: Fill): string | undefined => (typeof f === "string" ? f : f.type === "color" ? f.color : undefined);

/** A fill's opacity, 0–100: a colour's alpha, or the fill's `opacity`. */
export function fillOpacity(f: Fill): number {
  const c = solidOf(f);
  if (c !== undefined) return c.startsWith("$") ? 100 : Math.round(toHsva(c).a * 100);
  const o = (f as { opacity?: unknown }).opacity;
  return typeof o === "number" ? Math.round(o * 100) : 100;
}

/** A fill at another opacity (a colour's alpha is part of its hex, as Pen keeps it). */
export function withOpacity(f: Fill, pct: number): Fill {
  const a = Math.max(0, Math.min(100, pct)) / 100;
  const c = solidOf(f);
  if (c !== undefined) {
    if (c.startsWith("$")) return f;
    const next = toHex({ ...toHsva(c), a });
    return typeof f === "string" ? next : { ...(f as object), color: next } as Fill;
  }
  const { opacity: _o, ...rest } = f as GradientFill;
  void _o;
  return (a >= 1 ? rest : { ...rest, opacity: a }) as Fill;
}

export const isOn = (f: Fill | Effect) => !(typeof f === "object" && f.enabled === false);

/** A fill switched on or off (a hex string becomes a colour fill to carry `enabled: false`). */
export function toggled(f: Fill): Fill {
  if (typeof f === "string") return { type: "color", color: f, enabled: false };
  if (f.enabled === false) {
    const { enabled: _e, ...rest } = f;
    void _e;
    // A colour fill that only carried `enabled` goes back to a plain hex.
    return rest.type === "color" && Object.keys(rest).length === 2 ? rest.color : (rest as Fill);
  }
  return { ...f, enabled: false };
}

/**
 * A fill or stroke row: swatch (opens the colour picker), hex or kind, opacity, eye and minus. While
 * the picker is open the row is tinted across the panel's full width, and the picker sits 4px left of
 * the panel, centred on the row.
 */
export function ColourRow({
  value,
  onChange,
  onRemove,
  allowGradient = false,
  pictures: source,
  bare,
}: {
  value: Fill;
  onChange: (c: Fill) => void;
  onRemove?: () => void;
  allowGradient?: boolean;
  pictures?: PictureSource;
  /** Just the field: no eye (an effect's colour, as in Pen's effect editor). */
  bare?: boolean;
}) {
  const solid = solidOf(value);
  const [text, setText] = useState(solid && !solid.startsWith("$") ? hex(toHex({ ...toHsva(solid), a: 1 })) : "");
  useEffect(() => setText(solid && !solid.startsWith("$") ? hex(toHex({ ...toHsva(solid), a: 1 })) : ""), [solid]);
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const isVar = !!solid?.startsWith("$");
  const picture = typeof value === "object" && value.type === "image" ? value : undefined;
  const pictureUrl = picture?.url ? source?.url(picture.url) : undefined;
  const on = isOn(value);
  const swatch = solid
    ? isVar ? "transparent" : solid
    : picture
      ? pictureUrl ? `center / cover url(${pictureUrl})` : "#777"
      : typeof value === "object" && value.type === "gradient"
        ? `linear-gradient(to right, ${(value.colors ?? []).map((st) => `${st.color} ${Number(st.position) * 100}%`).join(", ")})`
        : "#777";
  const kind = picture ? "Image" : typeof value === "object" && value.type === "gradient" ? (value.gradientType ?? "linear").replace(/^./, (c) => c.toUpperCase()) : typeof value === "object" ? value.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "";
  // Anchor: the panel's left edge, at the row's height.
  const anchor = {
    current: {
      getBoundingClientRect: () => {
        const panel = document.querySelector("[data-props]")!.getBoundingClientRect();
        const r = row.current!.getBoundingClientRect();
        return DOMRect.fromRect({ x: panel.left, y: r.top, width: panel.width, height: r.height });
      },
    },
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor virtualRef={anchor as never} />
      <div ref={row} className={cx("group relative flex items-center gap-2", open && "before:absolute before:-inset-x-[15px] before:-inset-y-[2px] before:bg-[#3e4c69]")}>
        <div className={cx("relative flex h-6 min-w-0 flex-1 items-center rounded-md bg-field text-[11px] text-foreground hover:ring-1 hover:ring-input", !on && "opacity-50")}>
          <Popover.Trigger asChild>
            <button type="button" aria-label="Edit colour" className="ml-1 h-4 w-4 shrink-0 rounded-[3px] border border-input" style={{ background: swatch }} />
          </Popover.Trigger>
          <input
            value={isVar ? solid : solid ? text : kind}
            readOnly={isVar || !solid}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              if (!solid || !/^[0-9a-f]{6}$/i.test(text)) return setText(solid && !isVar ? hex(toHex({ ...toHsva(solid), a: 1 })) : "");
              const next = toHex({ ...toHsva(`#${text}`), a: toHsva(solid).a });
              onChange(typeof value === "object" && value.type === "color" ? { ...value, color: next } : next);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            className="ml-2 w-full min-w-0 bg-transparent outline-none"
          />
          <OpacityField value={fillOpacity(value)} onCommit={(pct) => onChange(withOpacity(value, pct))} />
        </div>
        {!bare && (
          <button type="button" aria-label={on ? "Hide" : "Show"} className="relative text-muted-foreground hover:text-foreground" onClick={() => onChange(toggled(value))}>
            {on ? <Eye size={16} strokeWidth={1.5} /> : <EyeOff size={16} strokeWidth={1.5} />}
          </button>
        )}
        {onRemove && (
          <button type="button" aria-label="Remove" className="relative text-muted-foreground hover:text-foreground" onClick={onRemove}>
            <Minus size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="center"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 rounded-[10px] border border-border bg-popover shadow-island outline-none"
        >
          <ColourPicker value={value} onChange={onChange} allowGradient={allowGradient} pictures={source} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The "100 %" part of a colour row. */
function OpacityField({ value, onCommit }: { value: number; onCommit: (pct: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="flex h-full shrink-0 items-center gap-1 border-l border-black/30 px-2 whitespace-nowrap">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          const n = parseFloat(text);
          if (Number.isFinite(n)) onCommit(n);
          else setText(String(value));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="w-[26px] bg-transparent text-right outline-none"
      />
      %
    </label>
  );
}

/** A list of fills (or stroke paints), top one first; each can be edited, hidden or removed. */
export function PaintList({
  paints,
  onChange,
  pictures,
}: {
  paints: Fill[];
  /** The whole list, bottom first (as the file keeps it). */
  onChange: (list: Fill[]) => void;
  pictures?: PictureSource;
}) {
  const shown = paints.map((f, i) => ({ f, i })).reverse();
  return (
    <>
      {shown.map(({ f, i }) => (
        <ColourRow
          key={i}
          value={f}
          allowGradient
          pictures={pictures}
          onChange={(next) => onChange(paints.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(paints.filter((_, j) => j !== i))}
        />
      ))}
    </>
  );
}

// ---- Effects -------------------------------------------------------------------------------------------
type EffectKind = "drop" | "inner" | "blur" | "background" | "shader";
const EFFECT_KINDS: { kind: EffectKind; label: string; icon: LucideIcon }[] = [
  { kind: "drop", label: "Drop Shadow", icon: SquareSquare },
  { kind: "inner", label: "Inner Shadow", icon: SquareDashed },
  { kind: "blur", label: "Layer Blur", icon: CircleDot },
  { kind: "background", label: "Background Blur", icon: Blend },
  { kind: "shader", label: "Shader", icon: Droplet },
];
export const kindOfEffect = (e: Effect): EffectKind =>
  e.type === "shadow" ? (e.shadowType === "inner" ? "inner" : "drop") : e.type === "blur" ? "blur" : e.type === "background_blur" ? "background" : "shader";

/** A new effect of a kind, with Pen's defaults (a drop shadow: black at 25%, 4 down, blur 4). */
export function newEffect(kind: EffectKind): Effect {
  switch (kind) {
    case "drop":
      return { type: "shadow", shadowType: "outer", color: "#00000040", offset: { x: 0, y: 4 }, blur: 4 };
    case "inner":
      return { type: "shadow", shadowType: "inner", color: "#00000040", offset: { x: 0, y: 4 }, blur: 4 };
    case "blur":
      return { type: "blur", radius: 4 };
    case "background":
      return { type: "background_blur", radius: 4 };
    default:
      return { type: "shader", url: "" };
  }
}

/** An effect turned into another kind, keeping what the two share. */
function retyped(e: Effect, kind: EffectKind): Effect {
  const fresh = newEffect(kind);
  if (e.type === "shadow" && fresh.type === "shadow") return { ...e, shadowType: fresh.shadowType };
  if ((e.type === "blur" || e.type === "background_blur") && (fresh.type === "blur" || fresh.type === "background_blur")) return { ...fresh, radius: e.radius };
  return fresh;
}

/** The menu of effect kinds (for "+" and the editor's kind field). There is one layer blur at most. */
function EffectMenuItems({ onPick, current, hasBlur }: { onPick: (k: EffectKind) => void; current?: EffectKind; hasBlur: boolean }) {
  return (
    <>
      {EFFECT_KINDS.map((k) => (
        <M.Item
          key={k.kind}
          className={MENU_ROW}
          disabled={(k.kind === "blur" && hasBlur && current !== "blur") || k.kind === "shader"}
          onSelect={() => onPick(k.kind)}
        >
          <k.icon size={14} strokeWidth={1.5} />
          <span className="flex-1">{k.label}</span>
          {current === k.kind && <Check size={14} strokeWidth={1.5} />}
        </M.Item>
      ))}
    </>
  );
}

/** The Effects section's list: each effect a row (opens its editor), with eye and minus; "+" adds one. */
export function EffectsSection({ effects, onChange }: { effects: Effect[]; onChange: (list: Effect[]) => void }) {
  const [opened, setOpened] = useState<number | undefined>();
  const hasBlur = effects.some((e) => e.type === "blur");
  const add = (kind: EffectKind) => {
    onChange([...effects, newEffect(kind)]);
    // A new effect opens its editor, as in Pen: once the menu has closed, so closing it doesn't dismiss the editor.
    const at = effects.length;
    setTimeout(() => setOpened(at), 50);
  };
  return (
    <Section
      title="Effects"
      action={
        <M.Root>
          <M.Trigger asChild>
            <button type="button" aria-label="Add effect" className="hover:text-foreground">
              <Plus size={16} strokeWidth={1.5} />
            </button>
          </M.Trigger>
          <M.Portal>
            <M.Content sideOffset={4} align="end" className={MENU_PANEL} onCloseAutoFocus={(e) => e.preventDefault()}>
              <EffectMenuItems onPick={add} hasBlur={hasBlur} />
            </M.Content>
          </M.Portal>
        </M.Root>
      }
    >
      {effects.length > 0 &&
        effects
          .map((e, i) => ({ e, i }))
          .reverse()
          .map(({ e, i }) => (
            <EffectRow
              key={i}
              effect={e}
              open={opened === i}
              onOpen={(v) => setOpened(v ? i : undefined)}
              hasBlur={hasBlur}
              onChange={(next) => onChange(effects.map((x, j) => (j === i ? next : x)))}
              onRemove={() => {
                setOpened(undefined);
                onChange(effects.filter((_, j) => j !== i));
              }}
            />
          ))}
    </Section>
  );
}

function EffectRow({
  effect,
  open,
  onOpen,
  hasBlur,
  onChange,
  onRemove,
}: {
  effect: Effect;
  open: boolean;
  onOpen: (v: boolean) => void;
  hasBlur: boolean;
  onChange: (e: Effect) => void;
  onRemove: () => void;
}) {
  const kind = kindOfEffect(effect);
  const meta = EFFECT_KINDS.find((k) => k.kind === kind)!;
  const on = isOn(effect);
  const row = useRef<HTMLDivElement>(null);
  const anchor = {
    current: {
      getBoundingClientRect: () => {
        const panel = document.querySelector("[data-props]")!.getBoundingClientRect();
        const r = row.current!.getBoundingClientRect();
        return DOMRect.fromRect({ x: panel.left, y: r.top, width: panel.width, height: r.height });
      },
    },
  };
  return (
    <Popover.Root open={open} onOpenChange={onOpen}>
      <Popover.Anchor virtualRef={anchor as never} />
      <div ref={row} className="group relative flex items-center gap-2">
        {open && <GripVertical size={12} strokeWidth={1.5} className="absolute -left-[13px] text-muted-foreground" />}
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cx(FIELD, "flex-1 gap-2 text-left hover:ring-1 hover:ring-input", open && "ring-1 ring-[#3b82f6]", !on && "opacity-50")}
          >
            <meta.icon size={12} strokeWidth={1.5} /> {meta.label}
          </button>
        </Popover.Trigger>
        <button type="button" aria-label={on ? "Hide" : "Show"} className="text-muted-foreground hover:text-foreground" onClick={() => onChange(on ? { ...effect, enabled: false } : (({ enabled: _e, ...rest }) => (void _e, rest as Effect))(effect))}>
          {on ? <Eye size={16} strokeWidth={1.5} /> : <EyeOff size={16} strokeWidth={1.5} />}
        </button>
        <button type="button" aria-label="Remove effect" className="text-muted-foreground hover:text-foreground" onClick={onRemove}>
          <Minus size={16} strokeWidth={1.5} />
        </button>
      </div>
      <Popover.Portal>
        <Popover.Content
          side="left"
          align="center"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[200px] rounded-[10px] border border-border bg-popover p-2 text-[11px] text-foreground shadow-island outline-none"
        >
          <EffectEditor effect={effect} onChange={onChange} hasBlur={hasBlur} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** An effect's settings: its kind, then colour, offset and blur for a shadow, or the blur radius. */
function EffectEditor({ effect, onChange, hasBlur }: { effect: Effect; onChange: (e: Effect) => void; hasBlur: boolean }) {
  const kind = kindOfEffect(effect);
  const meta = EFFECT_KINDS.find((k) => k.kind === kind)!;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return (
    <div className="space-y-[6px]">
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <M.Root>
          <M.Trigger asChild>
            <button type="button" className={cx(FIELD, "flex-1 gap-2 hover:ring-1 hover:ring-input")}>
              <meta.icon size={12} strokeWidth={1.5} /> {meta.label}
              <ChevronDown size={12} className="ml-auto" />
            </button>
          </M.Trigger>
          <M.Portal>
            <M.Content sideOffset={4} align="start" className={MENU_PANEL}>
              <EffectMenuItems current={kind} hasBlur={hasBlur} onPick={(k) => onChange(retyped(effect, k))} />
            </M.Content>
          </M.Portal>
        </M.Root>
        {effect.type === "shadow" && <Droplet size={14} strokeWidth={1.5} className="text-muted-foreground" aria-label="Blend mode" />}
      </div>
      {effect.type === "shadow" ? (
        <div className="grid grid-cols-[40px_1fr] items-center gap-x-1 gap-y-[6px]">
          <span className="text-muted-foreground">Color</span>
          <ColourRow bare value={effect.color ?? "#00000040"} onChange={(c) => onChange({ ...effect, color: typeof c === "string" ? c : effect.color })} />
          <span className="text-muted-foreground">Offset</span>
          <div className="grid grid-cols-2 gap-[6px]">
            <NumberField lead="X" value={num(effect.offset?.x)} onCommit={(x) => onChange({ ...effect, offset: { x, y: effect.offset?.y ?? 0 } })} />
            <NumberField lead="Y" value={num(effect.offset?.y)} onCommit={(y) => onChange({ ...effect, offset: { x: effect.offset?.x ?? 0, y } })} />
          </div>
          <span className="text-muted-foreground">Blur</span>
          <NumberField lead={<CircleDot size={10} strokeWidth={1.5} />} value={num(effect.blur)} onCommit={(blur) => onChange({ ...effect, blur: Math.max(0, blur) })} />
        </div>
      ) : effect.type === "blur" || effect.type === "background_blur" ? (
        <div className="grid grid-cols-[44px_1fr] items-center gap-x-2">
          <span className="text-muted-foreground">Blur</span>
          <NumberField lead={<CircleDot size={10} strokeWidth={1.5} />} value={num(effect.radius)} onCommit={(radius) => onChange({ ...effect, radius: Math.max(0, radius) })} />
        </div>
      ) : (
        <div className="text-muted-foreground">Shaders can't be edited yet.</div>
      )}
    </div>
  );
}

// ---- Fonts -------------------------------------------------------------------------------------------
/** The font family field: opens a searchable list of every family. */
export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (q ? fontFamilies.filter((f) => f.toLowerCase().includes(q)) : fontFamilies).slice(0, 200);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className={cx(FIELD, "w-full hover:ring-1 hover:ring-input data-[state=open]:ring-1 data-[state=open]:ring-[#3b82f6]")}>
          <span className="truncate">{value}</span>
          <ChevronDown size={12} className="ml-auto shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="left" align="start" sideOffset={8} className={cx(MENU_PANEL, "w-[220px] p-1")}>
          <label className={cx(FIELD, "mb-1")}>
            <Search size={12} strokeWidth={1.5} className="text-muted-foreground" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fonts" className="w-full bg-transparent outline-none" />
          </label>
          <div className="max-h-[320px] overflow-y-auto">
            {matches.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  onChange(f);
                  setOpen(false);
                }}
                className={cx(MENU_ROW, "w-full hover:bg-[#3b82f6] hover:text-white")}
              >
                <span className="flex-1 truncate text-left">{f}</span>
                {f === value && <Check size={14} strokeWidth={1.5} />}
              </button>
            ))}
            {!matches.length && <div className="px-2 py-1.5 text-muted-foreground">No fonts match.</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
