// Comments, as Pen's: with the Comment tool (C) a click on the canvas places a pin and opens a box to
// write in; a pin (or its card in the panel) opens its thread (replies, Apply, resolve), and a press
// anywhere else closes it; the Comments panel takes the place of the properties panel and lists the
// open and resolved threads. Apply hands a comment to the agent. Pins show unless hidden (Shift+C, or
// the panel's eye). Sizes and colours are measured from Pen (dark theme).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, Check, Ellipsis, Eye, EyeOff, MessageCircle, Plus, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { toast } from "sonner";
import { addThread, reply, setResolved, threads, type CommentThread } from "../../doc/comments.js";
import * as docStore from "../../doc/store.js";
import { sendPrompt } from "../agent/chat.js";
import { follow, schedule, toScreen, view } from "../canvas/canvas.js";
import { bridge, currentScene, doc, edit } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island, cx } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";

/** The name comments are signed with. */
let me = "You";
void bridge.who().then((name) => (me = name || me));
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** "Now", "1 min ago", "6 mins ago", "1 hr ago", "2 days ago" (Pen writes "min"/"mins"). */
function when(at: number): string {
  const s = (Date.now() - at) / 1000;
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (s < 60) return "Now";
  if (s < 3600) return ago(Math.floor(s / 60), "min");
  if (s < 86400) return ago(Math.floor(s / 3600), "hr");
  return ago(Math.floor(s / 86400), "day");
}

function useThreads(): CommentThread[] {
  useEditor((s) => s.docVersion);
  return threads(doc);
}

/** Where a thread's pin is on the page: on its node (which it follows) or where it was put. */
function pinAt(t: { node?: string; x: number; y: number }): { x: number; y: number } | undefined {
  if (!t.node) return { x: t.x, y: t.y };
  const box = currentScene()?.boxes.get(t.node);
  return box ? { x: box.x + t.x, y: box.y + t.y } : undefined;
}

/**
 * Something kept at a place on the page (a pin, or its thread beside it): moved by the canvas as it
 * draws, in the same frame, so it never trails panning or zooming.
 */
function Pinned({ to, dx = 0, dy = 0, className, children }: { to: { node?: string; x: number; y: number }; dx?: number; dy?: number; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const target = useRef(to);
  target.current = to;
  useLayoutEffect(
    () =>
      follow(() => {
        const el = box.current;
        const at = pinAt(target.current);
        if (!el) return;
        el.style.display = at ? "" : "none";
        if (!at) return;
        const [x, y] = toScreen(at.x, at.y);
        el.style.transform = `translate(${x + dx}px, ${y + dy}px)`;
      }),
    [dx, dy],
  );
  return (
    <div ref={box} className={cx("absolute top-0 left-0", className)}>
      {children}
    </div>
  );
}

/** Hands a comment (or several) to the agent, with the node it is on. */
function apply(list: CommentThread[]) {
  const lines = list.map((t) => {
    const name = t.node && docStore.exists(doc, t.node) ? (docStore.propsOf(doc, t.node).name ?? t.node) : null;
    const text = t.messages.map((m) => m.text).join("\n");
    return name ? `On "${name}" (${t.node}): ${text}` : text;
  });
  sendPrompt(list.length > 1 ? `Apply this feedback:\n${lines.map((l) => `- ${l}`).join("\n")}` : `Apply this feedback: ${lines[0]}`);
}

function resolve(id: string) {
  edit(() => setResolved(doc, id, true));
  if (store.get().commentOpen === id) store.set({ commentOpen: null });
  toast("Comment resolved");
}

/** A small avatar in a thread or a card: grey with the author's initial in white, as Pen's. */
function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-[#8e8f91] text-white" style={{ width: size, height: size, fontSize: Math.round(size / 2) }}>
      {initialOf(name)}
    </span>
  );
}

/** A pin on the canvas: Pen's white 26px disc with a dark ring and the author's initial, centred on its place. */
function PinMark({ name }: { name: string }) {
  return (
    <span className="flex h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#323235] bg-white text-[12px] text-[#515153]">
      {initialOf(name)}
    </span>
  );
}

/** Takes the focus, again for a few frames: the canvas press that opened a box moves it after mount. */
function useFocusSoon(field: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    let frame = 0;
    let left = 10;
    const take = () => {
      if (field.current && document.activeElement !== field.current) field.current.focus();
      if (--left > 0) frame = requestAnimationFrame(take);
    };
    take();
    return () => cancelAnimationFrame(frame);
  }, [field]);
}

