// The Agent tab: session row, then the empty state or the conversation with step cards.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronsUpDown, CircleCheck, CircleX, Plus } from "lucide-react";
import { AGENTS } from "../../agent/models.js";
import { useEditor, type ChatItem } from "../store.js";
import { markdown } from "../markdown.js";
import { cx } from "../ui/kit.js";
import { clearHistory, formatDuration, newSession, openSession, sendPrompt } from "./chat.js";
import { DropdownMenu as M } from "radix-ui";
import { MenuContent, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu.js";

// Our own example prompts and tips, laid out as Pen lays out its empty state.
const EXAMPLES = [
  "Calm meditation app with a daily streak and breathing timer",
  "Analytics dashboard for a small online plant shop",
  "Booking page for a boutique bike repair workshop",
  "Editorial homepage for an independent food magazine",
  "Dark-mode control room for a wind farm operator",
  "Playful landing page for a children's coding club",
];
const TIPS = [
  { title: "Save your design", text: ["Use “Save As…” to keep the file in a folder you choose."] },
  {
    title: "Turn it into code",
    text: [
      "Ask the agent to build the design in React, Tailwind or the stack you use.",
      "For one HTML file, select a frame and click “Export HTML” in the properties panel.",
    ],
  },
  { title: "Give it context", text: ["Drop in a screenshot, a brief or any text file, or attach one with +"] },
];

export function AgentPanel() {
  const chat = useEditor((s) => s.chat);
  const session = useEditor((s) => s.session);
  const status = useEditor((s) => s.agentStatus);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-[9px] px-3 pb-3.5">
        <HistoryMenu session={session} running={!!status} />
        <button
          type="button"
          onClick={newSession}
          className="flex h-8 w-[74px] items-center justify-center gap-1.5 rounded-[10px] border border-input bg-select-bg text-[13px] font-semibold text-foreground hover:bg-foreground/5"
        >
          <Plus size={16} strokeWidth={1.5} /> New
        </button>
      </div>
      <div className="h-px bg-line" />
      {chat.length ? <Thread chat={chat} status={status} /> : <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-3 py-4">
      <div className="mb-2.5 text-[13px] font-semibold text-foreground">Ask me to design anything</div>
      <div className="flex flex-col items-start gap-[10px]">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => sendPrompt(e)}
            className="h-7 max-w-full truncate rounded-md border border-input px-2.5 text-left text-[12px] text-foreground hover:bg-foreground/5"
          >
            {e}
          </button>
        ))}
      </div>
      {TIPS.map((t, i) => (
        <div key={t.title} className={i === 0 ? "mt-7" : "mt-5"}>
          <div className="text-[13px] font-semibold text-foreground">{t.title}</div>
          {t.text.map((line) => (
            <p key={line} className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function Thread({ chat, status }: { chat: ChatItem[]; status: "planning" | "thinking" | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [chat, status, atBottom]);
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className="h-full overflow-y-auto pt-3 pr-[17px] pb-6 pl-[13px]"
      >
        <div className="flex flex-col gap-3">
          {arrange(chat).map((unit, i) =>
            Array.isArray(unit) ? <TeamGroups key={i} groups={unit} /> : <Item key={i} item={unit} />,
          )}
          {status && <Working text={status === "planning" ? "Planning next moves" : "Thinking"} />}
        </div>
      </div>
      {!atBottom && (
        <button
          type="button"
          aria-label="Scroll to the latest"
          onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
          className="absolute bottom-2 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-input text-foreground shadow"
        >
          <ChevronDown size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

/**
 * The chat in display order: a team's building (items tagged with an agent, other than proposals) is
 * gathered at the place it began into one group per agent, in team order; everything else stays in
 * the order it came.
 */
function arrange(chat: ChatItem[]): (ChatItem | ChatItem[][])[] {
  const out: (ChatItem | ChatItem[][])[] = [];
  let groups: ChatItem[][] | null = null;
  for (const item of chat) {
    if (item.kind === "team") groups = null;
    if (item.agent === undefined || item.kind === "proposal") {
      out.push(item);
      continue;
    }
    if (!groups) out.push((groups = []));
    (groups[item.agent] ??= []).push(item);
  }
  return out.map((u) => (Array.isArray(u) ? u.filter(Boolean) : u));
}

/** A team's agents, each with its own items under its name. */
function TeamGroups({ groups }: { groups: ChatItem[][] }) {
  return (
    <>
      {groups.map((items, i) => (
        <div key={i} className="flex flex-col gap-3 border-l-2 pl-3" style={{ borderColor: `${AGENTS[items[0]!.agent ?? 0]!.color}55` }}>
          {items.map((item, j) => (
            <Item key={j} item={item} />
          ))}
        </div>
      ))}
    </>
  );
}

/** "Planning next moves…" with dots that step every 0.5s, as in the recordings. */
function Working({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v + 1) % 4), 500);
    return () => clearInterval(t);
  }, []);
  return <div className="text-[13px] text-muted-foreground">{text + ".".repeat(n)}</div>;
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-[52px] rounded-2xl bg-bubble px-4 py-3 text-[13px] leading-5 whitespace-pre-wrap text-foreground">{item.text}</div>
      );
    case "agent-head":
      return (
        <div className="-mb-2 flex items-center gap-1.5 text-[12px]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: AGENTS[item.agent ?? 0]!.color }} />
          <span className="font-semibold text-foreground">{item.name}</span>
          <span className="text-muted-foreground">{item.model}</span>
        </div>
      );
    case "thought":
      return <div className="text-[13px] text-muted-foreground">Thought for {item.seconds}s</div>;
    case "team":
      return (
        <div className="text-[13px] text-muted-foreground">
          {item.count} agents · {item.mode === "split" ? "Split Work: planning together" : "Side by Side: a version each"}
        </div>
      );
    case "proposal": {
      const a = AGENTS[item.agent ?? 0]!;
      return (
        <div className="text-[13px] leading-5">
          <div className="mb-0.5 flex items-center gap-1.5 text-[12px]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: a.color }} />
            <span className="font-semibold text-foreground">{a.name}</span>
            <span className="text-muted-foreground">proposes</span>
          </div>
          <div className="whitespace-pre-wrap text-muted-foreground">{item.text}</div>
        </div>
      );
    }
    case "plan":
      return (
        <div className="rounded-[8px] border border-input px-3 py-2.5 text-[13px] leading-5">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Agreed plan</div>
          <div className="text-foreground">{item.text}</div>
          <div className="mt-2 flex flex-col gap-1">
            {item.parts.map((p) => (
              <div key={p.agent} className="flex items-center gap-1.5 text-[12px]">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: AGENTS[p.agent]!.color }} />
                <span className="font-semibold text-foreground">{AGENTS[p.agent]!.name}</span>
                <span className="truncate text-muted-foreground">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "step":
      return <StepCard step={item} />;
    case "text":
      return <div className="chat-md text-[13px] leading-5 text-foreground" dangerouslySetInnerHTML={{ __html: markdown(item.text) }} />;
    case "designed":
      return <div className="text-[13px] text-muted-foreground">Designed for {formatDuration(item.seconds)}</div>;
    case "error":
      return <div className="text-[13px] text-destructive">{item.text}</div>;
  }
}

function StepCard({ step }: { step: Extract<ChatItem, { kind: "step" }> }) {
  const [open, setOpen] = useState(false);
  const picture = step.pictures?.[0];
  return (
    <div className="overflow-hidden rounded-[8px] border border-input">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-[28px] w-full items-center gap-1.5 px-2 text-left text-[11px] font-semibold text-foreground"
      >
        <span className="truncate">{step.title}</span>
        {step.state === "ok" && <CircleCheck size={12} strokeWidth={1.75} className="shrink-0 text-[#22c55e]" />}
        {step.state === "failed" && <CircleX size={14} strokeWidth={1.75} className="shrink-0 text-destructive" />}
        {step.state === "running" && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-transparent" />}
        <ChevronsUpDown size={14} strokeWidth={1.5} className="ml-auto shrink-0 text-muted-foreground" />
      </button>
      {picture && !open && (
        <div className="border-t border-input px-[9px] pt-[7px] pb-[10px]">
          <img src={picture.url} alt="" className="max-h-[300px] w-full object-cover object-top" />
        </div>
      )}
      {open && (
        <div className={cx("border-t border-input text-[12px] leading-[18px]")}>
          {step.pictures?.map((p) => (
            <div key={p.url} className="px-3 pt-3">
              <img src={p.url} alt="" className="w-full rounded-md border border-line" />
            </div>
          ))}
          {step.output && <pre className="max-h-[220px] overflow-auto px-3 py-3 font-sans whitespace-pre-wrap text-foreground">{step.output}</pre>}
          {step.script && (
            <div className="border-t border-input px-3 py-3">
              <div className="mb-1 text-[11px] tracking-wide text-muted-foreground uppercase">Script</div>
              <pre className="max-h-[260px] overflow-auto font-mono text-[12px] whitespace-pre text-[#60a5fa]">{step.script}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** The session picker: the current conversation's title, opening the history grouped by day. */
function HistoryMenu({ session, running }: { session: string | null; running: boolean }) {
  const history = useEditor((s) => s.history);
  const groups = groupByDay(history);
  return (
    <M.Root>
      <M.Trigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-input bg-select-bg px-3 text-left text-[13px] text-muted-foreground"
        >
          <span className="overflow-hidden whitespace-nowrap">{session ?? "New Agent"}</span>
          {running && <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#3b82f6]" />}
          <ChevronDown size={14} strokeWidth={1.5} className="ml-auto shrink-0 text-muted-foreground" />
        </button>
      </M.Trigger>
      <MenuContent align="start" sideOffset={4} className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {groups.length === 0 && <div className="px-2 py-1.5 text-muted-foreground">No earlier conversations</div>}
        {groups.map(([label, items]) => (
          <div key={label}>
            <MenuLabel caps={false}>{label}</MenuLabel>
            {items.map((h) => (
              <MenuItem
                key={h.id}
                label={<span className="block max-w-[240px] truncate text-[11px] font-semibold">{h.title}</span>}
                current={h.title === session}
                plain
                onSelect={() => openSession(h.id)}
              />
            ))}
          </div>
        ))}
        {groups.length > 0 && (
          <>
            <MenuSeparator />
            <MenuItem label="Clear Agent History" danger onSelect={clearHistory} />
          </>
        )}
      </MenuContent>
    </M.Root>
  );
}

function groupByDay(history: { id: string; title: string; at: number }[]): [string, typeof history][] {
  const day = 86_400_000;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t = start.getTime();
  const label = (at: number) => (at >= t ? "Today" : at >= t - day ? "Yesterday" : at >= t - 7 * day ? "Previous 7 days" : "Older");
  const out = new Map<string, typeof history>();
  for (const h of history) {
    const l = label(h.at);
    out.set(l, [...(out.get(l) ?? []), h]);
  }
  return [...out];
}
