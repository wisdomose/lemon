// The properties panel (right island): shown when something is selected. Sections and their order
// follow the reference captures; fields edit the document.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { ColourPicker } from "../ui/ColourPicker.js";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyStart,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownFromLine,
  ArrowDownToLine,
  ArrowRightFromLine,
  ArrowUpToLine,
  SquareSlash,
  Check,
  ChevronDown,
  Circle,
  DiamondPlus,
  Frame,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  LayoutGrid,
  LayoutPanelLeft,
  Minus,
  PanelRight,
  Plus,
  RotateCw,
  Scan,
  Settings,
  Square,
  SquareDashed,
  Type,
  type LucideIcon,
} from "lucide-react";
import * as store from "../../doc/store.js";
import type { LinearGradient, NodeProps, Paint, Size, TreeNode } from "../../doc/schema.js";
import { findNode } from "../../render/screenshot.js";
import { currentScene, doc, edit } from "../scene.js";
import { useEditor } from "../store.js";
import { Island, cx } from "../ui/kit.js";

// Measured: 24px fields on #37373a, 6px apart; sections pad 10px above the title and 15px below.
const FIELD = "flex h-6 min-w-0 items-center gap-1 rounded-md bg-field px-2 text-[11px] text-foreground";

function set(id: string, props: Partial<NodeProps>) {
  edit(() => store.update(doc, id, props));
}

/** A number field with a leading letter or icon; commits on Enter or when it loses focus. */
function NumberField({
  lead,
  value,
  onCommit,
  suffix,
  disabled,
  className,
}: {
  lead: ReactNode;
  value: number | string;
  onCommit?: (n: number) => void;
  suffix?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && onCommit) onCommit(n);
    else setText(String(value));
  };
  return (
    <label className={cx(FIELD, disabled && "opacity-50", className)}>
      <span className="flex w-3 shrink-0 justify-center text-[11px] font-semibold text-muted-foreground">{lead}</span>
      <input
        value={text}
        disabled={disabled || !onCommit}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="w-full min-w-0 bg-transparent outline-none"
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );
}