/** Pen's + (attachments, not in Lemon yet) and round send button. */
function SendButtons({ ready, onSend }: { ready: boolean; onSend: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="flex h-5 w-4 items-center justify-center text-muted-foreground">
        <Plus size={13} strokeWidth={1.5} />
      </span>
      <button
        type="button"
        aria-label="Send"
        disabled={!ready}
        onClick={onSend}
        className={cx("flex h-5 w-5 items-center justify-center rounded-full", ready ? "bg-popover-foreground text-popover" : "bg-island-ring text-muted-foreground/70")}
      >
        <ArrowUp size={11} strokeWidth={2} />
      </button>
    </span>
  );
}

/**
 * A text box with Pen's + and send buttons: two lines with the buttons below (a new comment) or one
 * row (a reply). Enter sends, Shift+Enter starts a line, Escape gives up.
 */
function Composer({ placeholder, inline = false, onSend, onCancel }: { placeholder: string; inline?: boolean; onSend: (text: string) => void; onCancel?: () => void }) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  useFocusSoon(field);
  const send = () => text.trim() && (onSend(text.trim()), setText(""));
  const input = (
    <textarea
      ref={field}
      rows={inline ? 1 : 2}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), send());
        else if (e.key === "Escape") onCancel?.();
      }}
      className="min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-[20px] text-popover-foreground outline-none placeholder:text-muted-foreground"
    />
  );
  return inline ? (
    <div className="flex h-[47px] items-center gap-2 px-[15px]">
      {input}
      <SendButtons ready={!!text.trim()} onSend={send} />
    </div>
  ) : (
    <div className="flex h-[96px] flex-col px-[15px] py-[10px]">
      {input}
      <span className="mt-auto flex justify-end">
        <SendButtons ready={!!text.trim()} onSend={send} />
      </span>
    </div>
  );
}

/** A thread's box beside its pin: Pen puts it 25px right of the pin's middle and 24px above it. */
const BOX_DX = 25;
const BOX_DY = -24;
const BOX = "z-30 w-[340px] overflow-hidden rounded-[10px] border border-island-ring/60 bg-popover shadow-island";
/** Pen's small bordered buttons (Apply, resolve) in threads and cards. */
const SMALL = "flex items-center justify-center rounded-[6px] border border-island-ring/60 bg-island-ring/40 text-popover-foreground hover:bg-island-ring";

/** Moves the view the least it takes to show a pin clear of the rail, the top bar and the panel (as Pen does). */
function reveal(t: CommentThread): void {
  const at = pinAt(t);
  const canvas = document.querySelector("canvas");
  if (!at || !canvas) return;
  const area = canvas.getBoundingClientRect();
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const MARGIN = 32;
  const left = (rect("[data-rail]")?.right ?? area.left) - area.left + MARGIN;
  const top = (rect("[data-topbar]")?.bottom ?? area.top) - area.top + MARGIN;
  const right = (rect("[data-comments]")?.left ?? area.right) - area.left - MARGIN;
  const bottom = area.height - MARGIN;
  const [x, y] = toScreen(at.x, at.y);
  const dx = x < left ? x - left : x > right ? x - right : 0;
  const dy = y < top ? y - top : y > bottom ? y - bottom : 0;
  if (!dx && !dy) return;
  view.x += dx / view.zoom;
  view.y += dy / view.zoom;
  schedule();
}

/** Opens a thread, from its pin or its card in the panel, bringing the pin into view. */
export function openThread(t: CommentThread): void {
  if (t.resolved) return;
  store.set({ commentOpen: t.id, commentDraft: null });
  reveal(t);
}

