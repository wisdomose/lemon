// The Settings window: a 1100 × 696 dialog with a section list on the left, as in the reference.
import { useEffect, useState, type ReactNode } from "react";
import { Dialog as D, Switch as S } from "radix-ui";
import { Bot, MessageSquare, Moon, Settings as Cog, Sun, Tag, Terminal, X, type LucideIcon } from "lucide-react";
import { PRODUCT } from "../../product.js";
import { MODELS } from "../../agent/models.js";
import type { ProviderStatus } from "../../agent/codex.js";
import { bridge } from "../bridge.js";
import { setSetting, useSettings, type Settings } from "../settings.js";
import { cx } from "../ui/kit.js";

type Page = "general" | "agents" | "names" | "chat" | "mcp";
const PAGES: { page: Page; icon: LucideIcon; label: string }[] = [
  { page: "general", icon: Cog, label: "General" },
  { page: "agents", icon: Bot, label: "Agents" },
  { page: "names", icon: Tag, label: "Agent Names" },
  { page: "chat", icon: MessageSquare, label: "Chat" },
  { page: "mcp", icon: Terminal, label: "MCP" },
];

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [page, setPage] = useState<Page>("general");
  const [claude, setClaude] = useState<{ loggedIn: boolean; email?: string; plan?: string }>();
  const [codex, setCodex] = useState<ProviderStatus>();
  useEffect(() => {
    if (!open) return;
    // Refresh both providers independently so one missing CLI cannot hide the other account.
    let active = true;
    setClaude(undefined);
    setCodex(undefined);
    void bridge.claudeStatus().catch(() => ({ loggedIn: false })).then((s) => { if (active) setClaude(s); });
    void bridge.codexStatus().catch(() => ({ loggedIn: false })).then((s) => { if (active) setCodex(s); });
    return () => { active = false; };
  }, [open]);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <D.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 flex h-[696px] max-h-[calc(100vh-40px)] w-[1100px] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[20px] bg-background text-foreground shadow-island outline-none"
        >
          <nav className="flex w-[232px] shrink-0 flex-col bg-popover px-[21px] pt-[35px] pb-[38px]">
            <D.Title className="mb-[18px] pl-[11px] text-[16px] font-semibold text-foreground">Settings</D.Title>
            {PAGES.map((p) => (
              <button
                key={p.page}
                type="button"
                onClick={() => setPage(p.page)}
                className={cx(
                  "flex h-9 items-center gap-[10px] rounded-[8px] px-3 text-[13px]",
                  p.page === page ? "bg-nav-active font-semibold text-foreground" : "text-foreground hover:bg-foreground/[0.04]",
                )}
              >
                <p.icon size={14} strokeWidth={1.5} /> {p.label}
              </button>
            ))}
            <div className="mt-auto pl-3 text-[13px]">
              {claude?.loggedIn ? (
                <>
                  <div className="font-semibold text-foreground">Claude{claude.plan ? ` · ${claude.plan}` : ""}</div>
                  <div className="mt-1 text-foreground">{claude.email}</div>
                </>
              ) : (
                <div className="text-muted-foreground">Claude: not signed in</div>
              )}
            </div>
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto pt-[33px] pr-[42px] pb-10 pl-[33px]">
            <D.Close className="absolute top-[22px] right-[22px] flex h-6 w-6 items-center justify-center rounded-md text-foreground hover:bg-foreground/5" aria-label="Close">
              <X size={16} strokeWidth={1.5} />
            </D.Close>
            {page === "general" && <General />}
            {page === "agents" && <Agents claude={claude} codex={codex} onCodex={setCodex} />}
            {page === "names" && <Placeholder title="Agent Names" text="Choose the names agents show on their cursors. Coming with parallel agents." />}
            {page === "chat" && <ChatPage />}
            {page === "mcp" && <Placeholder title="MCP" text="Give agents extra tools from MCP servers, and let other AI tools design in this app. Not built yet." />}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---- Pieces ---------------------------------------------------------------------------------------
const H1 = ({ children }: { children: ReactNode }) => <h1 className="mb-[33px] text-[24px] leading-8 font-semibold text-foreground">{children}</h1>;
const H2 = ({ children }: { children: ReactNode }) => <h2 className="mt-[19px] mb-[7px] text-[14px] font-semibold text-foreground first:mt-0">{children}</h2>;

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[41px] items-center border-b border-row-line py-[9px] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {note && <div className="mt-0.5 text-[12px] text-muted-foreground">{note}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle<K extends keyof Settings>({ k }: { k: K }) {
  const s = useSettings();
  return (
    <S.Root
      checked={s[k] as boolean}
      onCheckedChange={(v) => setSetting(k, v as Settings[K])}
      className="relative h-4 w-7 rounded-full bg-switch-off transition-colors duration-150 data-[state=checked]:bg-foreground"
    >
      <S.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-muted-foreground transition-transform duration-150 data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-background" />
    </S.Root>
  );
}

function NumberBox<K extends "nudgeSmall" | "nudgeBig">({ k }: { k: K }) {
  const s = useSettings();
  return (
    <label className="flex h-[30px] w-16 items-center justify-end gap-1 rounded-[6px] border border-input px-2 text-[12px]">
      <input
        value={s[k]}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (n > 0 && n < 1000) setSetting(k, n);
        }}
        className="w-8 bg-transparent text-right font-semibold text-foreground outline-none"
      />
      <span className="text-muted-foreground">px</span>
    </label>
  );
}

