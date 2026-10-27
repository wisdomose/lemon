// Controls Pen shows on the canvas itself: a card's kind menu (a click on a selected card's header) and
// the address field of a browser node (when it is placed, or a click on its empty address bar).
import { useEffect, useRef, useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import * as docStore from "../../doc/store.js";
import type { NodeType, PenNode } from "../../doc/schema.js";
import { browserBar } from "../../render/draw.js";
import { currentScene, doc, edit } from "../scene.js";
import { store, useEditor } from "../store.js";
import { schedule, toScreen, view } from "../canvas/canvas.js";
import { MenuContent, MenuItem } from "../ui/menu.js";

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
