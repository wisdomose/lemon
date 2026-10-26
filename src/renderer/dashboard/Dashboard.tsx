// The Dashboard (PRD "Dashboard window", capture 01): a sidebar (Recents, Drafts, Design Systems), a
// header with Open File and New File, the prompt starter, the import tiles and the file browser.
// Sizes measured from capture 01 (the window's content is 1426 × 896; the native title and menu bars
// take the rest).
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  ArrowUp,
  Clock,
  FilePen,
  FilePlus2,
  FolderOpen,
  GalleryHorizontalEnd,
  Globe,
  ImagePlus,
  LayoutDashboard,
  Plus,
  Presentation,
  Shapes,
  Smartphone,
  X,
  type LucideIcon,
} from "lucide-react";
import logoUrl from "../../../assets/logo.svg?url";
import { PRODUCT } from "../../product.js";
import { browserBridge, type DashboardFiles } from "../bridge.js";
import { setSetting, useSettings } from "../settings.js";
import { store } from "../store.js";
import { cx } from "../ui/kit.js";
import { PromptEditor, type PromptEditorHandle } from "../agent/PromptEditor.js";
import { ParallelAgents, Variants } from "../agent/RunOptions.js";
import { ModelPicker } from "../agent/ModelPicker.js";
import { FileBrowser } from "./FileBrowser.js";

const bridge = window.lemon ?? browserBridge();

type Page = "recents" | "drafts" | "systems";