function Choice<K extends "chatTextSize" | "cursorSize">({ k }: { k: K }) {
  const s = useSettings();
  return (
    <div className="flex h-7 rounded-[6px] bg-popover p-0.5 text-[12px]">
      {(["small", "medium", "large"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setSetting(k, v)}
          className={cx("rounded-[4px] px-2 capitalize", s[k] === v ? "bg-background font-semibold text-foreground" : "text-muted-foreground")}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ---- Pages ----------------------------------------------------------------------------------------
function General() {
  const s = useSettings();
  return (
    <>
      <H1>General</H1>
      <H2>Interface</H2>
      <Row label="Appearance">
        <div className="flex h-7 rounded-[6px] bg-popover p-0.5 text-[12px]">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSetting("theme", t)}
              className={cx(
                "flex items-center gap-1.5 rounded-[4px] px-2 capitalize",
                s.theme === t ? "bg-background font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {t === "light" ? <Sun size={12} strokeWidth={1.5} /> : <Moon size={12} strokeWidth={1.5} />} {t}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Animations & effects" note="Turn off to save GPU/CPU.">
        <Toggle k="animations" />
      </Row>
      <H2>Canvas</H2>
      <Row label="Show pixel grid"><Toggle k="pixelGrid" /></Row>
      <Row label="Snap to pixel grid"><Toggle k="snapToPixels" /></Row>
      <Row label="Snap to objects"><Toggle k="snapToObjects" /></Row>
      <Row label="Use scroll wheel to zoom"><Toggle k="wheelZooms" /></Row>
      <Row label="Invert zoom direction"><Toggle k="invertZoom" /></Row>
      <H2>Custom nudge amount</H2>
      <p className="mb-2 text-[13px] text-foreground">How far selected objects move with the arrow keys</p>
      <Row label="Small nudge"><NumberBox k="nudgeSmall" /></Row>
      <Row label="Big nudge"><NumberBox k="nudgeBig" /></Row>
      <H2>Import & generation</H2>
      <Row label="Include HTML metadata" note="Keep layer names and ids when exporting HTML."><Toggle k="htmlMetadata" /></Row>
      <H2>Agents</H2>
      <Row label="Chat text size"><Choice k="chatTextSize" /></Row>
      <Row label="Cursor size"><Choice k="cursorSize" /></Row>
      <Row label="Show name on cursor"><Toggle k="cursorLabel" /></Row>
      <Row label="Show agent input on dashboard"><Toggle k="dashboardPrompt" /></Row>
    </>
  );
}

function Agents({ claude, codex, onCodex }: { claude?: { loggedIn: boolean; email?: string }; codex?: ProviderStatus; onCodex: (s: ProviderStatus) => void }) {
  const [signingIn, setSigningIn] = useState(false);
  // Codex comes with the app; signing in opens the browser (ChatGPT account), as `codex login` does.
  const signIn = () => {
    setSigningIn(true);
    void bridge.codexSignIn().then(onCodex).finally(() => setSigningIn(false));
  };
  const codexNote = codex?.loggedIn
    ? [codex.email, codex.plan].filter(Boolean).join(" · ") || "Signed in with ChatGPT"
    : codex?.error
      ? codex.error
      : "Sign in with your ChatGPT account";
  return (
    <>
      <H1>Agents</H1>
      <p className="mb-4 text-[13px] text-foreground">
        {PRODUCT.name} runs agents on this computer with your own AI subscription. It never sees your password or keys.
      </p>
      <Row label="Claude" note={MODELS.filter((m) => m.provider === "claude").map((m) => m.label.replace("Claude ", "")).join(", ")}>
        <span
          className={cx(
            "flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px]",
            claude?.loggedIn ? "border-input text-foreground" : "border-amber-500/60 text-amber-400",
          )}
        >
          {claude?.loggedIn && <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />}
          {claude === undefined ? "Checking status…" : claude.loggedIn ? "Signed in" : "Not connected"}
        </span>
      </Row>
      <Row label="Codex" note={codexNote}>
        {codex && !codex.loggedIn && !codex.error ? (
          <button
            type="button"
            disabled={signingIn}
            onClick={signIn}
            className="flex h-6 items-center rounded-full border border-input px-2.5 text-[12px] text-foreground hover:bg-foreground/5 disabled:opacity-60"
          >
            {signingIn ? "Waiting for the browser…" : "Sign in"}
          </button>
        ) : (
          <span className={cx("flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px]", codex?.loggedIn ? "border-input text-foreground" : "border-amber-500/60 text-amber-400")}>
            {codex?.loggedIn && <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />}
            {codex === undefined ? "Checking status…" : codex.loggedIn ? "Signed in" : "Couldn't start"}
          </span>
        )}
      </Row>
    </>
  );
}

function ChatPage() {
  return (
    <>
      <H1>Chat</H1>
      <Row label="Notify when agents finish"><Toggle k="notifyWhenDone" /></Row>
    </>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <>
      <H1>{title}</H1>
      <p className="text-[13px] text-muted-foreground">{text}</p>
    </>
  );
}
