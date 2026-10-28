// Home's files, as in Pen: Recents, Drafts and Design Systems as pills, with grid and list views. A
// card shows its picture, "folder / name" and when it was opened or edited; a click selects it, a
// double-click (or Enter) opens it, and its "…" menu opens, shows, renames, and removes or deletes it.
import { useRef, useState, type ReactNode } from "react";
import { Dialog as D, DropdownMenu as M } from "radix-ui";
import { ChevronDown, ChevronUp, Ellipsis, File as FileIcon, FilePen, LayoutGrid, List, X } from "lucide-react";
import type { FileCard } from "../../main/files.js";
import type { Bridge, DashboardFiles } from "../bridge.js";
import { cx } from "../ui/kit.js";
import { MenuContent, MenuItem, MenuSeparator } from "../ui/menu.js";
import logoUrl from "../../../assets/logo.svg?url";

type Shelf = "recents" | "drafts" | "systems";
type View = "grid" | "list";
const VIEW_KEY = "dashboard-view";

/** Measured from Pen's Home: the card's picture and strip, a selected card's outline. */
const PICTURE = "#212224";
const STRIP = "#121315";
const PICKED = "#3d99ff";

/** When the file was last used: opened or edited, whichever is later. */
const lastUsed = (f: FileCard) => Math.max(f.openedAt ?? 0, f.editedAt);

/** "Edited 1m ago", "Opened 17h ago". */
function usedLabel(f: FileCard): string {
  return f.openedAt && f.openedAt >= f.editedAt ? `Opened ${ago(f.openedAt)}` : `Edited ${ago(f.editedAt)}`;
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return dateLabel(at);
}

/** "10/28/2026", as Pen writes dates. */
const dateLabel = (at: number) => new Date(at).toLocaleDateString("en-US");

/** Windows calls it Explorer, macOS Finder. */
const SHOW_IN = /Mac/i.test(navigator.userAgent) ? "Show in Finder" : /Win/i.test(navigator.userAgent) ? "Show in Explorer" : "Show in Folder";

