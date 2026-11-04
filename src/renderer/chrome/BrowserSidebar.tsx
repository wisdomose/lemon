// The integrated browser, as Pen's: a panel at the right of the window with a live web page (rendered
// by the host, main/browser-pages.ts, and drawn here), its toolbar — element picker, back, forward,
// reload, the address with its history, device and × buttons, Import, screenshot, expand, more and
// close — and, with no page open, Pen's "Import from the web" start with the recent addresses. The
// element picker marks an element in the page: its breadcrumbs show under the toolbar, its look in a
// bar at the bottom, and it becomes a reference in the prompt. Measured from Pen at 1:1 (2 Nov 2026).
import { useEffect, useRef, useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  Camera,
  CaseSensitive,
  ChevronRight,
  Code,
  Crosshair,
  Ellipsis,
  Frame,
  GalleryVerticalEnd,
  Globe,
  GripHorizontal,
  Laptop,
  Lock,
  Maximize2,
  Minimize2,
  PanelRight,
  RotateCw,
  Smartphone,
  SquareMousePointer,
  Tablet,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { PickInfo, SidebarState } from "../../main/browser-pages.js";
import type { PageShot } from "../../agent/browser-tool.js";
import { ROOT_ID } from "../../doc/schema.js";
import * as docStore from "../../doc/store.js";
import { assetsOf, putAsset } from "../../doc/assets.js";
import { emptySpot, GAP_BETWEEN_FRAMES } from "../../layout/space.js";
import { zoomToFit } from "../canvas/canvas.js";
import { bridge, currentScene, doc, edit } from "../scene.js";
import { store, useEditor } from "../store.js";
import { ICON, Island, cx } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuSeparator } from "../ui/menu.js";
import { heldPage, onPageFrame, pageCursor, pageKey } from "../canvas/live-pages.js";

/** The sidebar's id among the host's pages. */
const SIDEBAR = "sidebar";
/** Its width, border included, as in Pen. */
export const SIDEBAR_WIDTH = 480;
/** Pen's picker blue. */
const PICK_BLUE = "#3799F2";
/** Room Pen leaves between the canvas's content and a screenshot put beside it. */
const SHOT_GAP = 40;

/** How far from the window's right the right-hand panels sit: left of the sidebar while it is open, as in Pen. */
export function useRightInset(): number {
  return useEditor((st) => (st.sidebar?.open ? 8 + SIDEBAR_WIDTH + 8 : 8));
}

/** Starts following the host's sidebar state. */
export function startSidebar(): void {
  bridge.browser.onSidebar((sidebar) => store.set({ sidebar }));
  void bridge.browser.sidebar("state").then((sidebar) => sidebar && store.set({ sidebar }));
}

/** Shows or hides the sidebar (the top bar's globe, its own close button, the palette). */
export function toggleSidebar(open = !store.get().sidebar?.open): void {
  void bridge.browser.sidebar(open ? "show" : "hide");
}

/** Opens an address in the sidebar (from the chat's links). */
export function openInSidebar(url: string): void {
  void bridge.browser.sidebar("open", url);
}

/** "https://chat-buddy.xyz/chart" → "chat-buddy.xyz/chart", as Pen lists addresses. */
export const shortUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

const DEVICE_ICONS: Record<SidebarState["device"], LucideIcon> = { laptop: Laptop, phone: Smartphone, tablet: Tablet };

