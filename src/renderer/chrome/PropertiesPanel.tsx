// The properties panel (right island): shown when something is selected. Sections, their order and
// what each shows for each kind of node follow Pen's (captured 27 Oct 2026): text and icons have no
// stroke, groups no fill; fills, strokes and effects are lists, top item first. Fields edit the document.
import { useState } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyStart,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownFromLine,
  ArrowDownToLine,
  ArrowRightFromLine,
  ArrowUpToLine,
  ChevronDown,
  Circle,
  CircleDashed,
  Component,
  Copy,
  Diamond,
  DiamondMinus,
  DiamondPlus,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Focus,
  Frame,
  Image as ImageIcon,
  LayoutGrid,
  LayoutPanelLeft,
  MoveHorizontal,
  PanelRight,
  Plus,
  RotateCw,
  RotateCcw,
  Scan,
  Settings,
  Smile,
  Square,
  SquareDashed,
  SquareSlash,
  Type,
  WrapText,
  type LucideIcon,
} from "lucide-react";
import * as store from "../../doc/store.js";
import { ROOT_ID, type Effect, type Fill, type NodeProps, type Padding, type Size, type TreeNode } from "../../doc/schema.js";
import { kindOf as layoutKind } from "../../layout/layout.js";
import { weightOf } from "../../text/paragraph.js";
import { findNode } from "../../render/screenshot.js";
import { pictures } from "../pictures.js";
import { currentScene, doc, edit, engine } from "../scene.js";
import { useEditor } from "../store.js";
import { Island, Tip, cx } from "../ui/kit.js";
import { COPY_COLOUR, detachSelected, goToMain, kindOf, makeComponents, unmakeComponent } from "../components.js";
import { placedFreely } from "../canvas/place.js";
import {
  ButtonGroup,
  Check2,
  Dropdown,
  EffectsSection,
  FIELD,
  FontPicker,
  Label,
  NumberField,
  PaintList,
  Section,
  Segmented,
  SideToggle,
  fromList,
  listOf,
  set,
  shared,
} from "./panel-parts.js";

function typeInfo(n: TreeNode): { icon: LucideIcon; label: string } {
  if (n.instance) return { icon: Diamond, label: typeInfo({ ...n, instance: undefined }).label };
  if (n.props.reusable) return { icon: Component, label: typeInfo({ ...n, props: { ...n.props, reusable: false } }).label };
  if (n.type === "text") return { icon: Type, label: "Text" };
  if (n.type === "rectangle") return { icon: Array.isArray(n.props.fill) || typeof n.props.fill !== "object" || n.props.fill.type !== "image" ? Square : ImageIcon, label: "Rectangle" };
  if (n.type === "ellipse") return { icon: Circle, label: "Ellipse" };
  if (n.type === "icon") return { icon: Smile, label: "Icon" };
  if (n.type !== "frame") return { icon: n.type === "group" ? Frame : Square, label: n.type[0]!.toUpperCase() + n.type.slice(1) };
  return { icon: n.props.layout === "none" ? Frame : AlignHorizontalJustifyStart, label: "Frame" };
}

const sizeNum = (v: Size | undefined, measured: number) => (typeof v === "number" ? v : Math.round(measured * 10) / 10);
/** Whether a size is "fill_container" / "fit_content" (with or without a fallback). */
const sizeIs = (v: Size | undefined, rule: "fill_container" | "fit_content") => typeof v === "string" && v.startsWith(rule);
/** A number property as a field shows it (a variable shows its name). */
const shown = (v: unknown, fallback: number | string = 0): number | string => (typeof v === "number" ? Math.round(v * 100) / 100 : typeof v === "string" ? v : fallback);

/** A number with its unit right after it ("0°", "50%"), as Pen shows them; a variable as its name. */
const unit = (v: number | string, u: string) => (typeof v === "number" ? `${v}${u}` : v);

/** Padding as [top, right, bottom, left]. */
function sides(p: Padding | undefined): [unknown, unknown, unknown, unknown] {
  if (p === undefined) return [0, 0, 0, 0];
  if (!Array.isArray(p)) return [p, p, p, p];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  return [p[0], p[1], p[2], p[3]];
}