/** The pins on the canvas, the box for a new comment and the thread of the pin clicked. */
export function CommentLayer() {
  const list = useThreads();
  const tool = useEditor((s) => s.tool);
  const shown = useEditor((s) => s.showComments);
  const draft = useEditor((s) => s.commentDraft);
  const open = useEditor((s) => s.commentOpen);
  const visible = list.filter((t) => !t.resolved && (shown || tool === "comment"));
  // A press anywhere but a pin, a thread, the panel or a menu closes the thread or the new comment. The
  // canvas closes them itself, so that the same press doesn't also start a new comment.
  useEffect(() => {
    if (!open && !draft) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-comment-ui], [data-radix-popper-content-wrapper]")) return;
      if (t.tagName === "CANVAS" && store.get().tool === "comment") return;
      store.set({ commentOpen: null, commentDraft: null });
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open, draft]);
  // Pins sit on the canvas, under the panels (this layer comes before them); a thread goes over them.
  return (
    <>
      {visible.map((t) => {
        const isOpen = open === t.id;
        return (
          <div key={t.id} className="contents">
            <Pinned to={t}>
              <button type="button" data-comment-ui title={t.messages.at(-1)?.text} onClick={() => (isOpen ? store.set({ commentOpen: null }) : openThread(t))} className="block rounded-full">
                <PinMark name={t.messages[0]?.author ?? me} />
              </button>
            </Pinned>
            {isOpen && (
              <Pinned to={t} dx={BOX_DX} dy={BOX_DY} className={BOX}>
                <div data-comment-ui>
                  <div className="flex h-[46px] items-center gap-2 border-b border-island-ring/40 pr-[11px] pl-[15px]">
                    <span className="flex-1 text-[13px] text-muted-foreground">
                      {t.messages.length} comment{t.messages.length > 1 ? "s" : ""}
                    </span>
                    <button type="button" onClick={() => apply([t])} className={cx(SMALL, "h-[27px] gap-1.5 px-2.5 text-[13px] font-semibold")}>
                      <Sparkles size={13} strokeWidth={1.5} /> Apply
                    </button>
                    <button type="button" aria-label="Resolve" onClick={() => resolve(t.id)} className={cx(SMALL, "h-[27px] w-[27px]")}>
                      <Check size={13} strokeWidth={1.75} />
                    </button>
                  </div>
                  <div className="max-h-[260px] overflow-y-auto border-b border-island-ring/40">
                    {t.messages.map((m, i) => (
                      <div key={i} className="px-[15px] py-3">
                        <div className="flex items-center gap-1 text-[13px]">
                          <span className="truncate font-semibold text-popover-foreground">{m.author}</span>
                          <span className="shrink-0 text-muted-foreground">· {when(m.at)}</span>
                          <span className="ml-auto pl-2">
                            <Avatar name={m.author} />
                          </span>
                        </div>
                        <p className="mt-1 text-[13px] font-medium whitespace-pre-wrap text-popover-foreground">{m.text}</p>
                      </div>
                    ))}
                  </div>
                  <Composer key={t.id} inline placeholder="Reply..." onSend={(text) => edit(() => reply(doc, t.id, { author: me, at: Date.now(), text }))} onCancel={() => store.set({ commentOpen: null })} />
                </div>
              </Pinned>
            )}
          </div>
        );
      })}
      {draft && (
        <>
          <Pinned to={draft}>
            <PinMark name={me} />
          </Pinned>
          <Pinned to={draft} dx={BOX_DX} dy={BOX_DY} className={BOX}>
            <div data-comment-ui>
              <Composer
                placeholder="Leave feedback..."
                onSend={(text) => {
                  edit(() => addThread(doc, draft, { author: me, at: Date.now(), text }));
                  store.set({ commentDraft: null });
                }}
                onCancel={() => store.set({ commentDraft: null })}
              />
            </div>
          </Pinned>
        </>
      )}
    </>
  );
}

/** The Comments panel's width: Pen's is wider than its properties panel. */
export const COMMENTS_PANEL_WIDTH = 280;