export function BrowserSidebar() {
  const s = useEditor((st) => st.sidebar);
  const panelOpen = useEditor((st) => st.panelOpen);
  // The grip under the page sets the page's height; the panel keeps its own below it (as in Pen).
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  if (!s?.open) return null;
  const page = s.url !== null;
  const pick = page ? s.pick : null;
  // Expanded, it covers the canvas from the left column (or the window's edge) to the right.
  const place = s.expanded ? { left: panelOpen ? 394 : 8 } : { width: SIDEBAR_WIDTH };
  const grip = (e: React.MouseEvent) => {
    const top = pageBox.current?.getBoundingClientRect().top;
    const panel = pageBox.current?.closest("[data-browser-sidebar]")?.getBoundingClientRect();
    if (top === undefined || !panel) return;
    e.preventDefault();
    // As far down as the panel allows (less the grip and the style bar); there, the page fills it again.
    const most = panel.bottom - top - 16 - (pick ? 30 : 0);
    const move = (m: MouseEvent) => {
      const h = m.clientY - top;
      setPageHeight(h >= most - 4 ? null : Math.max(120, h));
    };
    const up = () => (removeEventListener("mousemove", move), removeEventListener("mouseup", up));
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  };
  return (
    <Island data-browser-sidebar className="absolute top-[58px] right-2 bottom-2 flex flex-col overflow-hidden" style={place}>
      <Toolbar s={s} page={page} />
      {pick && <Crumbs pick={pick} />}
      <div className="h-px shrink-0 bg-[#202020]" />
      <div ref={pageBox} className={cx("flex min-h-0 flex-col", pageHeight === null && "flex-1")} style={pageHeight === null ? undefined : { height: pageHeight }}>
        {page ? <PageView s={s} /> : <Start recent={s.recent} />}
      </div>
      <div className="h-px shrink-0 bg-[#202020]" />
      <div onMouseDown={grip} className="flex h-[14px] shrink-0 cursor-row-resize items-center justify-center text-[#626270]">
        <GripHorizontal size={12} strokeWidth={2} />
      </div>
      {pick && <StyleBar pick={pick} />}
      {pageHeight !== null && <div className="flex-1" />}
    </Island>
  );
}

/** The picked element's ancestry, Pen's breadcrumbs: a click picks that ancestor instead. */
function Crumbs({ pick }: { pick: PickInfo }) {
  return (
    <div className="flex h-[22px] shrink-0 items-center overflow-hidden px-[8px] text-[11px] whitespace-nowrap text-muted-foreground">
      {pick.crumbs.map((c, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <ChevronRight size={10} strokeWidth={1.5} className="mx-[2px] shrink-0 opacity-60" />}
          <button
            type="button"
            onClick={() => void bridge.browser.sidebar("pick", { index: i })}
            className={cx("rounded-[3px] px-[2px] hover:text-foreground", i === pick.index && "bg-foreground/15 text-foreground")}
          >
            {i === pick.index ? `${c.tag}${c.classes.map((k) => `.${k}`).join("")} · ${pick.width}×${pick.height}` : c.tag}
          </button>
        </span>
      ))}
    </div>
  );
}

/** The picked element's look, Pen's bar under the grip: size and flex, position, and its text's font. */
function StyleBar({ pick }: { pick: PickInfo }) {
  const item = "flex items-center gap-[4px]";
  const icon = { size: 12, strokeWidth: 1.5, className: "shrink-0 text-muted-foreground" };
  return (
    <div className="flex h-[30px] shrink-0 items-center gap-[10px] overflow-hidden px-[8px] text-[11px] whitespace-nowrap text-foreground">
      <span className="flex items-center gap-[8px]">
        <span className="font-semibold">Style</span>
        <span className="text-muted-foreground">Class</span>
      </span>
      <span className={item}>
        <Frame {...icon} />
        {pick.width} <span className="text-muted-foreground">×</span> {pick.height} <span className="ml-1">{pick.flex}</span>
      </span>
      <span className={item}>
        <Crosshair {...icon} />
        <span className="text-muted-foreground">X</span>
        {pick.x} <span className="text-muted-foreground">Y</span>
        {pick.y}
      </span>
      {pick.text && (
        <>
          <span className={item}>
            <Type {...icon} />
            {pick.text.font}
          </span>
          <span className={item}>
            <span className="h-[12px] w-[12px] shrink-0 rounded-[2px] border border-input" style={{ background: pick.text.color }} />
            {pick.text.color}
          </span>
          <span className={item}>
            <CaseSensitive {...icon} />
            {pick.text.size}
          </span>
          <span className={item}>
            <Bold {...icon} />
            {pick.text.weight}
          </span>
        </>
      )}
    </div>
  );
}

/** Pen's Import: the page (or the picked element) as editable layers beside what is there, then shown. */
async function importToCanvas(mode: "full" | "pick"): Promise<void> {
  const imported = await bridge.browser.importable(mode).catch((e: unknown) => (toast.error(e instanceof Error ? e.message : String(e)), undefined));
  const s = currentScene();
  if (!imported || !s) return;
  const spot = emptySpot(s.tree, s.boxes);
  const at = s.tree.children.length ? { x: spot.x - GAP_BETWEEN_FRAMES + SHOT_GAP, y: spot.y } : spot;
  let id = "";
  edit(() => {
    for (const p of imported.pictures) putAsset(doc, p.url, new Uint8Array(p.bytes));
    id = docStore.insert(doc, ROOT_ID, { ...imported.node, x: at.x, y: at.y } as never);
  });
  store.set({ selection: [id] });
  requestAnimationFrame(() => {
    const box = currentScene()?.boxes.get(id);
    if (box) zoomToFit(true, box, 1);
  });
}

