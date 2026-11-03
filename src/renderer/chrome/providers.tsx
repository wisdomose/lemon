// The Agents settings page: subscription agents (Claude, Codex) and the AI providers a person can
// connect with an API key — the built-ins, or their own OpenAI- or Anthropic-compatible provider.
// The flow follows the reference: a list with connection pills, an auth page per built-in, and full
// add/edit/remove pages for custom providers whose models each appear in the model picker.
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, ChevronsUpDown, Link2, Plus, Trash2 } from "lucide-react";
import { PRODUCT } from "../../product.js";
import { MODELS } from "../../agent/models.js";
import {
  API_TYPES,
  builtInProvider,
  providerSubtitle,
  type ApiType,
  type ProviderDraft,
  type ProviderRecord,
} from "../../agent/providers.js";
import type { ProviderStatus } from "../../agent/codex.js";
import { bridge } from "../bridge.js";
import { useEditor } from "../store.js";
import { refreshProviders } from "../agent/model-catalog.js";
import { cx } from "../ui/kit.js";

type View = { kind: "list" } | { kind: "provider"; id: string } | { kind: "add" };

export function AgentsPage({
  claude,
  codex,
  onCodex,
  provider,
}: {
  claude?: { loggedIn: boolean; email?: string };
  codex?: ProviderStatus;
  onCodex: (s: ProviderStatus) => void;
  /** Opens on this provider's page (the model picker's "Set up …" row). */
  provider?: string;
}) {
  const providers = useEditor((s) => s.providers);
  const [view, setView] = useState<View>(provider ? { kind: "provider", id: provider } : { kind: "list" });
  useEffect(() => {
    void refreshProviders();
  }, []);
  if (view.kind === "add") return <Shell onBack={() => setView({ kind: "list" })}><AddProviderPage onDone={() => setView({ kind: "list" })} /></Shell>;
  if (view.kind === "provider") {
    const record = providers.find((p) => p.id === view.id);
    if (record) {
      return (
        <Shell onBack={() => setView({ kind: "list" })}>
          {record.builtIn ? <BuiltInProviderPage record={record} /> : <CustomProviderPage record={record} onRemoved={() => setView({ kind: "list" })} />}
        </Shell>
      );
    }
  }
  return <ProvidersList claude={claude} codex={codex} onCodex={onCodex} providers={providers} onOpen={(id) => setView({ kind: "provider", id })} onAdd={() => setView({ kind: "add" })} />;
}

/** The detail pages' shared chrome: back to the provider list, then the page itself. */
function Shell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-7 flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} strokeWidth={1.5} /> AI providers
      </button>
      {children}
    </div>
  );
}

