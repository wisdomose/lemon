// Home, as in Pen's: the Home tab of the window, under the same top bar as a file. The prompt starter
// (the kinds of design, the prompt, the import tiles) sits in the middle, the files below it (Recents,
// Drafts and Design Systems, as a grid or a list). Sizes measured from Pen's Home at 1920 x 1080.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Dialog as D } from "radix-ui";
import {
  AppWindow,
  ArrowUp,
  FilePlus2,
  GalleryHorizontalEnd,
  Globe,
  ImagePlus,
  LayoutDashboard,
  Plus,
  Presentation,
  Smartphone,
  X,
  type LucideIcon,
} from "lucide-react";
import { bridge, type DashboardFiles } from "../bridge.js";
import { SettingsDialog } from "../chrome/SettingsDialog.js";
import { setSetting, useSettings } from "../settings.js";
import { store } from "../store.js";
import { cx } from "../ui/kit.js";
import { PromptEditor, type PromptEditorHandle } from "../agent/PromptEditor.js";
import { ParallelAgents, Variants } from "../agent/RunOptions.js";
import { ModelPicker } from "../agent/ModelPicker.js";
import { FileBrowser } from "./FileBrowser.js";
import { TopBar } from "../chrome/TopBar.js";

/** The account's initial in the top bar (as the editor's page reads it). */
const initial = new URLSearchParams(location.search).get("initial") ?? "Y";

export function Dashboard() {
  const [files, setFiles] = useState<DashboardFiles>({ recents: [], drafts: [] });
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    void bridge.dashboard.files().then(setFiles);
    bridge.dashboard.onFiles(setFiles);
    // Settings opens here too: File › Settings… and Ctrl+, (as in the editor).
    bridge.onMenuCommand((command) => command === "settings" && setSettingsOpen(true));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") (e.preventDefault(), setSettingsOpen(true));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative h-full bg-background text-foreground">
      {/* The page scrolls under the top bar, which floats over it as over a file. */}
      <div className="h-full overflow-y-auto px-5 pt-[58px]">
        {settings.dashboardPrompt && <PromptStarter onHide={() => setSetting("dashboardPrompt", false)} />}
        <FileBrowser files={files} bridge={bridge} />
      </div>
      <TopBar bridge={bridge} initial={initial} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
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
  const [asking, setAsking] = useState(false);
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
    const { model, team, effort } = store.get();
    void bridge.dashboard.newFile({ text: p.shown, forAgent, model, team, effort });
  };
  return (
    <section className="relative">
      <button
        type="button"
        aria-label="Hide"
        onClick={() => setAsking(true)}
        className="absolute top-3 right-0 flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
      <div className="mx-auto w-[768px] pt-[42px]">
        {/* Neutral hover and keyboard-focus rings override Chromium's yellow accent outline. */}
        <div className="flex justify-center gap-2">
          {KINDS.map((k, i) => {
            const Icon = k.icon;
            return (
              <button
                key={k.label}
                type="button"
                onClick={() => (setKind(i), editor.current?.focus())}
                className={cx(
                  "flex h-8 items-center gap-1.5 rounded-[9px] border px-[10px] text-[13px] font-semibold outline-none hover:border-foreground/80 hover:ring-1 hover:ring-foreground/60 focus-visible:border-foreground/80 focus-visible:ring-1 focus-visible:ring-foreground/60",
                  i === kind ? "border-chip-on-line bg-chip-on text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} strokeWidth={1.5} /> {k.label}
              </button>
            );
          })}
        </div>
        {/* A 1px border with the picked kind's colour flowing round it, and its soft glow outside. */}
        <div
          className={cx("glow-ring relative mt-6 rounded-[15px] p-px", animations && "glow-moving")}
          style={{ "--glow": KINDS[kind]!.glow } as CSSProperties}
        >
          <div aria-hidden className="glow-halo pointer-events-none absolute inset-0">
            <div className="absolute inset-0 overflow-hidden rounded-[15px]">
              <span className="glow-spot" />
              <span className="glow-spot" />
            </div>
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[15px] bg-border">
            <span className="glow-spot" />
            <span className="glow-spot" />
          </div>
          <div className="relative flex h-[126px] flex-col rounded-[14px] bg-background">
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
      <HideDialog open={asking} onOpenChange={setAsking} onHide={onHide} />
    </section>
  );
}

/** The × asks first (as in Pen); the setting brings the prompt back. Measured from Pen's dialog. */
function HideDialog({ open, onOpenChange, onHide }: { open: boolean; onOpenChange: (o: boolean) => void; onHide: () => void }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content className="fixed top-1/2 left-1/2 z-50 w-[448px] -translate-x-1/2 -translate-y-1/2 rounded-[12px] border border-border bg-background p-6 text-foreground outline-none">
          <D.Title className="text-[18px] leading-6 font-semibold text-popover-foreground">Hide agent input?</D.Title>
          <D.Description className="mt-2 text-[14px] leading-5 text-muted-foreground">
            This removes the prompt box from the dashboard. You can turn it back on later in Settings → General.
          </D.Description>
          <div className="mt-4 flex justify-end gap-2">
            <D.Close asChild>
              <button type="button" className="h-9 rounded-[8px] border border-input bg-[#242428] px-4 text-[14px] font-semibold text-foreground hover:bg-[#2c2c31]">
                Cancel
              </button>
            </D.Close>
            <button
              type="button"
              onClick={() => (onOpenChange(false), onHide())}
              className="h-9 rounded-[8px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-zinc-200"
            >
              Hide forever
            </button>
          </div>
          <D.Close aria-label="Close" className="absolute top-4 right-4 rounded-sm text-muted-foreground hover:text-foreground">
            <X size={14} strokeWidth={1.5} />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
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