/**
 * Puts a picture of the sidebar's page on the canvas as Pen does: a rectangle named after the page,
 * beside what is there, filled white under the picture (kept as images/screenshot-<host>.png), and
 * shows it.
 */
async function screenshotToCanvas(mode: "full" | "visible" | "pick"): Promise<void> {
  const shot: PageShot | undefined = await bridge.browser.capture(mode);
  const s = currentScene();
  if (!shot || !s) return;
  let host = "page";
  try {
    host = new URL(shot.url).hostname || host;
  } catch {}
  const taken = assetsOf(doc);
  let url = `images/screenshot-${host}.png`;
  for (let n = 1; taken.has(url); n++) url = `images/screenshot-${host}-${n}.png`;
  // Beside the content, 40 apart rather than a new frame's 120.
  const spot = emptySpot(s.tree, s.boxes);
  const at = s.tree.children.length ? { x: spot.x - GAP_BETWEEN_FRAMES + SHOT_GAP, y: spot.y } : spot;
  let id = "";
  edit(() => {
    putAsset(doc, url, new Uint8Array(shot.png));
    id = docStore.insert(doc, ROOT_ID, {
      type: "rectangle",
      name: shot.title || host,
      x: at.x,
      y: at.y,
      width: shot.width,
      height: shot.height,
      fill: ["#ffffff", { type: "image", enabled: true, url, mode: "cover" }],
    } as never);
  });
  toast.success("Screenshot added to the canvas.");
  requestAnimationFrame(() => {
    const box = currentScene()?.boxes.get(id);
    if (box) zoomToFit(true, box, 1);
  });
}

function ToolButton({
  icon: Icon,
  label,
  disabled,
  active,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        disabled ? "opacity-40" : "hover:bg-foreground/10 hover:text-foreground",
        active && "bg-foreground/10 text-foreground",
        className,
      )}
    >
      <Icon {...ICON} />
    </button>
  );
}

function Toolbar({ s, page }: { s: SidebarState; page: boolean }) {
  const act = (a: Parameters<typeof bridge.browser.sidebar>[0]) => () => void bridge.browser.sidebar(a);
  const Device = DEVICE_ICONS[s.device];
  const picking = useEditor((st) => st.browserPicking);
  const pickNow = (on: boolean) => {
    store.set({ browserPicking: on });
    // Turning the picker off lets go of the picked element too (as in Pen).
    if (!on) void bridge.browser.sidebar("pick", null);
  };
  return (
    <div className="flex h-[41px] shrink-0 items-center pr-[7px] pl-[6px]">
      <ToolButton icon={SquareMousePointer} label="Pick an element" disabled={!page} active={picking && page} onClick={() => pickNow(!picking)} />
      <ToolButton icon={ArrowLeft} label="Back" disabled={!s.canBack} onClick={act("back")} className="ml-[4px]" />
      <ToolButton icon={ArrowRight} label="Forward" disabled={!s.canForward} onClick={act("forward")} className="ml-[2px]" />
      <ToolButton icon={RotateCw} label="Reload" disabled={!page} onClick={act("reload")} className="ml-[2px]" />
      <Address s={s} page={page} Device={Device} />
      {/* The page (or the picked element) as editable layers. */}
      <button
        type="button"
        disabled={!page}
        onClick={() => void importToCanvas(s.pick ? "pick" : "full")}
        className={cx("ml-[14px] h-7 w-[62px] shrink-0 rounded-[8px] text-[13px] font-medium", page ? "bg-[#FAFAFA] text-[#18181B] hover:bg-white" : "bg-foreground/10 text-muted-foreground")}
      >
        Import
      </button>
      <Screenshot page={page} picked={!!s.pick} />
      <div className="mx-[10px] h-4 w-px shrink-0 bg-[#4F4F51]" />
      <ToolButton icon={s.expanded ? Minimize2 : Maximize2} label={s.expanded ? "Collapse" : "Expand"} active={s.expanded} onClick={() => void bridge.browser.sidebar("expand", !s.expanded)} />
      <MoreMenu s={s} page={page} />
      <ToolButton icon={PanelRight} label="Close Browser" onClick={() => toggleSidebar(false)} className="ml-[5px]" />
    </div>
  );
}

