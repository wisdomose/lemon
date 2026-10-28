// Comments, as Pen's: with the Comment tool (C) a click on the canvas places a pin and opens a box to
// write in; a pin opens its thread (replies, Apply, resolve); the Comments panel takes the place of the
// properties panel and lists the open and resolved threads. Apply hands a comment to the agent. Pins
// show unless hidden (Shift+C, or the panel's eye).
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Ellipsis, Eye, EyeOff, MessageCircle, Plus, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { toast } from "sonner";
import { addThread, reply, setResolved, threads, type CommentThread } from "../../doc/comments.js";
import * as docStore from "../../doc/store.js";
import { sendPrompt } from "../agent/chat.js";
import { toScreen } from "../canvas/canvas.js";
import { bridge, currentScene, doc, edit } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island, cx } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";

/** The name comments are signed with. */
let me = "You";
void bridge.who().then((name) => (me = name || me));
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** "Now", "1 min ago", "3 hr ago", "2 d ago" (as Pen dates comments). */
function when(at: number): string {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return "Now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} d ago`;
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

/** Re-renders every frame while shown, so pins follow panning and zooming. */
function useFrames(on: boolean): void {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    let frame = requestAnimationFrame(function next() {
      tick((n) => n + 1);
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [on]);
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

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-white font-semibold text-zinc-900 shadow-[0_0_0_2px_#18181b]" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {initialOf(name)}
    </span>
  );
}

/** A text box with Pen's + and send buttons; Enter sends, Shift+Enter starts a line, Escape gives up. */
function Composer({ placeholder, onSend, onCancel }: { placeholder: string; onSend: (text: string) => void; onCancel?: () => void }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // The canvas press that opened it moves the focus away after this mounts; take it back for a few frames.
  useEffect(() => {
    let frame = 0;
    let left = 10;
    const take = () => {
      if (box.current && document.activeElement !== box.current) box.current.focus();
      if (--left > 0) frame = requestAnimationFrame(take);
    };
    take();
    return () => cancelAnimationFrame(frame);
  }, []);
  const send = () => text.trim() && (onSend(text.trim()), setText(""));
  return (
    <div className="flex flex-col px-3 pt-2.5 pb-2">
      <textarea
        ref={box}
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), send());
          else if (e.key === "Escape") onCancel?.();
        }}
        className="resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-end gap-1.5">
        {/* Attachments aren't in Lemon yet. */}
        <span className="flex h-5 w-5 items-center justify-center text-muted-foreground/60">
          <Plus size={14} strokeWidth={1.5} />
        </span>
        <button type="button" aria-label="Send" disabled={!text.trim()} onClick={send} className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background disabled:bg-send-off disabled:text-send-off-icon">
          <ArrowUp size={12} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

/** The pins on the canvas, the box for a new comment and the thread of the pin clicked. */
export function CommentLayer() {
  const list = useThreads();
  const tool = useEditor((s) => s.tool);
  const shown = useEditor((s) => s.showComments);
  const draft = useEditor((s) => s.commentDraft);
  const open = useEditor((s) => s.commentOpen);
  const visible = list.filter((t) => !t.resolved && (shown || tool === "comment"));
  useFrames(visible.length > 0 || !!draft);
  const screen = (p: { x: number; y: number } | undefined) => (p ? toScreen(p.x, p.y) : undefined);
  const card = "fixed z-30 w-[256px] overflow-hidden rounded-[12px] border border-input bg-popover shadow-island";
  const draftAt = draft ? screen(pinAt(draft)) : undefined;
  return (
    <>
      {visible.map((t) => {
        const at = screen(pinAt(t));
        if (!at) return null;
        const isOpen = open === t.id;
        return (
          <div key={t.id}>
            <button
              type="button"
              title={t.messages.at(-1)?.text}
              onClick={() => store.set({ commentOpen: isOpen ? null : t.id, commentDraft: null })}
              className="fixed z-30 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: at[0], top: at[1] }}
            >
              <Avatar name={t.messages[0]?.author ?? me} />
            </button>
            {isOpen && (
              <div className={card} style={{ left: at[0] + 18, top: at[1] - 12 }}>
                <div className="flex h-10 items-center gap-1.5 border-b border-input pr-2 pl-3 text-[12px] text-muted-foreground">
                  <span className="flex-1">
                    {t.messages.length} comment{t.messages.length > 1 ? "s" : ""}
                  </span>
                  <button type="button" onClick={() => apply([t])} className="flex h-6 items-center gap-1 rounded-[6px] bg-input px-2 text-[12px] font-semibold text-foreground hover:bg-foreground/10">
                    <Sparkles size={12} strokeWidth={1.5} /> Apply
                  </button>
                  <button type="button" aria-label="Resolve" onClick={() => resolve(t.id)} className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-input text-foreground hover:bg-foreground/10">
                    <Check size={13} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="max-h-[240px] overflow-y-auto">
                  {t.messages.map((m, i) => (
                    <div key={i} className="border-b border-input px-3 py-2">
                      <div className="flex items-center gap-1 text-[12px]">
                        <span className="font-semibold text-foreground">{m.author}</span>
                        <span className="text-muted-foreground">· {when(m.at)}</span>
                        <span className="ml-auto">
                          <Avatar name={m.author} size={16} />
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] whitespace-pre-wrap text-foreground">{m.text}</p>
                    </div>
                  ))}
                </div>
                <Composer placeholder="Reply..." onSend={(text) => edit(() => reply(doc, t.id, { author: me, at: Date.now(), text }))} onCancel={() => store.set({ commentOpen: null })} />
              </div>
            )}
          </div>
        );
      })}
      {draft && draftAt && (
        <>
          <span className="fixed z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: draftAt[0], top: draftAt[1] }}>
            <Avatar name={me} />
          </span>
          <div className={card} style={{ left: draftAt[0] + 18, top: draftAt[1] - 12 }}>
            <Composer
              placeholder="Leave feedback..."
              onSend={(text) => {
                edit(() => addThread(doc, draft, { author: me, at: Date.now(), text }));
                store.set({ commentDraft: null });
              }}
              onCancel={() => store.set({ commentDraft: null })}
            />
          </div>
        </>
      )}
    </>
  );
}

