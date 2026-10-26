// The Dashboard's Recents and Drafts: a grid of cards (picture, name, "Edited …" or "Opened …") or a
// list with Name, Last used (sortable) and Created. A click opens the file; right-click has the rest.
import { useState } from "react";
import { ArrowDown, ArrowUp, File as FileIcon, FilePen, LayoutGrid, List } from "lucide-react";
import type { FileCard } from "../../main/files.js";
import type { Bridge } from "../bridge.js";
import { cx } from "../ui/kit.js";
import { ContextContent, ContextItem, ContextRoot, ContextSeparator, ContextTrigger } from "../ui/menu.js";

type View = "grid" | "list";
const VIEW_KEY = "dashboard-view";

/** When the file was last used: opened or edited, whichever is later. */
const lastUsed = (f: FileCard) => Math.max(f.openedAt ?? 0, f.editedAt);

/** "Edited 1m ago", "Opened 17h ago" (as capture 01). */
function usedLabel(f: FileCard): string {
  return f.openedAt && f.openedAt >= f.editedAt ? `Opened ${ago(f.openedAt)}` : `Edited ${ago(f.editedAt)}`;
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return `on ${dateLabel(at)}`;
}

const dateLabel = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function FileBrowser({
  title,
  files,
  drafts,
  bridge,
  empty,
}: {
  title: string;
  files: FileCard[];
  drafts: boolean;
  bridge: Bridge;
  empty: string;
}) {
  const [view, setViewState] = useState<View>(() => (localStorage.getItem(VIEW_KEY) as View | null) ?? "grid");
  const setView = (v: View) => (localStorage.setItem(VIEW_KEY, v), setViewState(v));
  const [newestFirst, setNewestFirst] = useState(true);
  const sorted = [...files].sort((a, b) => (newestFirst ? lastUsed(b) - lastUsed(a) : lastUsed(a) - lastUsed(b)));
  const d = bridge.dashboard;

  /** A file's right-click menu around `children`. */
  const withMenu = (f: FileCard, children: React.ReactElement) => (
    <ContextRoot key={f.path}>
      <ContextTrigger asChild>{children}</ContextTrigger>
      <ContextContent>
        <ContextItem label="Open" onSelect={() => void d.open(f.path)} />
        <ContextItem label="Show in Folder" onSelect={() => void d.reveal(f.path)} />
        <ContextSeparator />
        {drafts ? (
          <ContextItem label="Delete" danger onSelect={() => void d.deleteDraft(f.path)} />
        ) : (
          <ContextItem label="Remove from Recents" onSelect={() => void d.forget(f.path)} />
        )}
      </ContextContent>
    </ContextRoot>
  );

  return (
    <section className="mt-[43px]">
      <div className="flex h-6 items-center">
        <h2 className="text-[13px] tracking-wide text-foreground uppercase">{title}</h2>
        <div className="ml-auto flex h-6 overflow-hidden rounded-[6px] border border-sidebar">
          {(["grid", "list"] as const).map((v) => {
            const Icon = v === "grid" ? LayoutGrid : List;
            return (
              <button
                key={v}
                type="button"
                aria-label={v === "grid" ? "Grid" : "List"}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cx("flex w-[26px] items-center justify-center", view === v ? "bg-background text-foreground" : "bg-sidebar text-muted-foreground hover:text-foreground")}
              >
                <Icon size={13} strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      </div>

      {!files.length ? (
        <p className="mt-6 text-[13px] text-muted-foreground">{empty}</p>
      ) : view === "grid" ? (
        <div className="mt-[14px] grid grid-cols-4 gap-5">
          {sorted.map((f) =>
            withMenu(
              f,
              <button
                type="button"
                data-file={f.name}
                onClick={() => void d.open(f.path)}
                className="group flex flex-col overflow-hidden rounded-[12px] border border-border text-left outline-none hover:border-light-blue focus-visible:border-light-blue"
              >
                <div className="flex h-[170px] items-center justify-center bg-card-picture">
                  {f.thumb ? (
                    <img src={f.thumb} alt="" className="h-full w-full object-contain" draggable={false} />
                  ) : (
                    <FileIcon size={44} strokeWidth={1} className="text-[#3c3c3d]" />
                  )}
                </div>
                <div className="flex h-[59px] flex-col justify-center gap-[3px] px-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <FilePen size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="text-[12px] text-muted-foreground">{usedLabel(f)}</span>
                </div>
              </button>,
            ),
          )}
        </div>
      ) : (
        <div className="mt-[14px] text-[13px]">
          <div className="flex h-8 items-center border-b border-border px-3 text-[12px] text-muted-foreground">
            <span className="flex-1">Name</span>
            <button type="button" onClick={() => setNewestFirst(!newestFirst)} className="flex w-[180px] items-center gap-1 hover:text-foreground">
              Last used {newestFirst ? <ArrowDown size={12} strokeWidth={1.5} /> : <ArrowUp size={12} strokeWidth={1.5} />}
            </button>
            <span className="w-[180px]">Created</span>
          </div>
          {sorted.map((f) =>
            withMenu(
              f,
              <button
                type="button"
                data-file={f.name}
                onClick={() => void d.open(f.path)}
                className="flex h-10 w-full items-center rounded-[8px] px-3 text-left outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-foreground">
                  <FilePen size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
                  <span className="truncate" title={f.path}>{f.name}</span>
                </span>
                <span className="w-[180px] text-muted-foreground">{ago(lastUsed(f)).replace(/^./, (c) => c.toUpperCase())}</span>
                <span className="w-[180px] text-muted-foreground">{dateLabel(f.createdAt)}</span>
              </button>,
            ),
          )}
        </div>
      )}
    </section>
  );
}