/** Pen's camera: the picked element straight onto the canvas, or a menu of the full page or what shows. */
function Screenshot({ page, picked }: { page: boolean; picked: boolean }) {
  const cls = "ml-[8px]";
  if (!page) return <ToolButton icon={Camera} label="Screenshot" disabled className={cls} />;
  const pickedShot = async () => {
    await screenshotToCanvas("pick");
    // Then the pick and the picker are let go, as in Pen.
    store.set({ browserPicking: false });
    void bridge.browser.sidebar("pick", null);
  };
  if (picked) return <ToolButton icon={Camera} label="Screenshot" onClick={() => void pickedShot()} className={cls} />;
  return (
    <M.Root>
      <M.Trigger asChild>
        <button type="button" aria-label="Screenshot" className={cx(cls, "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground data-[state=open]:bg-foreground/10")}>
          <Camera {...ICON} />
        </button>
      </M.Trigger>
      <MenuContent align="center">
        <MenuItem label="Full Page" onSelect={() => void screenshotToCanvas("full")} />
        <MenuItem label="Visible Area" onSelect={() => void screenshotToCanvas("visible")} />
      </MenuContent>
    </M.Root>
  );
}

/** The address pill: the history, the address itself, the device button and (with a page) ×. */
function Address({ s, page, Device }: { s: SidebarState; page: boolean; Device: LucideIcon }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setText(s.url ? shortUrl(s.url) : "");
  }, [s.url, editing]);
  // "Enter a URL" on the start puts the caret here.
  useEffect(() => {
    const focus = () => input.current?.focus();
    addEventListener("lemon:sidebar-address", focus);
    return () => removeEventListener("lemon:sidebar-address", focus);
  }, []);
  // A secure page shows a lock; either way the button opens the history (as in Pen).
  const Icon = page && !s.loading && s.url?.startsWith("https:") ? Lock : GalleryVerticalEnd;
  return (
    <div
      className={cx(
        "ml-[8px] flex h-7 items-center rounded-full bg-[#464749] pr-[4px] pl-[8px] focus-within:ring-1 focus-within:ring-[#76C3EB]",
        s.expanded ? "min-w-0 flex-1" : "w-[113px] shrink-0",
      )}
    >
      <M.Root>
        <M.Trigger asChild>
          <button type="button" aria-label="History" className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
            <Icon size={14} strokeWidth={1.5} />
          </button>
        </M.Trigger>
        <MenuContent align="start" className="min-w-[200px]">
          {s.recent.slice(0, 10).map((u) => (
            <MenuItem key={u} label={<span className="font-semibold">{shortUrl(u)}</span>} onSelect={() => openInSidebar(u)} />
          ))}
          {s.recent.length > 0 && <MenuSeparator />}
          <MenuItem label="Clear All History" danger disabled={!s.recent.length} onSelect={() => void bridge.browser.sidebar("clear-recent")} />
        </MenuContent>
      </M.Root>
      <input
        ref={input}
        value={text}
        spellCheck={false}
        aria-label="Address"
        onFocus={(e) => (setEditing(true), e.currentTarget.select())}
        onBlur={() => setEditing(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && text.trim()) (openInSidebar(text.trim()), e.currentTarget.blur());
          else if (e.key === "Escape") e.currentTarget.blur();
        }}
        // Pen's narrow address shows no text (not even while typing); expanded, it shows the address.
        className={cx("mx-1 h-full min-w-0 flex-1 bg-transparent text-[12px] font-medium outline-none", s.expanded ? "text-foreground" : "text-transparent caret-transparent")}
      />
      <button
        type="button"
        aria-label="Device"
        title="Device"
        onClick={() => void bridge.browser.sidebar("device")}
        className="flex h-[20px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[#535456] text-foreground"
      >
        <Device size={14} strokeWidth={1.5} className={s.device === "tablet" ? "rotate-90" : undefined} />
      </button>
      {page && (
        <button type="button" aria-label="Close page" onClick={() => void bridge.browser.sidebar("close-page")} className="ml-[3px] flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
          <X size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

function MoreMenu({ s, page }: { s: SidebarState; page: boolean }) {
  // Only a laptop page zooms; a phone or tablet keeps its device's scale (Pen greys these out there).
  const zoomable = page && s.device === "laptop";
  const act = (a: Parameters<typeof bridge.browser.sidebar>[0]) => () => void bridge.browser.sidebar(a);
  return (
    <M.Root>
      <M.Trigger asChild>
        <button type="button" aria-label="More" className="ml-[5px] flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground data-[state=open]:bg-foreground/10">
          <Ellipsis {...ICON} />
        </button>
      </M.Trigger>
      <MenuContent align="end">
        <MenuItem label="Zoom In" disabled={!zoomable} onSelect={act("zoom-in")} />
        <MenuItem label="Zoom Out" disabled={!zoomable} onSelect={act("zoom-out")} />
        <MenuItem label={`Zoom: ${Math.round(s.zoom * fit(s) * 100)}%`} disabled hint={<ChevronRight size={12} strokeWidth={1.5} />} />
        <MenuItem label="Reset Zoom to 100%" disabled={!zoomable} onSelect={act("zoom-reset")} />
        <MenuSeparator />
        <MenuItem label="Empty Cache and Reload" disabled={!page} onSelect={act("empty-cache")} />
        <MenuItem label="Open in System Browser" disabled={!page} onSelect={act("external")} />
      </MenuContent>
    </M.Root>
  );
}

/** How much the page is scaled to fit the sidebar (never enlarged). */
function fit(s: SidebarState, area = lastArea): number {
  return Math.min(1, area.width / s.width, area.height / s.height);
}
let lastArea = { width: 478, height: 858 };

/** The page itself: its picture scaled to fit and centred, taking the pointer, wheel and keys. */
function PageView({ s }: { s: SidebarState }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [area, setArea] = useState(lastArea);
  // Tell the host the page area's size: a laptop page is laid out at twice it.
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      lastArea = { width: Math.round(r.width), height: Math.round(r.height) };
      setArea(lastArea);
      void bridge.browser.sidebar("area", lastArea);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Draw the whole picture, then each changed part as it comes.
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const put = (pixels: Uint8Array, w: number, h: number, x: number, y: number) => {
      // A page that is still opening can paint before it has a size.
      if (w <= 0 || h <= 0 || pixels.length < w * h * 4) return;
      const img = ctx.createImageData(w, h);
      const d = img.data;
      // BGRA → RGBA.
      for (let i = 0; i < d.length; i += 4) (d[i] = pixels[i + 2]!), (d[i + 1] = pixels[i + 1]!), (d[i + 2] = pixels[i]!), (d[i + 3] = pixels[i + 3]!);
      ctx.putImageData(img, x, y);
    };
    const whole = () => {
      const h = heldPage(SIDEBAR);
      if (!h) return;
      if (c.width !== h.width || c.height !== h.height) (c.width = h.width), (c.height = h.height);
      put(h.pixels, h.width, h.height, 0, 0);
    };
    whole();
    const off = onPageFrame((id, f) => {
      if (id !== SIDEBAR) return;
      if (c.width !== f.width || c.height !== f.height) return whole();
      put(f.pixels, f.w, f.h, f.x, f.y);
    });
    // The pointer as the page wants it.
    let raf = 0;
    const cursor = () => ((c.style.cursor = pageCursor(SIDEBAR)), (raf = requestAnimationFrame(cursor)));
    raf = requestAnimationFrame(cursor);
    bridge.browser.repaint();
    return () => (off(), cancelAnimationFrame(raf));
  }, []);

  const k = fit(s, area);
  const w = s.width * k;
  const h = s.height * k;
  const at = (e: React.MouseEvent | React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) / k), y: Math.round((e.clientY - r.top) / k) };
  };
  const button = (b: number) => (b === 1 ? "middle" : b === 2 ? "right" : "left") as "left" | "middle" | "right";
  const picking = useEditor((st) => st.browserPicking);
  const left = (area.width - w) / 2;
  const top = (area.height - h) / 2;
  // The pick moves with the page: measure it again once scrolling stops.
  const refresh = useRef(0);
  const scrolled = () => {
    if (!s.pick) return;
    clearTimeout(refresh.current);
    refresh.current = window.setTimeout(() => void bridge.browser.sidebar("pick", "refresh"), 150);
  };
  const p = s.pick;
  // CSS pixels of the page → the sidebar.
  const css = k * s.zoom;
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-[#101418]">
      <canvas
        ref={canvas}
        tabIndex={0}
        className="absolute outline-none"
        style={{ width: w, height: h, left, top, cursor: picking ? "crosshair" : undefined }}
        onMouseDown={(e) => {
          canvas.current!.focus();
          // The picker takes the click instead of the page.
          if (picking) {
            const at0 = at(e);
            return void bridge.browser.sidebar("pick", { x: at0.x / s.zoom, y: at0.y / s.zoom });
          }
          bridge.browser.input(SIDEBAR, { type: "mouseDown", ...at(e), button: button(e.button), clickCount: e.detail || 1 });
        }}
        onMouseUp={(e) => picking || bridge.browser.input(SIDEBAR, { type: "mouseUp", ...at(e), button: button(e.button), clickCount: e.detail || 1 })}
        onMouseMove={(e) => picking || bridge.browser.input(SIDEBAR, { type: "mouseMove", ...at(e) })}
        onWheel={(e) => (bridge.browser.input(SIDEBAR, { type: "mouseWheel", ...at(e), deltaX: -e.deltaX, deltaY: -e.deltaY }), scrolled())}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape" && s.pick) return void bridge.browser.sidebar("pick", null);
          pageKey(SIDEBAR, e.nativeEvent, "keyDown");
        }}
        onKeyUp={(e) => (e.preventDefault(), e.stopPropagation(), pageKey(SIDEBAR, e.nativeEvent, "keyUp"))}
      />
      {p && (
        <div
          className="pointer-events-none absolute border"
          style={{ left: left + p.x * css, top: top + p.y * css, width: p.width * css, height: p.height * css, borderColor: PICK_BLUE }}
        >
          <span className="absolute top-0 left-0 rounded-[3px] px-[4px] text-[11px] leading-[16px] text-white" style={{ background: PICK_BLUE }}>
            {p.crumbs[p.index]?.tag}
          </span>
        </div>
      )}
    </div>
  );
}