const ICON_LIBRARIES = ["lucide", "feather", "Material Symbols Outlined", "Material Symbols Rounded", "Material Symbols Sharp", "phosphor"];
const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const scene = currentScene();
  const ids = scene ? selection.filter((id) => findNode(scene.tree, id)) : [];
  // The panel shows the last node picked; with several selected, values that differ read "Mixed".
  const node = scene && ids.length ? findNode(scene.tree, ids.at(-1)!) : undefined;
  if (!node || !scene) return null;
  const many = ids.length > 1;
  const boxOf = (id: string) => scene.boxes.get(id) ?? { x: 0, y: 0, w: 0, h: 0 };
  const parentBoxOf = (id: string) => {
    const pid = store.parentOf(doc, id);
    return pid && pid !== ROOT_ID ? boxOf(pid) : { x: 0, y: 0, w: 0, h: 0 };
  };
  const p = node.props;
  const box = scene.boxes.get(node.id) ?? { x: 0, y: 0, w: 0, h: 0 };
  const parent = store.parentOf(doc, node.id);
  const topLevel = parent === ROOT_ID;
  const parentFrame = parent && parent !== ROOT_ID ? findNode(scene.tree, parent) : undefined;
  const parentBox = parentFrame ? scene.boxes.get(parentFrame.id) : undefined;
  const isFrame = node.type === "frame";
  const isText = node.type === "text";
  const flex = isFrame && p.layout !== "none";
  const info = typeInfo(node);
  const kind = kindOf(node);
  const free = topLevel || p.layoutPosition === "absolute" || (parentFrame ? layoutKind(parentFrame) === "free" : false);
  // What each kind of node has, as in Pen.
  const hasFill = node.type !== "group";
  const hasStroke = !["text", "icon", "group", "note", "prompt", "context"].includes(node.type);
  const rounded = ["frame", "rectangle", "polygon"].includes(node.type);
  const growth = p.textGrowth ?? "auto";

  /** Aligns the selection: several to their bounds, one to its parent; only nodes placed by x/y move. */
  const align = (edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => {
    const boxes = ids.map((id) => ({ id, b: boxOf(id) }));
    const target = many
      ? (() => {
          const x = Math.min(...boxes.map(({ b }) => b.x));
          const y = Math.min(...boxes.map(({ b }) => b.y));
          return { x, y, w: Math.max(...boxes.map(({ b }) => b.x + b.w)) - x, h: Math.max(...boxes.map(({ b }) => b.y + b.h)) - y };
        })()
      : parentBox;
    if (!target) return;
    edit(() => {
      for (const { id, b } of boxes) {
        const n = findNode(scene.tree, id);
        const pid = store.parentOf(doc, id);
        const pn = pid ? findNode(scene.tree, pid) : undefined;
        if (!n || !pn || !placedFreely(n, pn) || store.isPart(id)) continue;
        const pb = parentBoxOf(id);
        if (edge === "left" || edge === "centerX" || edge === "right") {
          const x = edge === "left" ? target.x : edge === "right" ? target.x + target.w - b.w : target.x + (target.w - b.w) / 2;
          store.update(doc, id, { x: Math.round(x - pb.x) });
        } else {
          const y = edge === "top" ? target.y : edge === "bottom" ? target.y + target.h - b.h : target.y + (target.h - b.h) / 2;
          store.update(doc, id, { y: Math.round(y - pb.y) });
        }
      }
    });
  };

  /** Turns each selected node a quarter turn clockwise (rotation counts counter-clockwise). */
  const rotate90 = () =>
    edit(() =>
      ids.forEach((id) => {
        const r = Number(store.propsOf(doc, id).rotation ?? 0) - 90;
        const norm = ((((r + 180) % 360) + 360) % 360) - 180;
        store.update(doc, id, { rotation: norm === 0 ? null : norm } as never);
      }),
    );
  const flip = (key: "flipX" | "flipY") =>
    edit(() => ids.forEach((id) => store.update(doc, id, { [key]: store.propsOf(doc, id)[key] === true ? null : true } as never)));

  /** Text's resizing: auto (its own size), fixed width (wraps), or a fixed box. */
  const resize = (g: "auto" | "fixed-width" | "fixed-width-height") =>
    set(
      ids,
      g === "auto"
        ? ({ textGrowth: null, width: null, height: null } as never)
        : g === "fixed-width"
          ? ({ textGrowth: g, width: typeof p.width === "string" && p.width.startsWith("fill_container") ? p.width : Math.round(box.w), height: null } as never)
          : { textGrowth: g, width: Math.round(box.w), height: Math.round(box.h) },
    );

  return (
    <Island data-props className="absolute top-[59px] right-2 bottom-[9px] flex w-[221px] flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line pt-2 pr-[13px] pb-2 pl-[11px]">
          <div className="flex h-6 items-center gap-2 text-[11px] text-foreground">
            {many ? (
              <span className="flex min-w-0 items-center gap-2 pl-1">
                <Copy size={16} strokeWidth={1.5} /> <span className="truncate">{ids.length} selected</span>
              </span>
            ) : (
              <span
                className={cx(
                  "flex h-6 min-w-0 flex-1 items-center gap-2 rounded-md pl-1",
                  // A main component's name sits on a violet tint; a copy's in a dashed violet outline.
                  kind === "main" && "bg-[#3d3955] pl-[5px]",
                  (kind === "instance" || kind === "part") && "border border-dashed pl-1",
                )}
                style={kind ? { color: COPY_COLOUR, borderColor: kind === "main" ? undefined : `${COPY_COLOUR}b3` } : undefined}
              >
                <info.icon size={16} strokeWidth={1.5} /> <span className="truncate">{p.name ?? info.label}</span>
              </span>
            )}
            <PanelRight size={16} strokeWidth={1.5} className="ml-auto shrink-0 text-muted-foreground" />
          </div>
          {!many && (
            <div className="mt-[11px] flex h-6 items-center gap-1">
              {kind === "main" ? (
                <button type="button" onClick={() => unmakeComponent(node.id)} className="flex h-6 w-full items-center justify-center gap-2 rounded-md bg-field text-[11px] text-foreground hover:bg-foreground/10">
                  <DiamondMinus size={14} strokeWidth={1.5} /> Detach Component
                </button>
              ) : (
                <>
                  {node.instance && (
                    <Tip label="Go to main component">
                      <button type="button" aria-label="Go to main component" onClick={() => goToMain(node.id)} className="flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                        <Focus size={14} strokeWidth={1.5} />
                      </button>
                    </Tip>
                  )}
                  {kind === "instance" && !store.isPart(node.id) && (
                    <Tip label="Detach instance" keys="Ctrl Alt X">
                      <button type="button" aria-label="Detach instance" onClick={detachSelected} className="flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
                        <DiamondMinus size={14} strokeWidth={1.5} />
                      </button>
                    </Tip>
                  )}
                  <button
                    type="button"
                    disabled={store.isPart(node.id)}
                    onClick={makeComponents}
                    className="ml-auto flex h-6 flex-1 items-center justify-center gap-2 rounded-md bg-field text-[11px] text-foreground hover:bg-foreground/10 disabled:opacity-50"
                  >
                    <DiamondPlus size={14} strokeWidth={1.5} /> Create Component
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {!many && <Section title="Context" action={<ChevronDown size={14} strokeWidth={1.5} />} />}

        <Section title="Alignment">
          <div className="flex gap-[6px]">
            <ButtonGroup
              buttons={[
                { icon: AlignStartVertical, label: "Align left", onClick: () => align("left") },
                { icon: AlignCenterVertical, label: "Align horizontal centres", onClick: () => align("centerX") },
                { icon: AlignEndVertical, label: "Align right", onClick: () => align("right") },
              ]}
            />
            <ButtonGroup
              buttons={[
                { icon: AlignStartHorizontal, label: "Align top", onClick: () => align("top") },
                { icon: AlignCenterHorizontal, label: "Align vertical centres", onClick: () => align("centerY") },
                { icon: AlignEndHorizontal, label: "Align bottom", onClick: () => align("bottom") },
              ]}
            />
          </div>
        </Section>

        <Section title="Position">
          <div className="grid grid-cols-2 gap-[6px]">
            <NumberField lead="X" value={shared(ids, (id) => Math.round((boxOf(id).x - parentBoxOf(id).x) * 10) / 10)} onCommit={free ? (x) => set(ids, { x }) : undefined} />
            <NumberField lead="Y" value={shared(ids, (id) => Math.round((boxOf(id).y - parentBoxOf(id).y) * 10) / 10)} onCommit={free ? (y) => set(ids, { y }) : undefined} />
            <NumberField
              lead="∟"
              title="Rotation"
              value={((v) => (typeof v === "number" ? `${v}°` : v))(shared(ids, (id) => Number(findNode(scene.tree, id)?.props.rotation ?? 0)))}
              onCommit={(rotation) => set(ids, { rotation: rotation || null } as never)}
            />
            <ButtonGroup
              buttons={[
                { icon: RotateCw, label: "Rotate 90°", onClick: rotate90 },
                { icon: FlipVertical2, label: "Flip vertical", onClick: () => flip("flipY"), on: p.flipY === true },
                { icon: FlipHorizontal2, label: "Flip horizontal", onClick: () => flip("flipX"), on: p.flipX === true },
              ]}
            />
          </div>
          {parentFrame && layoutKind(parentFrame) !== "free" && (
            <Check2
              label="Absolute Position"
              checked={p.layoutPosition === "absolute"}
              onChange={(v) => set(ids, { layoutPosition: v ? "absolute" : null, ...(v ? { x: Math.round(box.x - parentBox!.x), y: Math.round(box.y - parentBox!.y) } : {}) } as never)}
            />
          )}
        </Section>

        <Section
          title={flex ? "Flex Layout" : "Layout"}
          action={isFrame && <LayoutPanelLeft size={16} strokeWidth={1.5} className={cx(flex && "rounded bg-[#1d4ed8]/40 text-[#60a5fa]")} />}
        >
          {isFrame && (
            <Segmented
              value={p.layout ?? "horizontal"}
              onChange={(layout) => set(ids, { layout })}
              options={[
                { value: "none", icon: LayoutGrid, label: "No layout" },
                { value: "vertical", icon: ArrowDownFromLine, label: "Vertical" },
                { value: "horizontal", icon: ArrowRightFromLine, label: "Horizontal" },
              ]}
            />
          )}
          {flex && <FlexControls key={node.id} node={node} ids={ids} />}
          {/* Without layout buttons the label sits right under the title, as in Pen. */}
          <div className={cx(!isFrame && "-mt-[6px]")}>
            <Label>Dimensions</Label>
          </div>
          <div className="grid grid-cols-2 gap-[6px]">
            <NumberField
              lead="W"
              disabled={isText && growth === "auto"}
              value={shared(ids, (id) => sizeNum(store.propsOf(doc, id).width, boxOf(id).w))}
              onCommit={(width) => set(ids, isText && growth === "auto" ? { width, textGrowth: "fixed-width" } : { width })}
            />
            <NumberField
              lead="H"
              disabled={isText && growth !== "fixed-width-height"}
              value={shared(ids, (id) => sizeNum(store.propsOf(doc, id).height, boxOf(id).h))}
              onCommit={(height) => set(ids, { height })}
            />
            <Check2 label="Fill Width" checked={sizeIs(p.width, "fill_container")} onChange={(v) => set(ids, { width: v ? "fill_container" : Math.round(box.w) })} />
            <Check2 label="Fill Height" checked={sizeIs(p.height, "fill_container")} onChange={(v) => set(ids, { height: v ? "fill_container" : Math.round(box.h) })} />
            {flex && (
              <>
                <Check2 label="Hug Width" checked={sizeIs(p.width, "fit_content") || p.width === undefined} onChange={(v) => set(ids, { width: v ? "fit_content" : Math.round(box.w) })} />
                <Check2 label="Hug Height" checked={sizeIs(p.height, "fit_content") || p.height === undefined} onChange={(v) => set(ids, { height: v ? "fit_content" : Math.round(box.h) })} />
              </>
            )}
          </div>
          {isText && (
            <>
              <Label>Resizing</Label>
              <Segmented
                value={growth}
                onChange={resize}
                options={[
                  { value: "auto", icon: MoveHorizontal, label: "Auto width" },
                  { value: "fixed-width", icon: WrapText, label: "Fixed width" },
                  { value: "fixed-width-height", icon: Scan, label: "Fixed size" },
                ]}
              />
            </>
          )}
        </Section>

        <Section
          title="Appearance"
          action={
            <button type="button" aria-label="Visibility" className="hover:text-foreground" onClick={() => set(ids, { enabled: p.enabled === false ? null : false } as never)}>
              {p.enabled === false ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          }
        >
          <Appearance key={node.id} node={node} ids={ids} rounded={rounded} />
          {isFrame && <Check2 label="Clip Content" checked={p.clip === true} onChange={(clip) => set(ids, { clip })} />}
          {node.type === "ellipse" && (
            <>
              <Label>Ellipse</Label>
              <div className="grid grid-cols-2 gap-[6px]">
                <NumberField lead={<RotateCcw size={12} strokeWidth={1.5} />} title="Start angle" value={unit(shown(p.startAngle), "°")} onCommit={(startAngle) => set(ids, { startAngle })} />
                <NumberField lead={<CircleDashed size={12} strokeWidth={1.5} />} title="Sweep" value={unit(shown(p.sweepAngle, 360), "°")} onCommit={(sweepAngle) => set(ids, { sweepAngle: Math.max(-360, Math.min(360, sweepAngle)) })} />
                <NumberField
                  lead={<Circle size={12} strokeWidth={1.5} />}
                  title="Inner radius"
                  value={unit(typeof p.innerRadius === "number" ? Math.round(p.innerRadius * 100) : shown(p.innerRadius), "%")}
                  onCommit={(v) => set(ids, { innerRadius: Math.max(0, Math.min(100, v)) / 100 })}
                />
              </div>
            </>
          )}
        </Section>

        {hasFill && (
          <Section
            title="Fill"
            action={
              <button type="button" aria-label="Add fill" className="hover:text-foreground" onClick={() => set(ids, { fill: fromList([...listOf(p.fill), "#00000033"]) } as never)}>
                <Plus size={16} strokeWidth={1.5} />
              </button>
            }
          >
            {listOf(p.fill).length > 0 && <PaintList paints={listOf(p.fill)} pictures={node.type === "text" || node.type === "icon" ? undefined : pictures} onChange={(list) => set(ids, { fill: fromList(list) } as never)} />}
          </Section>
        )}

        {isText && <Typography node={node} ids={ids.filter((id) => store.typeOf(doc, id) === "text")} />}
        {node.type === "icon" && <IconSection key={node.id} node={node} ids={ids.filter((id) => store.typeOf(doc, id) === "icon")} />}

        {hasStroke && <Stroke key={node.id} node={node} ids={ids} />}

        <EffectsSection effects={listOf<Effect>(p.effect)} onChange={(list) => set(ids, { effect: fromList(list) } as never)} />

        <Section title="Code" action={<Settings size={16} strokeWidth={1.5} />}>
          <div className={FIELD}>
            HTML + Tailwind <ChevronDown size={12} className="ml-auto" />
          </div>
          <div className="grid grid-cols-2 gap-[6px]">
            <button type="button" className={cx(FIELD, "justify-center hover:bg-foreground/10")}>Copy HTML</button>
            <button type="button" className={cx(FIELD, "justify-center hover:bg-foreground/10")}>Export HTML</button>
          </div>
          <button type="button" className={cx(FIELD, "w-full justify-center hover:bg-foreground/10")}>Import Web via Browser</button>
        </Section>

        <Section title="Export" last>
          <div className="grid grid-cols-2 gap-[6px]">
            <div className={FIELD}>1x <ChevronDown size={12} className="ml-auto" /></div>
            <div className={FIELD}>PNG <ChevronDown size={12} className="ml-auto" /></div>
          </div>
          <button type="button" className={cx(FIELD, "w-full justify-center hover:bg-foreground/10")}>Export layer</button>
        </Section>
      </div>
    </Island>
  );
}

/** Opacity and corner radius; the radius splits into four corners with the toggle beside it. */
function Appearance({ node, ids, rounded }: { node: TreeNode; ids: string[]; rounded: boolean }) {
  const p = node.props;
  const r = p.cornerRadius;
  // Pen shows mixed corners as "Mixed" until the toggle opens the four fields.
  const [corners, setCorners] = useState(false);
  const each: unknown[] = Array.isArray(r) ? r : [r ?? 0, r ?? 0, r ?? 0, r ?? 0];
  const setCorner = (i: number, v: number) => set(ids, { cornerRadius: each.map((x, j) => (j === i ? v : typeof x === "number" ? x : 0)) as never });
  return (
    <>
      <div className="flex gap-[6px]">
        <NumberField
          className="flex-1"
          lead={<SquareSlash size={12} strokeWidth={1.5} />}
          title="Opacity"
          value={typeof p.opacity === "number" ? Math.round(p.opacity * 100) : shown(p.opacity, 100)}
          onCommit={(v) => set(ids, { opacity: v >= 100 ? null : Math.max(0, v) / 100 } as never)}
        />
        <NumberField
          className="flex-1"
          lead={<SquareDashed size={12} strokeWidth={1.5} />}
          title="Corner radius"
          value={Array.isArray(r) ? (r.every((v) => v === r[0]) ? shown(r[0]) : "Mixed") : shown(r)}
          disabled={!rounded || corners}
          onCommit={(cornerRadius) => set(ids, { cornerRadius })}
        />
        {rounded ? <SideToggle on={corners} onChange={setCorners} label="Independent corners" /> : <span className="w-6 shrink-0" />}
      </div>
      {rounded && corners && (
        <div className="grid grid-cols-2 gap-[6px]">
          {["Top left", "Top right", "Bottom right", "Bottom left"].map((label, i) => (
            <NumberField key={label} title={label} lead={["┌", "┐", "┘", "└"][i]} value={shown(each[i])} onCommit={(v) => setCorner(i, Math.max(0, v))} />
          ))}
        </div>
      )}
    </>
  );
}

function FlexControls({ node, ids }: { node: TreeNode; ids: string[] }) {
  const p = node.props;
  const row = layoutKind(node) === "row";
  // The 3×3 grid sets justifyContent along the layout's axis and alignItems across it.
  const justify = p.justifyContent ?? "start";
  const align = p.alignItems ?? "start";
  const idx = (v: string) => (v === "center" ? 1 : v === "end" ? 2 : 0);
  const spread = justify === "space_between" || justify === "space_around";
  const at = (col: number, r: number) => (row ? (spread || idx(justify) === col) && idx(align) === r : idx(align) === col && (spread || idx(justify) === r));
  const pick = (col: number, r: number) => {
    const v = (i: number) => (["start", "center", "end"] as const)[i]!;
    set(ids, row ? { justifyContent: spread ? justify : v(col), alignItems: v(r) } : { alignItems: v(col), justifyContent: spread ? justify : v(r) });
  };
  const [t, rt, b, l] = sides(p.padding);
  const [each, setEach] = useState(!(t === b && rt === l));
  const pad = (v: unknown) => (typeof v === "number" ? v : 0);
  const radio = (on: boolean) => <span className={cx("inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-input", on && "border-[4px] border-foreground")} />;
  return (
    <>
      <div className="grid grid-cols-2 gap-[6px]">
        <Label>Alignment</Label>
        <Label>Gap</Label>
        <div className="grid h-[68px] grid-cols-3 grid-rows-3 place-items-center rounded-md bg-field">
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => (
              <button key={`${r}${c}`} type="button" onClick={() => pick(c, r)} className="group flex h-full w-full items-center justify-center">
                <span className={at(c, r) ? "h-2 w-2 rounded-[2px] bg-[#3b82f6]" : "h-[3px] w-[3px] rounded-full bg-muted-foreground group-hover:h-2 group-hover:w-2 group-hover:rounded-[2px] group-hover:bg-[#3b82f6]/50"} />
              </button>
            )),
          )}
        </div>
        <div className="space-y-1.5 text-[10px] text-foreground">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Gap" className="flex shrink-0" onClick={() => spread && set(ids, { justifyContent: "start" })}>
              {radio(!spread)}
            </button>
            <NumberField lead={<AlignJustify size={12} strokeWidth={1.5} />} value={shown(p.gap)} onCommit={(gap) => set(ids, { gap, ...(spread ? { justifyContent: "start" } : {}) })} />
          </div>
          <button type="button" className="flex items-center gap-1.5 whitespace-nowrap" onClick={() => set(ids, { justifyContent: "space_between" })}>
            {radio(justify === "space_between")} Space Between
          </button>
          <button type="button" className="flex items-center gap-1.5 whitespace-nowrap" onClick={() => set(ids, { justifyContent: "space_around" })}>
            {radio(justify === "space_around")} Space Around
          </button>
        </div>
      </div>
      <Label>Padding</Label>
      {each ? (
        <div className="flex gap-[6px]">
          <div className="grid flex-1 grid-cols-2 gap-[6px]">
            {(["Top", "Right", "Bottom", "Left"] as const).map((label, i) => (
              <NumberField
                key={label}
                title={label}
                lead={label[0]}
                value={shown([t, rt, b, l][i])}
                onCommit={(v) => set(ids, { padding: [t, rt, b, l].map((x, j) => (j === i ? v : pad(x))) as never })}
              />
            ))}
          </div>
          <SideToggle on onChange={setEach} label="Independent padding" />
        </div>
      ) : (
        <div className="flex gap-[6px]">
          <NumberField title="Vertical padding" lead="↕" value={shown(t)} onCommit={(v) => set(ids, { padding: v === pad(rt) ? v : [v, pad(rt)] })} />
          <NumberField title="Horizontal padding" lead="↔" value={shown(rt)} onCommit={(v) => set(ids, { padding: v === pad(t) ? v : [pad(t), v] })} />
          <SideToggle on={false} onChange={setEach} label="Independent padding" />
        </div>
      )}
    </>
  );
}

/** Strokes: the paints (top first), where they sit, how wide (per side with the toggle), joins and caps. */
function Stroke({ node, ids }: { node: TreeNode; ids: string[] }) {
  const p = node.props;
  const paints = listOf(p.stroke);
  const w = p.strokeWidth;
  const perSide = typeof w === "object" && w !== null;
  const [each, setEach] = useState(perSide);
  const uniform = typeof w === "number" ? w : perSide ? Number(w.top ?? 0) : typeof w === "string" ? w : 0;
  const sideValue = (k: "top" | "right" | "bottom" | "left") => (perSide ? Number(w[k] ?? 0) : typeof w === "number" ? w : 0);
  const setSide = (k: "top" | "right" | "bottom" | "left", v: number) =>
    set(ids, { strokeWidth: { top: sideValue("top"), right: sideValue("right"), bottom: sideValue("bottom"), left: sideValue("left"), [k]: Math.max(0, v) } });
  const toggleSides = (on: boolean) => {
    setEach(on);
    if (on && !perSide) set(ids, { strokeWidth: { top: Number(uniform) || 0, right: Number(uniform) || 0, bottom: Number(uniform) || 0, left: Number(uniform) || 0 } });
    if (!on && perSide) set(ids, { strokeWidth: sideValue("top") });
  };
  const joinIcon = (j: string) => <span className={cx("inline-block h-3 w-3 border-t-2 border-l-2 border-current", j === "round" && "rounded-tl-[6px]", j === "bevel" && "[clip-path:polygon(0_40%,40%_0,100%_0,100%_100%,0_100%)]")} />;
  const capIcon = (c: string) => <span className={cx("inline-block h-2 w-4 border-2 border-current", c === "round" && "rounded-full", c === "butt" && "border-r-0")} />;
  return (
    <Section
      title="Stroke"
      action={
        <button
          type="button"
          aria-label="Add stroke"
          className="hover:text-foreground"
          // A first stroke is black, 1 wide, inside (as in Pen).
          onClick={() => set(ids, paints.length ? ({ stroke: fromList([...paints, "#000000"]) } as never) : { stroke: "#000000", strokeWidth: 1, strokeAlignment: "inner" })}
        >
          <Plus size={16} strokeWidth={1.5} />
        </button>
      }
    >
      {paints.length > 0 && (
        <>
          <PaintList
            paints={paints}
            onChange={(list) => set(ids, list.length ? ({ stroke: fromList(list) } as never) : ({ stroke: null, strokeWidth: null, strokeAlignment: null, strokeLinejoin: null, strokeLinecap: null } as never))}
          />
          <div className="grid grid-cols-2 gap-[6px]">
            <Label>Position</Label>
            <Label>Weight</Label>
            <Dropdown
              value={p.strokeAlignment ?? "center"}
              onChange={(a) => set(ids, { strokeAlignment: a === "center" ? null : a } as never)}
              options={[
                { value: "center", label: "Center" },
                { value: "inner", label: "Inside" },
                { value: "outer", label: "Outside" },
              ]}
            />
            <div className="flex gap-[6px]">
              <NumberField lead="W" disabled={each} value={each ? "Mixed" : shown(uniform)} onCommit={(v) => set(ids, { strokeWidth: Math.max(0, v) })} />
              <SideToggle on={each} onChange={toggleSides} label="Independent sides" />
            </div>
          </div>
          {each && (
            <div className="grid grid-cols-2 gap-[6px]">
              {(["top", "right", "bottom", "left"] as const).map((k) => (
                <NumberField key={k} title={k[0]!.toUpperCase() + k.slice(1)} lead={k[0]!.toUpperCase()} value={sideValue(k)} onCommit={(v) => setSide(k, v)} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-[6px]">
            <Label>Join</Label>
            <Label>Cap</Label>
            <Dropdown
              iconOnly
              value={p.strokeLinejoin ?? "miter"}
              onChange={(j) => set(ids, { strokeLinejoin: j === "miter" ? null : j } as never)}
              options={(["miter", "round", "bevel"] as const).map((j) => ({ value: j, label: j[0]!.toUpperCase() + j.slice(1), icon: joinIcon(j) }))}
            />
            <Dropdown
              iconOnly
              value={p.strokeLinecap ?? "butt"}
              onChange={(c) => set(ids, { strokeLinecap: c === "butt" ? null : c } as never)}
              options={[
                { value: "butt" as const, label: "None", icon: capIcon("butt") },
                { value: "round" as const, label: "Round", icon: capIcon("round") },
                { value: "square" as const, label: "Square", icon: capIcon("square") },
              ]}
            />
          </div>
        </>
      )}
    </Section>
  );
}

function Typography({ node, ids }: { node: TreeNode; ids: string[] }) {
  const p = node.props;
  const family = typeof p.fontFamily === "string" ? p.fontFamily : "Inter";
  const italic = p.fontStyle === "italic";
  const weight = typeof p.fontWeight === "string" && p.fontWeight.startsWith("$") ? undefined : weightOf(p.fontWeight);
  // The family's styles ("400", "700i", …) as weight choices, upright then italic.
  const styles = (engine.fonts.styles(family) ?? ["400"]).slice().sort((a, b) => Number(a.endsWith("i")) - Number(b.endsWith("i")) || parseInt(a) - parseInt(b));
  const current = weight === undefined ? undefined : `${weight}${italic ? "i" : ""}`;
  const options = styles.map((s) => {
    const w = parseInt(s, 10);
    return { value: s, label: `${WEIGHT_NAMES[w] ?? w}${s.endsWith("i") ? " Italic" : ""}` };
  });
  if (current && !styles.includes(current)) options.push({ value: current, label: `${WEIGHT_NAMES[weight!] ?? weight}${italic ? " Italic" : ""}` });
  return (
    <Section title="Typography">
      <FontPicker value={family} onChange={(fontFamily) => set(ids, { fontFamily })} />
      <div className="grid grid-cols-2 gap-[6px]">
        <Dropdown value={current} options={options} onChange={(s) => set(ids, { fontWeight: String(parseInt(s, 10)), fontStyle: s.endsWith("i") ? "italic" : null } as never)} />
        <NumberField lead="Aa" title="Font size" value={shown(p.fontSize, 14)} onCommit={(fontSize) => set(ids, { fontSize: Math.max(1, fontSize) })} />
        <Label>Line height</Label>
        <Label>Letter spacing</Label>
        <NumberField
          lead="↕"
          title="Line height"
          value={typeof p.lineHeight === "number" ? `${Math.round(p.lineHeight * 100)}%` : (p.lineHeight ?? "Auto")}
          onCommit={(v) => set(ids, { lineHeight: Math.round(v) / 100 })}
        />
        <NumberField lead="|A|" title="Letter spacing" value={typeof p.letterSpacing === "number" ? `${p.letterSpacing}px` : (p.letterSpacing ?? "0px")} onCommit={(letterSpacing) => set(ids, { letterSpacing })} />
        <Label>Horizontal</Label>
        <Label>Vertical</Label>
        <Segmented
          value={p.textAlign ?? "left"}
          onChange={(textAlign) => set(ids, { textAlign })}
          options={[
            { value: "left", icon: AlignLeft, label: "Left" },
            { value: "center", icon: AlignCenter, label: "Centre" },
            { value: "right", icon: AlignRight, label: "Right" },
            { value: "justify", icon: AlignJustify, label: "Justify" },
          ]}
        />
        <Segmented
          value={p.textAlignVertical ?? "top"}
          onChange={(textAlignVertical) => set(ids, { textAlignVertical })}
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

/** An icon's name and library. */
function IconSection({ node, ids }: { node: TreeNode; ids: string[] }) {
  const p = node.props;
  const [name, setName] = useState(String(p.icon ?? ""));
  return (
    <Section title="Icon">
      <label className={cx(FIELD, "focus-within:ring-1 focus-within:ring-[#3b82f6]")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() ? set(ids, { icon: name.trim() }) : setName(String(p.icon ?? "")))}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className="w-full bg-transparent outline-none"
        />
      </label>
      <Dropdown
        value={ICON_LIBRARIES.find((l) => l.toLowerCase() === String(p.library ?? "lucide").toLowerCase())}
        options={ICON_LIBRARIES.map((l) => ({ value: l, label: l }))}
        onChange={(library) => set(ids, { library })}
      />
    </Section>
  );
}