export function FileBrowser({ files, bridge }: { files: DashboardFiles; bridge: Bridge }) {
  const [shelf, setShelf] = useState<Shelf>("recents");
  const [view, setViewState] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View | null) ?? "grid";
    } catch {
      return "grid";
    }
  });
  const setView = (v: View) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // The view just isn't remembered.
    }
    setViewState(v);
  };
  const [picked, setPicked] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(true);
  const [renaming, setRenaming] = useState<FileCard | null>(null);
  const list = shelf === "recents" ? files.recents : shelf === "drafts" ? files.drafts : [];
  const sorted = [...list].sort((a, b) => (newestFirst ? lastUsed(b) - lastUsed(a) : lastUsed(a) - lastUsed(b)));
  const d = bridge.dashboard;

  const menu = (f: FileCard) => (
    <MoreMenu onOpen={() => setPicked(f.path)}>
      <MenuItem label="Open" onSelect={() => void d.open(f.path)} />
      <MenuItem label={SHOW_IN} onSelect={() => void d.reveal(f.path)} />
      <MenuItem label="Rename" onSelect={() => setRenaming(f)} />
      <MenuSeparator />
      {f.draft && shelf === "drafts" ? (
        <MenuItem label="Delete Draft" danger onSelect={() => void d.deleteDraft(f.path)} />
      ) : (
        <MenuItem label="Remove from Recents" onSelect={() => void d.forget(f.path)} />
      )}
    </MoreMenu>
  );
  const name = (f: FileCard) => (
    <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {f.draft ? <FilePen size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground" /> : <FileIcon size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />}
      {f.folder && <span className="shrink-0 text-muted-foreground">{f.folder} /</span>}
      <span className="truncate font-semibold text-foreground" title={f.path}>
        {f.name}
      </span>
    </span>
  );
  const pickProps = (f: FileCard) => ({
    tabIndex: 0,
    "data-file": f.name,
    onClick: () => setPicked(f.path),
    onDoubleClick: () => void d.open(f.path),
    onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && void d.open(f.path),
  });

  return (
    <section className="mt-[42px] pb-6">
      <div className="flex h-6 items-center">
        {(
          [
            ["recents", "Recents"],
            ["drafts", "Drafts"],
            ["systems", "Design Systems"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            type="button"
            onClick={() => setShelf(s)}
            className={cx(
              "flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold",
              shelf === s ? "bg-[#2b2c2e] text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {(["grid", "list"] as const).map((v) => {
            const Icon = v === "grid" ? LayoutGrid : List;
            return (
              <button
                key={v}
                type="button"
                aria-label={v === "grid" ? "Grid" : "List"}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cx("flex h-6 w-6 items-center justify-center rounded-[6px]", view === v ? "bg-[#2b2c2e] text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon size={13} strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      </div>

      {shelf === "systems" ? (
        <p className="mt-6 text-[13px] text-muted-foreground">Design systems you add show up here.</p>
      ) : !list.length ? (
        <p className="mt-6 text-[13px] text-muted-foreground">
          {shelf === "recents" ? "Files you open show up here." : "New files are kept here until you save them somewhere else."}
        </p>
      ) : view === "grid" ? (
        <div className="mt-[14px] grid grid-cols-6 gap-6">
          {sorted.map((f) => (
            <div
              key={f.path}
              {...pickProps(f)}
              className="group relative flex cursor-default flex-col overflow-hidden rounded-[10px] outline-none"
              style={{ boxShadow: picked === f.path ? `0 0 0 1.5px ${PICKED}` : undefined }}
            >
              <div className="flex aspect-[294/185] items-center justify-center overflow-hidden" style={{ background: PICTURE }}>
                {f.thumb ? <img src={f.thumb} alt="" className="h-full w-full object-contain" draggable={false} /> : <Placeholder />}
              </div>
              <div className="relative flex h-[60px] flex-col justify-center gap-[3px] pr-10 pl-3" style={{ background: STRIP }}>
                {name(f)}
                <span className="text-[12px] text-muted-foreground">{usedLabel(f)}</span>
                <div className={cx("absolute right-3 bottom-3", picked === f.path ? "flex" : "hidden group-hover:flex has-[[data-state=open]]:flex")}>{menu(f)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-[14px] text-[13px]">
          <div className="flex h-8 items-center px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            <span className="flex-1">Name</span>
            <button type="button" onClick={() => setNewestFirst(!newestFirst)} className="flex w-[200px] items-center gap-1 uppercase hover:text-foreground">
              Last used {newestFirst ? <ChevronDown size={11} strokeWidth={2} /> : <ChevronUp size={11} strokeWidth={2} />}
            </button>
            <span className="w-[150px]">Created</span>
            <span className="w-8" />
          </div>
          {sorted.map((f) => (
            <div
              key={f.path}
              {...pickProps(f)}
              className={cx("group flex h-[49px] cursor-default items-center gap-3 rounded-[8px] px-2 outline-none", picked === f.path ? "bg-[#1d3249]" : "hover:bg-foreground/[0.03]")}
            >
              <span className="flex h-[33px] w-[47px] shrink-0 items-center justify-center overflow-hidden rounded-[4px]" style={{ background: PICTURE }}>
                {f.thumb ? <img src={f.thumb} alt="" className="h-full w-full object-contain" draggable={false} /> : <FileIcon size={12} strokeWidth={1.5} className="text-[#4a4b4d]" />}
              </span>
              <span className="min-w-0 flex-1">{name(f)}</span>
              <span className="w-[200px] text-[12px] text-muted-foreground">{usedLabel(f)}</span>
              <span className="w-[150px] text-[12px] text-muted-foreground">{dateLabel(f.createdAt)}</span>
              <span className={cx("w-8 justify-end", picked === f.path ? "flex" : "hidden group-hover:flex has-[[data-state=open]]:flex")}>{menu(f)}</span>
            </div>
          ))}
        </div>
      )}
      <RenameDialog file={renaming} onClose={() => setRenaming(null)} bridge={bridge} />
    </section>
  );
}

/** A file with no picture yet: the product's mark, greyed out (Pen shows its own). */
function Placeholder() {
  return <img src={logoUrl} alt="" className="h-10 w-10 opacity-25 grayscale" draggable={false} />;
}

/** A card's "…" button and its menu. */
function MoreMenu({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  return (
    <M.Root onOpenChange={(open) => open && onOpen()}>
      <M.Trigger asChild>
        <button
          type="button"
          aria-label="More"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[#2a2b2d] text-muted-foreground hover:text-foreground"
        >
          <Ellipsis size={14} strokeWidth={1.5} />
        </button>
      </M.Trigger>
      {/* Not back to the "…" button: Rename's dialog has the focus by then. */}
      <MenuContent align="start" className="min-w-[140px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        {children}
      </MenuContent>
    </M.Root>
  );
}

/** Pen's Rename dialog: the name without its extension selected; Save renames the file on disk. */
function RenameDialog({ file, onClose, bridge }: { file: FileCard | null; onClose: () => void; bridge: Bridge }) {
  return (
    <D.Root open={!!file} onOpenChange={(open) => !open && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        {/* A fresh form for each file, so its field starts with the file's name. */}
        {file && <RenameForm key={file.path} file={file} onClose={onClose} bridge={bridge} />}
      </D.Portal>
    </D.Root>
  );
}

function RenameForm({ file, onClose, bridge }: { file: FileCard; onClose: () => void; bridge: Bridge }) {
  const [name, setName] = useState(file.name);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The dialog would select the whole name; Pen selects the name before the extension.
  const focusName = (e: Event) => {
    e.preventDefault();
    input.current?.focus();
    input.current?.setSelectionRange(0, file.name.replace(/\.[^.]+$/, "").length);
  };
  const changed = name.trim() !== "" && name.trim() !== file.name;
  const save = async () => {
    if (!changed) return;
    const why = await bridge.dashboard.rename(file.path, name);
    if (why) setProblem(why);
    else onClose();
  };
  return (
    <D.Content onOpenAutoFocus={focusName} className="fixed top-1/2 left-1/2 z-50 w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-border bg-background p-4 text-foreground outline-none">
      <D.Title className="text-[14px] font-semibold">Rename</D.Title>
      <D.Description className="mt-1 text-[12px] text-muted-foreground">This also renames the file on your disk.</D.Description>
      <input
        ref={input}
        value={name}
        onChange={(e) => (setName(e.target.value), setProblem(null))}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        className="mt-3 h-8 w-full rounded-[8px] border border-input bg-transparent px-2 text-[13px] outline-none focus:border-[#3b82f6]"
      />
      {problem && <p className="mt-2 text-[12px] text-destructive">{problem}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <D.Close asChild>
          <button type="button" className="h-8 rounded-[8px] border border-input bg-[#242428] px-3 text-[13px] font-semibold hover:bg-[#2c2c31]">
            Cancel
          </button>
        </D.Close>
        <button
          type="button"
          disabled={!changed}
          onClick={() => void save()}
          className="h-8 rounded-[8px] bg-primary px-3 text-[13px] font-semibold text-primary-foreground hover:bg-zinc-200 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <D.Close aria-label="Close" className="absolute top-4 right-4 rounded-sm text-muted-foreground hover:text-foreground">
        <X size={14} strokeWidth={1.5} />
      </D.Close>
    </D.Content>
  );
}