/** No page open: Pen's "Import from the web", the three ways to import, and the recent addresses. */
function Start({ recent }: { recent: string[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 py-6">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-[12px] bg-[#D9D9D9] text-[#27272A]">
          <Globe size={22} strokeWidth={1.5} />
        </div>
        <div className="mt-[22px] text-[16px] leading-[20px] font-semibold text-foreground">Import from the web</div>
        <p className="mt-[10px] max-w-[410px] text-[15px] leading-[26px] text-muted-foreground">
          Open a live site or your localhost dev server, then bring it onto the canvas as editable layers.
        </p>
        <button
          type="button"
          onClick={() => dispatchEvent(new Event("lemon:sidebar-address"))}
          className="mt-[20px] flex h-[33px] items-center gap-2 rounded-[8px] border border-input bg-foreground/[0.03] pr-[12px] pl-[14px] text-[13px] font-semibold text-foreground hover:bg-foreground/[0.07]"
        >
          Enter a URL <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-[64px] grid grid-cols-3 gap-2 text-center">
        <Way icon={Code} title="Import the full page" text="Reproduce it as frames, text, and images." />
        <Way icon={SquareMousePointer} title="Import an element" text="Pick one element instead of the whole page." />
        <Way icon={Camera} title="Import a screenshot" text="Drop a PNG onto the canvas or send it to the agent." />
      </div>
      {recent.length > 0 && (
        <div className="mt-[36px]">
          <div className="flex items-center gap-2 px-[6px] text-[13px] font-semibold text-foreground">
            <GalleryVerticalEnd size={14} strokeWidth={1.5} className="text-muted-foreground" />
            Recent
            <button type="button" onClick={() => void bridge.browser.sidebar("clear-recent")} className="ml-auto text-[12px] font-normal text-muted-foreground hover:text-foreground">
              Clear All
            </button>
          </div>
          <div className="mt-[14px] flex flex-col gap-1.5">
            {recent.slice(0, 5).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => openInSidebar(u)}
                className="flex h-9 items-center gap-2 rounded-[8px] border border-input px-[12px] text-left text-[13px] font-semibold text-foreground hover:bg-foreground/5"
              >
                <Globe size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{shortUrl(u)}</span>
                <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="mt-[28px] px-4 text-center text-[11px] leading-[18px] text-muted-foreground">
        Privacy is our priority. We don't see your login credentials or session data. This is a Chromium-based browser running locally on your machine.
      </p>
    </div>
  );
}

function Way({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center px-1">
      <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-foreground/10 text-muted-foreground">
        <Icon size={14} strokeWidth={1.5} />
      </div>
      <div className="mt-[22px] text-[14px] leading-[20px] font-semibold text-foreground">{title}</div>
      <div className="mt-[8px] text-[14px] leading-[21px] text-muted-foreground">{text}</div>
    </div>
  );
}