/** The Comments panel (in the properties panel's place while the Comment tool is on). */
export function CommentsPanel() {
  const list = useThreads();
  const shown = useEditor((s) => s.showComments);
  const current = useEditor((s) => s.commentOpen);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const open = list.filter((t) => !t.resolved);
  const resolved = list.filter((t) => t.resolved);
  const rows = tab === "open" ? open : resolved;
  const icon = "flex h-7 w-7 items-center justify-center rounded-[6px] text-foreground hover:bg-foreground/5";
  return (
    <Island data-comments data-comment-ui className="absolute top-[59px] right-2 bottom-[9px] flex flex-col overflow-hidden" style={{ width: COMMENTS_PANEL_WIDTH }}>
      <div className="flex h-[44px] shrink-0 items-center gap-1 pr-2 pl-3">
        <span className="flex-1 text-[13px] font-semibold text-popover-foreground">Comments</span>
        <button type="button" aria-label={shown ? "Hide comments" : "Show comments"} onClick={() => store.set({ showComments: !shown })} className={icon}>
          {shown ? <Eye size={16} strokeWidth={1.5} /> : <EyeOff size={16} strokeWidth={1.5} />}
        </button>
        <button type="button" aria-label="Refresh" onClick={() => void bridge.reloadComments()} className={icon}>
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
        <M.Root>
          <M.Trigger asChild>
            <button type="button" aria-label="More" className={icon}>
              <Ellipsis size={16} strokeWidth={1.5} />
            </button>
          </M.Trigger>
          <MenuContent align="end" className="min-w-[230px]">
            <MenuLabel caps={false}>Apply mode</MenuLabel>
            <MenuItem label="Apply with AI" hint="Apply feedback to the targeted nodes" checked />
            {/* Lemon can't apply feedback to copies yet. */}
            <MenuItem label="Apply with AI on copies" hint="No nodes to copy" disabled />
            <MenuSeparator />
            <MenuItem label="Resolve all" disabled={!open.length} onSelect={() => (edit(() => open.forEach((t) => setResolved(doc, t.id, true))), toast("Comments resolved"))} />
          </MenuContent>
        </M.Root>
      </div>
      <div className="mx-3 grid shrink-0 grid-cols-2 text-[12px]">
        {(
          [
            ["open", "Open", open.length],
            ["resolved", "Resolved", resolved.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cx("h-[25px] rounded-[6px] font-medium", tab === k ? "bg-input text-popover-foreground" : "text-muted-foreground hover:text-popover-foreground")}
          >
            {label} {n > 0 && <span className="text-muted-foreground">{n}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-[18px]">
        {!rows.length ? (
          <div className="mt-6 flex flex-col items-center gap-1 px-3 text-center text-[12px]">
            <MessageCircle size={16} strokeWidth={1.5} className="mb-1 text-muted-foreground" />
            <span className="font-semibold text-popover-foreground">{tab === "open" ? (list.length ? "No open comments" : "No comments yet") : "No resolved comments"}</span>
            <span className="text-muted-foreground">Click anywhere on the canvas to leave one.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 border-b border-island-ring/40 px-3 pb-[9px]">
            {rows.map((t) => {
              const first = t.messages[0]!;
              return (
                <div
                  key={t.id}
                  onClick={() => openThread(t)}
                  className={cx("cursor-default rounded-[10px] border bg-island-ring/40 p-[12px]", current === t.id ? "border-foreground/40" : "border-island-ring")}
                >
                  <div className="flex items-center gap-1 text-[12px]">
                    <span className="truncate font-semibold text-foreground">{first.author}</span>
                    <span className="shrink-0 text-muted-foreground">· {when(first.at)}</span>
                    <span className="ml-auto pl-2">
                      <Avatar name={first.author} />
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] whitespace-pre-wrap text-foreground">{t.messages.map((m) => m.text).join("\n")}</p>
                  <div className="mt-2.5 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {t.resolved ? (
                      <button type="button" aria-label="Reopen" onClick={() => edit(() => setResolved(doc, t.id, false))} className={cx(SMALL, "h-[26px] w-[27px]")}>
                        <RotateCcw size={12} strokeWidth={1.5} />
                      </button>
                    ) : (
                      <>
                        <button type="button" onClick={() => apply([t])} className={cx(SMALL, "h-[26px] gap-1.5 px-2.5 text-[12px] text-foreground")}>
                          <Sparkles size={12} strokeWidth={1.5} /> Apply
                        </button>
                        <button type="button" aria-label="Resolve" onClick={() => resolve(t.id)} className={cx(SMALL, "h-[26px] w-[27px]")}>
                          <Check size={12} strokeWidth={1.75} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tab === "open" && open.length > 0 && (
          <div className="px-3 pt-[11px] pb-3">
            <button type="button" onClick={() => apply(open)} className="flex h-[33px] w-full items-center justify-center gap-1.5 rounded-[8px] bg-white text-[13px] font-semibold text-zinc-900 hover:bg-zinc-200">
              <Sparkles size={13} strokeWidth={1.5} /> Apply all ({open.length})
            </button>
          </div>
        )}
      </div>
    </Island>
  );
}

/** Where the Comment tool clicked: on the deepest node there (the pin follows it) or on the page. */
export function startComment(at: { x: number; y: number }, nodeId: string | null): void {
  const box = nodeId ? currentScene()?.boxes.get(nodeId) : undefined;
  store.set({
    commentOpen: null,
    commentDraft: box && nodeId && docStore.exists(doc, nodeId) ? { node: nodeId, x: at.x - box.x, y: at.y - box.y } : { x: at.x, y: at.y },
  });
}