export function Dashboard() {
  const [page, setPage] = useState<Page>("recents");
  const [files, setFiles] = useState<DashboardFiles>({ recents: [], drafts: [] });
  const settings = useSettings();
  useEffect(() => {
    void bridge.dashboard.files().then(setFiles);
    bridge.dashboard.onFiles(setFiles);
  }, []);
  return (
    <div className="flex h-full bg-card text-foreground">
      <Sidebar page={page} onPage={setPage} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center pr-4 pl-4">
          <h1 className="text-[15px] font-semibold">Dashboard</h1>
          <button
            type="button"
            onClick={() => void bridge.dashboard.openDialog()}
            className="ml-auto flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-semibold text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <FolderOpen size={14} strokeWidth={1.5} /> Open File
          </button>
          <button
            type="button"
            onClick={() => void bridge.dashboard.newFile()}
            className="ml-2 flex h-7 items-center gap-1.5 rounded-[8px] bg-white pr-3 pl-2.5 text-[13px] font-semibold text-zinc-900 hover:bg-zinc-200"
          >
            <Plus size={14} strokeWidth={1.75} /> New File
          </button>
        </header>
        {/* A 10px scrollbar gutter on the right, as in the capture. */}
        <div className="min-h-0 flex-1 overflow-y-scroll pr-0 pb-6 pl-5">
          <div className="pr-5">
            {settings.dashboardPrompt && <PromptStarter onHide={() => setSetting("dashboardPrompt", false)} />}
            {page === "systems" ? (
              <Empty title="Design Systems">Starter design systems come in a later version.</Empty>
            ) : (
              <FileBrowser
                key={page}
                title={page === "recents" ? "Recents" : "Drafts"}
                files={page === "recents" ? files.recents : files.drafts}
                drafts={page === "drafts"}
                bridge={bridge}
                empty={
                  page === "recents"
                    ? "Files you open show up here."
                    : "New files are kept here until you save them somewhere else."
                }
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Sidebar({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  const item = (p: Page, icon: LucideIcon, label: string) => {
    const Icon = icon;
    return (
      <button
        type="button"
        onClick={() => onPage(p)}
        className={cx(
          "flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2 text-[13px]",
          page === p ? "bg-sidebar-accent font-semibold text-foreground" : "text-foreground/90 hover:bg-sidebar-accent/60",
        )}
      >
        <Icon size={15} strokeWidth={1.5} className="text-muted-foreground" />
        {label}
      </button>
    );
  };
  return (
    <nav className="flex w-[225px] shrink-0 flex-col border-r border-border bg-sidebar px-[11px]">
      <div className="flex h-12 items-center gap-1.5 pl-1.5">
        <img src={logoUrl} alt="" className="h-[18px] w-[18px]" />
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">{PRODUCT.name}</span>
      </div>
      {item("recents", Clock, "Recents")}
      {item("drafts", FilePen, "Drafts")}
      <div className="mt-[18px] mb-1.5 pl-2 text-[11px] tracking-wide text-muted-foreground uppercase">Templates</div>
      {item("systems", Shapes, "Design Systems")}
    </nav>
  );
}

/** The kinds of design the prompt starter offers; the agent is told which one was picked. */
const KINDS = [
  { label: "Landing page", noun: "a landing page", icon: GalleryHorizontalEnd, glow: "#f59e0b" },
  { label: "Mobile app", noun: "mobile app screens", icon: Smartphone, glow: "#3b82f6" },
  { label: "Web app", noun: "web app screens", icon: AppWindow, glow: "#8b5cf6" },
  { label: "Slides", noun: "a slide deck", icon: Presentation, glow: "#f97316" },
  { label: "Dashboard", noun: "a dashboard", icon: LayoutDashboard, glow: "#22c55e" },
  { label: "Something else…", noun: null, icon: FilePlus2, glow: "#a1a1aa" },
] as const;

function PromptStarter({ onHide }: { onHide: () => void }) {
  const [kind, setKind] = useState(0);
  const [canSend, setCanSend] = useState(false);
  const editor = useRef<PromptEditorHandle>(null);
  const footer = useRef<HTMLDivElement>(null);
  const { animations } = useSettings();
  useEffect(() => editor.current?.focus(), []);
  const send = () => {
    const p = editor.current?.read();
    if (!p || !p.hasText || !bridge.canRunAgent) return;
    const noun = KINDS[kind]!.noun;
    const forAgent = noun ? `${p.forAgent}\n\n(What to design: ${noun}.)` : p.forAgent;
    void bridge.dashboard.newFile({ text: p.shown, forAgent, model: store.get().model });
  };
  return (
    <section className="relative">
      <button
        type="button"
        aria-label="Hide"
        onClick={onHide}
        className="absolute top-3 right-0 flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
      <div className="mx-auto w-[768px] pt-12">
        <div className="flex justify-center gap-2">
          {KINDS.map((k, i) => {
            const Icon = k.icon;
            return (
              <button
                key={k.label}
                type="button"
                onClick={() => (setKind(i), editor.current?.focus())}
                className={cx(
                  "flex h-8 items-center gap-1.5 rounded-[9px] border px-[10px] text-[13px] font-semibold",
                  i === kind ? "border-chip-on-line bg-chip-on text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} strokeWidth={1.5} /> {k.label}
              </button>
            );
          })}
        </div>
        <div className="relative mt-6">
          {/* The soft glow behind the box takes the picked kind's colour. */}
          <div
            aria-hidden
            className={cx("pointer-events-none absolute -inset-3 rounded-[24px] opacity-[0.18] blur-2xl transition-colors duration-700", animations && "animate-pulse")}
            style={{ background: `radial-gradient(60% 80% at 50% 50%, ${KINDS[kind]!.glow}, transparent 70%)` }}
          />
          <div className="relative flex h-32 flex-col rounded-[14px] border border-border bg-background">
            <div className="flex min-h-0 flex-1 overflow-y-auto px-4 pt-3">
              <PromptEditor ref={editor} large selection={null} placeholder="Design anything..." onSubmit={send} onChange={setCanSend} />
            </div>
            <div ref={footer} className="flex h-[46px] shrink-0 items-center border-t border-row-line pr-[11px] pl-3 text-[11px] text-muted-foreground">
              <button type="button" aria-label="Add to context" className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/5">
                <Plus size={14} strokeWidth={1.5} />
              </button>
              <ParallelAgents anchor={footer} />
              <Variants anchor={footer} />
              <ModelPicker />
              <button
                type="button"
                aria-label="Send"
                onClick={send}
                disabled={!canSend || !bridge.canRunAgent}
                title={bridge.canRunAgent ? undefined : "The agent runs only in the desktop app."}
                className="ml-[10px] flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background disabled:bg-send-off disabled:text-send-off-icon"
              >
                <ArrowUp size={12} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-7 h-px bg-border" />
        <div className="mt-[29px] grid grid-cols-3 gap-2">
          <Tile icon={FigmaMark} label="Import from Figma" />
          <Tile icon={Globe} label="Import from browser" />
          <Tile icon={ImagePlus} label="Recreate a screenshot" />
        </div>
      </div>
    </section>
  );
}

/** Lucide has no Figma logo; a plain stand-in of the same size. */
function FigmaMark(props: { size: number; strokeWidth: number }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h3v6H9a3 3 0 0 1 0-6zM12 3h3a3 3 0 0 1 0 6h-3zM9 9h3v6H9a3 3 0 0 1 0-6zM15 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM9 15h3v3a3 3 0 1 1-3-3z" />
    </svg>
  );
}

/** An import tile. None is built yet, so they are shown but can't be used. */
function Tile({ icon: Icon, label }: { icon: LucideIcon | typeof FigmaMark; label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Not available yet"
      className="flex h-[67px] flex-col items-center justify-center gap-[7px] rounded-[10px] border border-tile-line bg-tile text-[13px] font-semibold text-muted-foreground/45"
    >
      <Icon size={16} strokeWidth={1.5} />
      {label}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-[13px] tracking-wide text-foreground uppercase">{title}</h2>
      <p className="mt-6 text-[13px] text-muted-foreground">{children}</p>
    </section>
  );
}