// ---- The list -------------------------------------------------------------------------------------
function ProvidersList({
  claude,
  codex,
  onCodex,
  providers,
  onOpen,
  onAdd,
}: {
  claude?: { loggedIn: boolean; email?: string };
  codex?: ProviderStatus;
  onCodex: (s: ProviderStatus) => void;
  providers: ProviderRecord[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
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
      <h1 className="mb-[33px] text-[24px] leading-8 font-semibold text-foreground">Agents</h1>
      <p className="mb-4 text-[13px] text-foreground">
        {PRODUCT.name} runs agents on this computer with your own AI subscription or API keys. Keys are encrypted on this computer and only sent to the provider they belong to.
      </p>
      <div className="flex min-h-[41px] items-center border-b border-row-line py-[9px]">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-foreground">Claude</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{MODELS.filter((m) => m.provider === "claude").map((m) => m.label.replace("Claude ", "")).join(", ")}</div>
        </div>
        <span className={cx("flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px]", claude?.loggedIn ? "border-input text-foreground" : "border-amber-500/60 text-amber-400")}>
          {claude?.loggedIn && <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />}
          {claude === undefined ? "Checking status…" : claude.loggedIn ? "Signed in" : "Not connected"}
        </span>
      </div>
      <div className="flex min-h-[41px] items-center border-b border-row-line py-[9px]">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-foreground">Codex</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{codexNote}</div>
        </div>
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
      </div>
      <h2 className="mt-[19px] mb-3 text-[14px] font-semibold text-foreground">AI providers</h2>
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <ProviderRow key={p.id} record={p} onOpen={() => onOpen(p.id)} />
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center gap-3.5 rounded-[12px] border border-row-line px-4 py-3 text-left transition-colors hover:bg-foreground/[0.04]"
        >
          <ProviderIcon add />
          <div className="min-w-0 flex-1 text-[14px] font-semibold text-foreground">Add custom provider</div>
          <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
        </button>
      </div>
      <p className="mt-4 text-[12px] text-muted-foreground">
        *Not all models from each provider are supported by {PRODUCT.name}; we are working on validating and adding more models as they fit.
      </p>
    </>
  );
}

function ProviderRow({ record, onOpen }: { record: ProviderRecord; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 rounded-[12px] border border-row-line bg-foreground/[0.015] px-4 py-3 text-left transition-colors hover:bg-foreground/[0.04]"
    >
      <ProviderIcon id={record.id} custom={!record.builtIn} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-5 text-foreground">{record.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          {record.builtIn && "multi" in record && record.multi ? <Link2 size={11} strokeWidth={1.5} className="shrink-0" /> : null}
          <span className="truncate">{record.builtIn ? providerSubtitle(record) : record.models.map((m) => m.id).join(" · ")}</span>
        </div>
      </div>
      <StatusPill set={!!record.keyMasked} />
      <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
    </button>
  );
}

const StatusPill = ({ set }: { set: boolean }) => (
  <span className={cx("flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px]", set ? "border-[#3b82f6]/50 text-[#3b82f6]" : "border-row-line text-muted-foreground")}>
    <span className={cx("h-1.5 w-1.5 rounded-full", set ? "bg-[#3b82f6]" : "bg-muted-foreground/60")} />
    {set ? "API key set" : "Not connected"}
  </span>
);

// ---- Provider tiles --------------------------------------------------------------------------------
/** Brand glyphs (Simple Icons) for the built-ins; monograms and a stack mark for the rest. */
const GLYPHS: Record<string, ReactNode> = {
  deepseek: (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden>
      <path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45" />
    </svg>
  ),
  zen: (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
      <path d="M22 24H2V0h20zM17 4.8H7v14.4h10z" />
    </svg>
  ),
  zai: <span className="text-[18px] leading-none font-bold">Z</span>,
  kimi: <span className="text-[8.5px] leading-none font-bold tracking-[0.1em]">KIMI</span>,
};

/** A custom provider's mark: two stacked shapes, as the add and edit pages show. */
const StackGlyph = ({ size }: { size: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
    <rect x="3" y="3.5" width="18" height="7.2" rx="2.6" />
    <rect x="3" y="13.3" width="18" height="7.2" rx="2.6" />
  </svg>
);

function ProviderIcon({ id, custom, add, size = 40 }: { id?: string; custom?: boolean; add?: boolean; size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-[10px] bg-[#1f1f20] text-white select-none">
      {add ? (
        <Plus size={Math.round(size * 0.45)} strokeWidth={1.75} />
      ) : custom ? (
        <StackGlyph size={Math.round(size * 0.5)} />
      ) : (
        (id && GLYPHS[id]) ?? <span className="text-[16px] leading-none font-bold">{id?.[0]?.toUpperCase()}</span>
      )}
    </div>
  );
}

// ---- A built-in provider: its key is all a person can change ---------------------------------------------------
function BuiltInProviderPage({ record }: { record: ProviderRecord }) {
  const builtIn = builtInProvider(record.id)!;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Saving and clearing both end by reading the list again; a failure stays on the page to read.
  const change = (request: Promise<void>) => {
    setBusy(true);
    setError(undefined);
    void request
      .then(() => setDraft(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => void refreshProviders().finally(() => setBusy(false)));
  };
  const save = () => {
    if (draft?.trim() && !busy) change(bridge.setProviderKey(record.id, draft.trim()));
  };
  const clear = () => {
    if (!busy) change(bridge.clearProviderKey(record.id));
  };
  return (
    <>
      <ProviderHeader record={record} subtitle={providerSubtitle(builtIn)} />
      <h2 className="mt-[19px] mb-2 text-[14px] font-semibold text-foreground">Get started</h2>
      <p className="mb-3 text-[13px] text-foreground">{builtIn.getStarted.text}</p>
      <button type="button" onClick={() => void bridge.openProviderKeysPage(record.id)} className={cx(GHOST, "px-3.5")}>
        {builtIn.getStarted.button} <ArrowUpRight size={13} strokeWidth={1.5} className="text-muted-foreground" />
      </button>
      <h2 className="mt-[19px] mb-2 text-[14px] font-semibold text-foreground">Authentication</h2>
      <Field label={builtIn.authLabel}>
        <div className="flex items-center gap-2">
          <input
            value={draft ?? record.keyMasked ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your key"
            spellCheck={false}
            autoComplete="off"
            className={cx(INPUT, "font-mono text-[12.5px]")}
          />
          <button type="button" onClick={save} disabled={!draft?.trim() || busy} className={PRIMARY}>
            Save
          </button>
          <button type="button" onClick={clear} disabled={busy} className={GHOST}>
            Clear
          </button>
        </div>
      </Field>
      {record.keyMasked && <p className="mt-2.5 text-[13px] text-muted-foreground">A key is already saved — enter a new one to replace it:</p>}
      {error && <p role="alert" className="mt-2.5 text-[12px] text-destructive">{error}</p>}
    </>
  );
}

/** The page header: tile, name, models line and connection pill, as the reference lays it out. */
function ProviderHeader({ record, subtitle }: { record: ProviderRecord; subtitle: string }) {
  return (
    <div className="mb-7 flex items-center gap-4">
      <ProviderIcon id={record.id} custom={!record.builtIn} size={46} />
      <div className="min-w-0 flex-1">
        <div className="text-[22px] leading-7 font-semibold text-foreground">{record.name}</div>
        <div className="truncate text-[13px] text-muted-foreground">{subtitle}</div>
      </div>
      <StatusPill set={!!record.keyMasked} />
    </div>
  );
}

// ---- A custom provider: endpoint, key and models, added, changed and removed from one page --------
interface ModelRow {
  id: string;
  contextWindow: string;
  maxTokens: string;
  images: boolean;
}

const EMPTY_ROW: ModelRow = { id: "", contextWindow: "", maxTokens: "", images: false };

function CustomProviderPage({ record, onRemoved }: { record: ProviderRecord; onRemoved: () => void }) {
  return (
    <>
      <ProviderHeader record={record} subtitle={record.models.map((m) => m.id).join(" · ")} />
      <ProviderForm record={record} onRemoved={onRemoved} />
    </>
  );
}

function AddProviderPage({ onDone }: { onDone: () => void }) {
  return (
    <>
      <div className="mb-7 flex items-center gap-4">
        <ProviderIcon custom size={46} />
        <div className="min-w-0 flex-1">
          <div className="text-[22px] leading-7 font-semibold text-foreground">Custom provider</div>
          <div className="truncate text-[13px] text-muted-foreground">Connect any OpenAI or Anthropic compatible API</div>
        </div>
        <StatusPill set={false} />
      </div>
      <ProviderForm onSubmitted={onDone} />
    </>
  );
}

/** The endpoint, key and model fields, shared by the add and edit pages. */
function ProviderForm({ record, onSubmitted, onRemoved }: { record?: ProviderRecord; onSubmitted?: () => void; onRemoved?: () => void }) {
  const [name, setName] = useState(record?.name ?? "");
  const [apiType, setApiType] = useState<ApiType>(record?.apiType ?? "openai-completions");
  const [baseUrl, setBaseUrl] = useState(record?.baseUrl ?? "");
  const [key, setKey] = useState<string | null>(null); // null: untouched (the saved key, if any, shows)
  const [rows, setRows] = useState<ModelRow[]>(
    record?.models.map((m) => ({ id: m.id, contextWindow: m.contextWindow ? String(m.contextWindow) : "", maxTokens: m.maxTokens ? String(m.maxTokens) : "", images: !!m.images })) ?? [EMPTY_ROW],
  );
  const [advanced, setAdvanced] = useState(false);
  const [headers, setHeaders] = useState(record?.headers ? JSON.stringify(record.headers, null, 2) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const parsedHeaders = (() => {
    if (!headers.trim()) return undefined;
    try {
      const value: unknown = JSON.parse(headers);
      if (value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string")) {
        return value as Record<string, string>;
      }
    } catch {
      // falls through
    }
    return null;
  })();
  const valid = !!name.trim() && /^https?:\/\//i.test(baseUrl.trim()) && rows.some((r) => r.id.trim()) && parsedHeaders !== null;

  const submit = () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    const draft: ProviderDraft = {
      ...(record ? { id: record.id } : {}),
      name: name.trim(),
      apiType,
      baseUrl: baseUrl.trim(),
      models: rows.filter((r) => r.id.trim()).map((r) => ({ id: r.id.trim(), contextWindow: Number(r.contextWindow) || 0, maxTokens: Number(r.maxTokens) || 0, ...(r.images ? { images: true } : {}) })),
      ...(parsedHeaders ? { headers: parsedHeaders } : {}),
      // An untouched field keeps the saved key; an emptied one clears it.
      ...(key !== null ? { key } : {}),
    };
    void bridge
      .saveProvider(draft)
      .then(() => refreshProviders())
      .then(() => {
        setKey(null);
        onSubmitted?.();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (!onRemoved || busy || !record) return;
    setBusy(true);
    void bridge
      .removeProvider(record.id)
      .then(() => refreshProviders())
      .then(onRemoved)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
  };

  const setRow = (at: number, patch: Partial<ModelRow>) => setRows((all) => all.map((r, i) => (i === at ? { ...r, ...patch } : r)));
  const digits = (v: string) => v.replace(/[^\d]/g, "");

  return (
    <>
      <h2 className="mt-[19px] mb-3 text-[14px] font-semibold text-foreground">Provider</h2>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My provider" spellCheck={false} className={INPUT} />
        </Field>
        <Field label="API type">
          <div className="relative">
            <select value={apiType} onChange={(e) => setApiType(e.target.value as ApiType)} className={`h-10 w-full appearance-none rounded-[8px] border border-input bg-transparent pr-9 pl-3 text-[13px] text-foreground outline-none ${FOCUS}`}>
              {API_TYPES.map((t) => (
                <option key={t.value} value={t.value} className="bg-popover text-foreground">
                  {t.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown size={12} strokeWidth={1.5} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
          </div>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Base URL">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} className={cx(INPUT, "font-mono text-[12.5px]")} />
        </Field>
      </div>

      <h2 className="mt-[19px] mb-3 text-[14px] font-semibold text-foreground">Authentication & models</h2>
      <Field label="API key">
        <input
          value={key ?? record?.keyMasked ?? ""}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Optional"
          spellCheck={false}
          autoComplete="off"
          className={cx(INPUT, "font-mono text-[12.5px]")}
        />
      </Field>
      {key !== null && !key && record?.keyMasked ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Saving clears the saved key.</p>
      ) : key === null && record?.keyMasked ? (
        <p className="mt-2 text-[13px] text-muted-foreground">A key is already saved — enter a new one to replace it:</p>
      ) : !record?.keyMasked ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Leave blank if your endpoint doesn't require a key.</p>
      ) : null}

      <div className="mt-5 flex flex-col gap-4">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_150px_150px_56px_36px] items-end gap-3">
            <Field label="Model ID">
              <input value={row.id} onChange={(e) => setRow(i, { id: e.target.value })} placeholder="my-model-id" spellCheck={false} className={cx(INPUT, "font-mono text-[12.5px]")} />
            </Field>
            <Field label="Context window">
              <input value={row.contextWindow} onChange={(e) => setRow(i, { contextWindow: digits(e.target.value) })} placeholder="512000" inputMode="numeric" className={cx(INPUT, "font-mono text-[12.5px]")} />
            </Field>
            <Field label="Max tokens">
              <input value={row.maxTokens} onChange={(e) => setRow(i, { maxTokens: digits(e.target.value) })} placeholder="512000" inputMode="numeric" className={cx(INPUT, "font-mono text-[12.5px]")} />
            </Field>
            {/* Whether the model reads pictures: then it sees the screenshots it takes of the canvas. */}
            <Field label="Images">
              <div className="flex h-10 items-center">
                <input
                  type="checkbox"
                  checked={row.images}
                  onChange={(e) => setRow(i, { images: e.target.checked })}
                  title="The model reads pictures"
                  className="h-4 w-4 accent-[#3b82f6]"
                />
              </div>
            </Field>
            <button
              type="button"
              aria-label="Remove model"
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
              className="flex h-10 w-9 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-[13px] text-muted-foreground">Each model appears under this provider in the model picker</p>
        <button type="button" onClick={() => setRows((all) => [...all, EMPTY_ROW])} className={GHOST_SM}>
          <Plus size={13} strokeWidth={1.5} /> Add model
        </button>
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="mt-6 flex w-full items-center justify-between rounded-[8px] border border-row-line px-4 py-2.5 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.03]"
      >
        Advanced <ChevronRight size={14} strokeWidth={1.5} className={cx("text-muted-foreground transition-transform", advanced && "rotate-90")} />
      </button>
      {advanced && (
        <div className="mt-3">
          <Field label="Extra headers (JSON)">
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={'{"x-api-key": "…"}'}
              className={cx(INPUT, "resize-none py-2 font-mono text-[12px]")}
            />
          </Field>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Sent with every request. OpenAI Completions providers only.</p>
          {parsedHeaders === null && <p className="mt-1.5 text-[12px] text-destructive">That isn't a JSON object of strings.</p>}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        {record ? (
          <>
            <button type="button" onClick={submit} disabled={!valid || busy} className={PRIMARY}>
              Save changes
            </button>
            <button type="button" onClick={remove} disabled={busy} className={DANGER}>
              <Trash2 size={13} strokeWidth={1.5} /> Remove
            </button>
          </>
        ) : (
          <button type="button" onClick={submit} disabled={!valid || busy} className={PRIMARY}>
            Add provider
          </button>
        )}
        {error && <span className="text-[12px] text-destructive">{error}</span>}
      </div>
    </>
  );
}

// ---- Pieces ----------------------------------------------------------------------------------------
// Inputs share the reference's focus treatment: a crisp blue ring (border + 1px halo) while focused.
const FOCUS = "focus:border-[#3b82f6] focus:ring-1 focus:ring-[#3b82f6]";
const INPUT = `h-10 w-full rounded-[8px] border border-input bg-transparent px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground ${FOCUS}`;
const PRIMARY = "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40";
const GHOST = "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[8px] border border-input px-3.5 text-[13px] text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-default disabled:opacity-40";
const GHOST_SM = "flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-input px-3 text-[12.5px] text-foreground transition-colors hover:bg-foreground/5";
const DANGER = "flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[13px] text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-default disabled:opacity-40";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] text-foreground">{label}</div>
      {children}
    </label>
  );
}