/** The Comments panel (in the properties panel's place while the Comment tool is on). */
export function CommentsPanel() {
  const list = useThreads();
  const shown = useEditor((s) => s.showComments);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const open = list.filter((t) => !t.resolved);
  const resolved = list.filter((t) => t.resolved);
  const rows = tab === "open" ? open : resolved;
  const icon = "flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground";
  return (
    <Island className="absolute top-[59px] right-2 bottom-[9px] flex w-[221px] flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center gap-0.5 pr-2 pl-3">
        <span className="flex-1 text-[12px] font-semibold text-foreground">Comments</span>
        <button type="button" aria-label={shown ? "Hide comments" : "Show comments"} onClick={() => store.set({ showComments: !shown })} className={icon}>
          {shown ? <Eye size={14} strokeWidth={1.5} /> : <EyeOff size={14} strokeWidth={1.5} />}
        </button>
        <button type="button" aria-label="Refresh" onClick={() => void bridge.reloadComments()} className={icon}>
          <RefreshCw size={13} strokeWidth={1.5} />
        </button>
        <M.Root>
          <M.Trigger asChild>
            <button type="button" aria-label="More" className={icon}>
              <Ellipsis size={14} strokeWidth={1.5} />
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
      <div className="mx-2 grid shrink-0 grid-cols-2 rounded-[8px] p-0.5 text-[12px]">
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
            className={cx("h-7 rounded-[6px]", tab === k ? "bg-input font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label} {n > 0 && n}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
        {!rows.length ? (
          <div className="mt-6 flex flex-col items-center gap-1 text-center text-[12px]">
            <MessageCircle size={16} strokeWidth={1.5} className="mb-1 text-muted-foreground" />
            <span className="font-semibold text-foreground">{tab === "open" ? (list.length ? "No open comments" : "No comments yet") : "No resolved comments"}</span>
            <span className="text-muted-foreground">Click anywhere on the canvas to leave one.</span>
          </div>
        ) : (
          rows.map((t) => {
            const first = t.messages[0]!;
            return (
              <div
                key={t.id}
                onClick={() => store.set({ commentOpen: t.resolved ? null : t.id })}
                className={cx("mb-2 cursor-default rounded-[10px] border px-2.5 py-2", store.get().commentOpen === t.id ? "border-foreground/30" : "border-input")}
              >
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="truncate font-semibold text-foreground">{first.author}</span>
                  <span className="shrink-0 text-muted-foreground">· {when(first.at)}</span>
                  <span className="ml-auto">
                    <Avatar name={first.author} size={16} />
                  </span>
                </div>
                <p className="mt-1 text-[12px] whitespace-pre-wrap text-foreground">{t.messages.map((m) => m.text).join("\n")}</p>
                <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {t.resolved ? (
                    <button type="button" aria-label="Reopen" onClick={() => edit(() => setResolved(doc, t.id, false))} className="flex h-6 w-7 items-center justify-center rounded-[6px] border border-input text-foreground hover:bg-foreground/5">
                      <RotateCcw size={12} strokeWidth={1.5} />
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => apply([t])} className="flex h-6 items-center gap-1 rounded-[6px] border border-input px-2 text-[12px] text-foreground hover:bg-foreground/5">
                        <Sparkles size={12} strokeWidth={1.5} /> Apply
                      </button>
                      <button type="button" aria-label="Resolve" onClick={() => resolve(t.id)} className="flex h-6 w-7 items-center justify-center rounded-[6px] border border-input text-foreground hover:bg-foreground/5">
                        <Check size={13} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        {tab === "open" && open.length > 0 && (
          <button type="button" onClick={() => apply(open)} className="mt-1 mb-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-white text-[12px] font-semibold text-zinc-900 hover:bg-zinc-200">
            <Sparkles size={13} strokeWidth={1.5} /> Apply all ({open.length})
          </button>
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