function Section({ title, action, children, last }: { title: ReactNode; action?: ReactNode; children?: ReactNode; last?: boolean }) {
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

const Label = ({ children }: { children: ReactNode }) => <div className="h-4 text-[9px] leading-4 text-muted-foreground">{children}</div>;

function Check2({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-4 cursor-default items-center gap-1 text-[10px] text-foreground">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border", checked ? "border-foreground bg-foreground text-background" : "border-input")}
      >
        {checked && <Check size={12} strokeWidth={2.5} />}
      </button>
      {label}
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; icon: LucideIcon; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex h-6 rounded-md bg-field p-px">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.label}
          onClick={() => onChange(o.value)}
          className={cx("flex flex-1 items-center justify-center rounded-[5px] text-foreground", o.value === value && "bg-seg-active")}
        >
          <o.icon size={14} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

function ButtonGroup({ icons }: { icons: LucideIcon[] }) {
  return (
    <div className="flex h-6 flex-1 items-center justify-around rounded-md bg-field text-muted-foreground">
      {icons.map((I, i) => (
        <I key={i} size={14} strokeWidth={1.5} />
      ))}
    </div>
  );
}

function typeInfo(n: TreeNode): { icon: LucideIcon; label: string } {
  if (n.type === "text") return { icon: Type, label: "Text" };
  if (n.type === "rect") return { icon: Square, label: "Rectangle" };
  if (n.type === "ellipse") return { icon: Circle, label: "Ellipse" };
  if (n.type === "image") return { icon: ImageIcon, label: "Image" };
  return { icon: n.props.layout === "none" ? Frame : AlignHorizontalJustifyStart, label: "Frame" };
}

const sizeNum = (v: Size | undefined, measured: number) => (typeof v === "number" ? v : Math.round(measured * 10) / 10);
const hex = (c: unknown) => (typeof c === "string" ? c.replace(/^#/, "").toUpperCase() : "");

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const scene = currentScene();
  const node = selection && scene ? findNode(scene.tree, selection) : undefined;
  if (!node || !scene) return null;
  const p = node.props;
  const box = scene.boxes.get(node.id) ?? { x: 0, y: 0, w: 0, h: 0 };
  const parent = store.parentOf(doc, node.id);
  const topLevel = parent === "root";
  const parentFrame = parent && parent !== "root" ? findNode(scene.tree, parent) : undefined;
  const parentBox = parentFrame ? scene.boxes.get(parentFrame.id) : undefined;
  const isFrame = node.type === "frame";
  const flex = isFrame && p.layout !== "none";
  const info = typeInfo(node);
  const colour: Paint | undefined = node.type === "text" ? (typeof p.color === "string" ? p.color : "#000000") : p.fill;

  return (
    <Island data-props className="absolute top-[59px] right-2 bottom-[9px] flex w-[221px] flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line pt-2 pr-[13px] pb-2 pl-[11px]">
          <div className="flex h-5 items-center gap-2 pl-1 text-[11px] text-foreground">
            <info.icon size={16} strokeWidth={1.5} /> <span className="truncate">{p.name ?? info.label}</span>
            <PanelRight size={16} strokeWidth={1.5} className="ml-auto text-muted-foreground" />
          </div>
          <button type="button" className="mt-[11px] flex h-6 w-full items-center justify-center gap-2 rounded-md bg-field text-[11px] text-foreground">
            <DiamondPlus size={14} strokeWidth={1.5} /> Create Component
          </button>
        </div>

        <Section title="Context" action={<ChevronDown size={14} strokeWidth={1.5} />} />

        <Section title="Alignment">
          <div className="flex gap-[6px]">
            <ButtonGroup icons={[AlignStartVertical, AlignCenterVertical, AlignEndVertical]} />
            <ButtonGroup icons={[AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal]} />
          </div>
        </Section>

        <Section title="Position">
          <div className="grid grid-cols-2 gap-[6px]">
            <NumberField
              lead="X"
              value={Math.round((box.x - (parentBox?.x ?? 0)) * 10) / 10}
              onCommit={topLevel || p.absolute || parentFrame?.props.layout === "none" ? (x) => set(node.id, { x }) : undefined}
            />
            <NumberField
              lead="Y"
              value={Math.round((box.y - (parentBox?.y ?? 0)) * 10) / 10}
              onCommit={topLevel || p.absolute || parentFrame?.props.layout === "none" ? (y) => set(node.id, { y }) : undefined}
            />
            <NumberField lead={<RotateCw size={12} strokeWidth={1.5} />} value="0°" />
            <ButtonGroup icons={[RotateCw, FlipVertical2, FlipHorizontal2]} />
          </div>
          {parentFrame && parentFrame.props.layout !== "none" && (
            <Check2 label="Absolute Position" checked={!!p.absolute} onChange={(v) => set(node.id, { absolute: v, ...(v ? { x: Math.round(box.x - parentBox!.x), y: Math.round(box.y - parentBox!.y) } : {}) })} />
          )}
        </Section>

        <Section
          title={flex ? "Flex Layout" : "Layout"}
          action={isFrame && <LayoutPanelLeft size={16} strokeWidth={1.5} className={cx(flex && "rounded bg-[#1d4ed8]/40 text-[#60a5fa]")} />}
        >
          {isFrame && (
            <Segmented
              value={p.layout ?? "column"}
              onChange={(layout) => set(node.id, { layout })}
              options={[
                { value: "none", icon: LayoutGrid, label: "No layout" },
                { value: "column", icon: ArrowDownFromLine, label: "Vertical" },
                { value: "row", icon: ArrowRightFromLine, label: "Horizontal" },
              ]}
            />
          )}
          {flex && <FlexControls node={node} />}
          {/* Without layout buttons the label sits right under the title, as in the reference. */}
          <div className={cx(!isFrame && "-mt-[6px]")}><Label>Dimensions</Label></div>
          <div className="grid grid-cols-2 gap-[6px]">
            <NumberField lead="W" value={sizeNum(p.width, box.w)} onCommit={(width) => set(node.id, { width })} />
            <NumberField lead="H" value={sizeNum(p.height, box.h)} onCommit={(height) => set(node.id, { height })} />
            <Check2 label="Fill Width" checked={p.width === "fill"} onChange={(v) => set(node.id, { width: v ? "fill" : Math.round(box.w) })} />
            <Check2 label="Fill Height" checked={p.height === "fill"} onChange={(v) => set(node.id, { height: v ? "fill" : Math.round(box.h) })} />
            {(flex || node.type === "text") && (
              <>
                <Check2 label="Hug Width" checked={p.width === "fit" || p.width === undefined} onChange={(v) => set(node.id, { width: v ? "fit" : Math.round(box.w) })} />
                <Check2 label="Hug Height" checked={p.height === "fit" || p.height === undefined} onChange={(v) => set(node.id, { height: v ? "fit" : Math.round(box.h) })} />
              </>
            )}
          </div>
        </Section>

        <Section
          title="Appearance"
          action={
            <button type="button" aria-label="Visibility" onClick={() => set(node.id, { visible: p.visible === false })}>
              {p.visible === false ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          }
        >
          <div className="flex gap-[6px]">
            <NumberField
              className="flex-1"
              lead={<SquareSlash size={12} strokeWidth={1.5} />}
              value={Math.round((p.opacity ?? 1) * 100)}
              onCommit={(v) => set(node.id, { opacity: Math.max(0, Math.min(100, v)) / 100 })}
            />
            <NumberField
              className="flex-1"
              lead={<SquareDashed size={12} strokeWidth={1.5} />}
              value={typeof p.radius === "number" ? p.radius : 0}
              disabled={node.type === "text"}
              onCommit={(radius) => set(node.id, { radius })}
            />
            <Scan size={16} strokeWidth={1.5} className="mt-1 shrink-0 text-muted-foreground" />
          </div>
          {isFrame && <Check2 label="Clip Content" checked={!!p.clip} onChange={(clip) => set(node.id, { clip })} />}
        </Section>

        <Section
          title="Fill"
          action={
            !colour && (
              <button type="button" aria-label="Add fill" onClick={() => set(node.id, { fill: "#D9D9D9" })}>
                <Plus size={16} strokeWidth={1.5} />
              </button>
            )
          }
        >
          {colour && (
            <ColourRow
              value={colour}
              allowGradient={node.type !== "text"}
              onChange={(c) => set(node.id, node.type === "text" ? { color: c as string } : { fill: c })}
              onRemove={node.type === "text" ? undefined : () => set(node.id, { fill: null as never })}
            />
          )}
        </Section>

        {node.type === "text" && <Typography node={node} />}

        <Section
          title="Stroke"
          action={
            !p.stroke && (
              <button type="button" aria-label="Add stroke" onClick={() => set(node.id, { stroke: { color: "#000000", width: 1 } })}>
                <Plus size={16} strokeWidth={1.5} />
              </button>
            )
          }
        >
          {p.stroke && (
            <>
              <ColourRow
                value={p.stroke.color}
                onChange={(color) => set(node.id, { stroke: { ...p.stroke!, color: color as string } })}
                onRemove={() => set(node.id, { stroke: null as never })}
              />
              <div className="grid grid-cols-2 gap-[6px]">
                <Label>Position</Label>
                <Label>Weight</Label>
                <div className={FIELD}>Inside <ChevronDown size={12} className="ml-auto" /></div>
                <NumberField lead="W" value={p.stroke.width} onCommit={(width) => set(node.id, { stroke: { ...p.stroke!, width } })} />
              </div>
            </>
          )}
        </Section>

        <Section title="Effects" action={<Plus size={16} strokeWidth={1.5} />}>
          {p.shadow && (
            <div className="flex items-center gap-2">
              <div className={cx(FIELD, "flex-1")}>
                <SquareDashed size={12} strokeWidth={1.5} /> Drop Shadow
              </div>
              <Eye size={16} strokeWidth={1.5} className="text-muted-foreground" />
              <Minus size={16} strokeWidth={1.5} className="text-muted-foreground" />
            </div>
          )}
        </Section>

        <Section title="Code" action={<Settings size={16} strokeWidth={1.5} />}>
          <div className={FIELD}>
            HTML + Tailwind <ChevronDown size={12} className="ml-auto" />
          </div>
          <div className="grid grid-cols-2 gap-[6px]">
            <button type="button" className={cx(FIELD, "justify-center")}>Copy HTML</button>
            <button type="button" className={cx(FIELD, "justify-center")}>Export HTML</button>
          </div>
          <button type="button" className={cx(FIELD, "w-full justify-center")}>Import Web via Browser</button>
        </Section>

        <Section title="Export" last>
          <div className="grid grid-cols-2 gap-[6px]">
            <div className={FIELD}>1x <ChevronDown size={12} className="ml-auto" /></div>
            <div className={FIELD}>PNG <ChevronDown size={12} className="ml-auto" /></div>
          </div>
          <button type="button" className={cx(FIELD, "w-full justify-center")}>Export layer</button>
        </Section>
      </div>
    </Island>
  );
}

/**
 * A fill or stroke row: swatch (opens the colour picker), hex, opacity. While the picker is open the row
 * is tinted across the panel's full width, and the picker sits 4px left of the panel, centred on the row.
 */
function ColourRow({
  value,
  onChange,
  onRemove,
  allowGradient = false,
}: {
  value: Paint;
  onChange: (c: Paint) => void;
  onRemove?: () => void;
  allowGradient?: boolean;
}) {
  const solid = typeof value === "string" ? value : undefined;
  const [text, setText] = useState(solid ? hex(solid) : "");
  useEffect(() => setText(solid ? hex(solid) : ""), [solid]);
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const isVar = !!solid?.startsWith("$");
  const swatch = solid
    ? isVar ? "transparent" : solid
    : `linear-gradient(to right, ${(value as LinearGradient).stops.map((st) => `${st.color} ${st.at * 100}%`).join(", ")})`;
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
    <div ref={row} className={cx("relative flex items-center gap-2", open && "before:absolute before:-inset-x-[15px] before:-inset-y-[2px] before:bg-[#3e4c69]")}>
      <div className="relative flex h-6 min-w-0 flex-1 items-center rounded-md bg-field text-[11px] text-foreground">
        <Popover.Trigger asChild>
          <button type="button" aria-label="Edit colour" className="ml-1 h-4 w-4 shrink-0 rounded-[3px] border border-input" style={{ background: swatch }} />
        </Popover.Trigger>
        <input
          value={isVar ? solid : solid ? text : "Linear"}
          readOnly={isVar || !solid}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(text) && onChange(`#${text}`)}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="ml-2 w-full min-w-0 bg-transparent outline-none"
        />
        <span className="border-l border-black/30 px-2 whitespace-nowrap">100 %</span>
      </div>
      <Eye size={16} strokeWidth={1.5} className="relative shrink-0 text-muted-foreground" />
      {onRemove && (
        <button type="button" aria-label="Remove" className="relative" onClick={onRemove}>
          <Minus size={16} strokeWidth={1.5} className="text-muted-foreground" />
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
          <ColourPicker value={value} onChange={onChange} allowGradient={allowGradient} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FlexControls({ node }: { node: TreeNode }) {
  const p = node.props;
  const row = p.layout === "row";
  // The 3×3 grid sets justify along the layout's axis and align across it.
  const justify = p.justify ?? "start";
  const align = p.align ?? "start";
  const idx = (v: string) => (v === "center" ? 1 : v === "end" ? 2 : 0);
  const at = (col: number, r: number) => (row ? idx(justify) === col && idx(align) === r : idx(align) === col && idx(justify) === r);
  const pick = (col: number, r: number) => {
    const v = (i: number) => (["start", "center", "end"] as const)[i]!;
    set(node.id, row ? { justify: v(col), align: v(r) } : { align: v(col), justify: v(r) });
  };
  const pad = Array.isArray(p.padding) ? p.padding : [p.padding ?? 0, p.padding ?? 0];
  const [py, px] = pad.length === 4 ? [pad[0], pad[1]] : [pad[0], pad[1]];
  return (
    <>
      <div className="grid grid-cols-2 gap-[6px]">
        <Label>Alignment</Label>
        <Label>Gap</Label>
        <div className="grid h-[68px] grid-cols-3 grid-rows-3 place-items-center rounded-md bg-field">
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => (
              <button key={`${r}${c}`} type="button" onClick={() => pick(c, r)} className="flex h-full w-full items-center justify-center">
                <span className={at(c, r) ? "h-2 w-2 rounded-[2px] bg-[#3b82f6]" : "h-[3px] w-[3px] rounded-full bg-muted-foreground"} />
              </button>
            )),
          )}
        </div>
        <div className="space-y-1.5 text-[10px] text-foreground">
          <NumberField lead={<AlignJustify size={12} strokeWidth={1.5} />} value={p.gap ?? 0} onCommit={(gap) => set(node.id, { gap, justify: p.justify === "between" ? "start" : p.justify })} />
          <button type="button" className="flex items-center gap-2" onClick={() => set(node.id, { justify: "between" })}>
            <span className={cx("h-3.5 w-3.5 rounded-full border border-input", p.justify === "between" && "border-[4px] border-foreground")} /> Space Between
          </button>
        </div>
      </div>
      <Label>Padding</Label>
      <div className="grid grid-cols-2 gap-[6px]">
        <NumberField lead="↔" value={Number(px)} onCommit={(v) => set(node.id, { padding: [Number(py), v] })} />
        <NumberField lead="↕" value={Number(py)} onCommit={(v) => set(node.id, { padding: [v, Number(px)] })} />
      </div>
    </>
  );
}

function Typography({ node }: { node: TreeNode }) {
  const p = node.props;
  const WEIGHTS: [number, string][] = [
    [100, "Thin"], [200, "Extra Light"], [300, "Light"], [400, "Regular"], [500, "Medium"],
    [600, "Semi Bold"], [700, "Bold"], [800, "Extra Bold"], [900, "Black"],
  ];
  const weightName = WEIGHTS.find(([w]) => w === (p.weight ?? 400))?.[1] ?? String(p.weight);
  return (
    <Section title="Typography">
      <div className={FIELD}>
        {typeof p.font === "string" ? p.font : "Inter"} <ChevronDown size={12} className="ml-auto" />
      </div>
      <div className="grid grid-cols-2 gap-[6px]">
        <div className={FIELD}>
          {weightName} <ChevronDown size={12} className="ml-auto" />
        </div>
        <NumberField lead="Aa" value={Number(p.size ?? 16)} onCommit={(size) => set(node.id, { size })} />
        <Label>Line height</Label>
        <Label>Letter spacing</Label>
        <NumberField lead="↕" value={p.lineHeight ?? "Auto"} onCommit={(lineHeight) => set(node.id, { lineHeight })} />
        <NumberField lead="|A|" value={p.letterSpacing ?? 0} onCommit={(letterSpacing) => set(node.id, { letterSpacing })} />
        <Label>Horizontal</Label>
        <Label>Vertical</Label>
        <Segmented
          value={p.textAlign ?? "left"}
          onChange={(textAlign) => set(node.id, { textAlign })}
          options={[
            { value: "left", icon: AlignLeft, label: "Left" },
            { value: "center", icon: AlignCenter, label: "Centre" },
            { value: "right", icon: AlignRight, label: "Right" },
          ]}
        />
        <Segmented
          value="top"
          onChange={() => {}}
          options={[
            { value: "top", icon: ArrowUpToLine, label: "Top" },
            { value: "middle", icon: AlignCenterHorizontal, label: "Middle" },
            { value: "bottom", icon: ArrowDownToLine, label: "Bottom" },
          ]}
        />
      </div>
    </Section>
  );
}
