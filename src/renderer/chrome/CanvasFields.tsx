// Controls Pen shows on the canvas itself: a card's kind menu (a click on a selected card's header), the
// address field of a browser node (when it is placed, or a click on its empty address bar) and the bar
// over a browser page in use.
import { useEffect, useRef, useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { Camera, GripVertical, ImageDown, Monitor, Play, RotateCw } from "lucide-react";
import * as docStore from "../../doc/store.js";
import type { NodeType, PenNode } from "../../doc/schema.js";
import { browserBar } from "../../render/draw.js";
import { bridge, currentScene, doc, edit } from "../scene.js";
import { store, useEditor } from "../store.js";
import { schedule, toScreen, view } from "../canvas/canvas.js";
import { MenuContent, MenuItem } from "../ui/menu.js";
import { cx } from "../ui/kit.js";

const KINDS: { type: NodeType; label: string }[] = [
  { type: "note", label: "Note" },
  { type: "context", label: "Context" },
  { type: "prompt", label: "Prompt" },
];

/** Changes a card's kind; it keeps its place, size and text (only a prompt names a model). */
function setKind(id: string, type: NodeType) {
  if (!docStore.exists(doc, id) || docStore.typeOf(doc, id) === type) return;
  const props = { ...docStore.propsOf(doc, id) };
  if (type !== "prompt") delete props.model;
  let next = "";
  edit(() => (next = docStore.replace(doc, id, { ...props, type } as PenNode)));
  store.set({ selection: [next] });
  schedule();
}

/** The menu that changes a card's kind, opened under the click on its header. */
export function CardKindMenu() {
  const menu = useEditor((s) => s.cardMenu);
  const current = menu && docStore.exists(doc, menu.id) ? docStore.typeOf(doc, menu.id) : undefined;
  return (
    <M.Root open={!!menu && !!current} onOpenChange={(open) => !open && store.set({ cardMenu: null })}>
      <M.Trigger asChild>
        <span aria-hidden className="pointer-events-none fixed h-0 w-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
      </M.Trigger>
      <MenuContent align="start" sideOffset={2} className="min-w-[96px]">
        {KINDS.map((k) => (
          <MenuItem key={k.type} label={k.label} checked={k.type === current} onSelect={() => menu && setKind(menu.id, k.type)} />
        ))}
      </MenuContent>
    </M.Root>
  );
}

/**
 * Typing a browser node's address, over its address bar on the canvas. Enter goes to the address;
 * Escape or clicking away leaves it as it was.
 */
export function BrowserUrlField() {
  const id = useEditor((s) => s.urlEdit);
  const input = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; height: number; font: number } | null>(null);
  // The field follows the bar as the canvas pans and zooms.
  useEffect(() => {
    if (!id) return setPlace(null);
    let frame = 0;
    // The press that opened it still moves the focus to the page; the field takes it once that is over.
    let focused = false;
    const follow = () => {
      if (!focused && input.current) {
        input.current.focus();
        focused = document.activeElement === input.current;
      }
      const box = currentScene()?.boxes.get(id);
      if (!box || !docStore.exists(doc, id)) return store.set({ urlEdit: null });
      const bar = browserBar(box);
      const unit = bar.h / 86;
      const [x, y] = toScreen(bar.x + 88 * unit, bar.y + 12 * unit);
      setPlace({ left: x, top: y, width: (bar.w - 180 * unit) * view.zoom, height: (bar.h - 24 * unit) * view.zoom, font: 32 * unit * view.zoom });
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [id]);
  if (!id || !place) return null;
  const close = () => store.set({ urlEdit: null });
  return (
    <input
      ref={input}
      key={id}
      aria-label="Address"
      placeholder="Enter a URL"
      defaultValue={docStore.exists(doc, id) ? String(docStore.propsOf(doc, id).url ?? "") : ""}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          const url = e.currentTarget.value.trim();
          edit(() => docStore.update(doc, id, { url: url || null } as never));
          close();
          schedule();
        } else if (e.key === "Escape") close();
      }}
      onBlur={close}
      className="fixed bg-[#232426] text-[#d4d4d8] outline-none placeholder:text-[#656668]"
      style={{ left: place.left, top: place.top, width: place.width, height: place.height, fontSize: place.font }}
    />
  );
}

/** An address as Pen shows it: without "https://" and a closing "/". */
export const shownUrl = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/**
 * Pen's bar over a browser page in use: a grip, reload, the address, the device and play buttons and
 * an "Esc" badge (which stops using the page); under the page, its capture and Import buttons. Lemon
 * has no devices, preview, capture or import from a page yet, so those buttons do nothing.
 */
export function BrowserLiveBar() {
  const id = useEditor((s) => s.browserLive);
  useEditor((s) => s.docVersion);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!id) return setPlace(null);
    let frame = 0;
    const follow = () => {
      const box = currentScene()?.boxes.get(id);
      if (!box || !docStore.exists(doc, id)) return store.set({ browserLive: null });
      const [x, y] = toScreen(box.x, box.y);
      setPlace({ left: x, top: y, width: box.w * view.zoom, bottom: y + box.h * view.zoom });
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [id]);
  if (!id || !place || !docStore.exists(doc, id)) return null;
  const url = shownUrl(String(docStore.propsOf(doc, id).url ?? ""));
  const icon = "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground";
  return (
    <>
      <div
        className="fixed flex h-[29px] items-center gap-1.5 rounded-[8px] border border-input bg-[#1f2022] pr-1.5 pl-1 text-[12px] text-foreground"
        style={{ left: place.left, top: place.top - 35, width: place.width }}
      >
        <GripVertical size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
        <button type="button" aria-label="Reload" className={cx(icon, "hover:text-foreground")} onClick={() => void bridge.browser.command(id, "reload")}>
          <RotateCw size={12} strokeWidth={1.75} />
        </button>
        <span className="min-w-0 flex-1 truncate">{url}</span>
        <span className={icon} aria-hidden>
          <Monitor size={13} strokeWidth={1.5} />
        </span>
        <span className={icon} aria-hidden>
          <Play size={12} strokeWidth={1.5} />
        </span>
        <button type="button" onClick={() => store.set({ browserLive: null })} className="rounded-[4px] bg-input px-1.5 py-px text-[11px] text-muted-foreground hover:text-foreground">
          Esc
        </button>
      </div>
      <div className="fixed flex -translate-x-1/2 items-center gap-1" style={{ left: place.left + place.width / 2, top: place.bottom + 6 }}>
        <span aria-hidden className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-[#00C787] text-black">
          <ImageDown size={12} strokeWidth={1.75} />
        </span>
        <span aria-hidden className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] bg-[#00C787] text-black">
          <Camera size={12} strokeWidth={1.75} />
        </span>
        <span aria-hidden className="flex h-[22px] items-center rounded-[5px] bg-[#00C787] px-2 text-[12px] font-semibold text-black">Import</span>
      </div>
    </>
  );
}
