// Turns agent events from the host into chat items, and sends prompts. Several agents (a team) send
// events tagged with their place in the team; their items carry it and the chat groups them.
import type { TaggedEvent } from "../../agent/team.js";
import { AGENTS, modelLabel } from "../../agent/models.js";
import { hideCursor, moveCursor, schedule, zoomToFit } from "../canvas/canvas.js";
import { bridge, currentScene, doc, laidOut } from "../scene.js";
import { childIds } from "../../doc/store.js";
import { ROOT_ID } from "../../doc/schema.js";
import { targetPoint } from "./targets.js";
import { aimPath } from "./aim.js";
import { store, type ChatItem, type EditorState, type Session } from "../store.js";
import type { Attachment } from "../../agent/attachments.js";
import { sent } from "./attach.js";
import type { PromptPart } from "./prompt-doc.js";

const pngUrl = (png: Uint8Array) => URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));

type Conversation = Pick<EditorState, "chat" | "session" | "agentStatus">;
type Patch = Partial<Conversation> | ((c: Conversation) => Partial<Conversation>);

/** What one agent run keeps while it goes on. */
interface Run {
  /** Top-level frames before this run; cleared once the view has been fitted to a new one. */
  framesBefore?: Set<string>;
  /** Steps whose elements landed while they were written (the cursor already followed them), as "agent:index". */
  landed: Set<string>;
  /** A team is running: one agent finishing doesn't end the run. */
  team: boolean;
  /** Seconds of this run's earlier variations ("Let it cook"); the last one's time is what's left. */
  iterated: number;
  /** The person pressed Stop: the run's end says so, and the stop's own error isn't shown. */
  stopping: boolean;
}

// Past conversations are kept in this window's local storage (STOPGAP: they belong in the document's
// folder or the main process once files are saved; pictures are not kept, attached ones included).
const HISTORY_KEY = "agent-history";
/** The conversation the chat shows. */
let currentId: string = crypto.randomUUID();
/** Runs going on, by conversation: the one shown and any left running when a new one was started. */
const runs = new Map<string, Run>();
/** Conversations with a run going on that aren't shown: their chat goes on here until opened again. */
const held = new Map<string, Conversation>();

const newRun = (): Run => ({ landed: new Set(), team: false, iterated: 0, stopping: false });
const markLive = () => store.set({ liveSessions: [...runs.keys()] });

/** Changes conversation `id`: the chat shown, or one running out of sight. */
function update(id: string, patch: Patch): void {
  if (id === currentId) return store.set((s) => (typeof patch === "function" ? patch(s) : patch));
  const c = held.get(id);
  if (c) held.set(id, { ...c, ...(typeof patch === "function" ? patch(c) : patch) });
}
const read = (id: string): Conversation => (id === currentId ? store.get() : (held.get(id) ?? { chat: [], session: null, agentStatus: null }));
const push = (id: string, item: ChatItem) => update(id, (c) => ({ chat: [...c.chat, item] }));

type StepItem = Extract<ChatItem, { kind: "step" }>;
const isStep = (c: ChatItem, agent: number | undefined, index: number): c is StepItem => c.kind === "step" && c.index === index && c.agent === agent;
/** Where the agent's step `index` is in its current run (each run numbers its steps from 1 again): -1 if not yet there. */
function stepAt(chat: ChatItem[], agent: number | undefined, index: number): number {
  for (let i = chat.length - 1; i >= 0; i--) {
    const c = chat[i]!;
    if (isStep(c, agent, index)) return i;
    if (c.kind === "agent-head" && c.agent === agent) return -1;
  }
  return -1;
}
function updateStep(id: string, agent: number | undefined, index: number, patch: Partial<StepItem>) {
  update(id, (s) => {
    const at = stepAt(s.chat, agent, index);
    return at < 0 ? {} : { chat: s.chat.map((c, i) => (i === at ? { ...(c as StepItem), ...patch } : c)) };
  });
}

/** What each further variation shows in the chat (Pen's words). */
const ITERATING = "Iterating more on the design…";

/** The first time the agent adds a top-level frame, fits the view to it once it can be laid out (its fonts may still be loading). */
function fitNewFrame(id: string, run: Run): void {
  if (!run.framesBefore || childIds(doc, ROOT_ID).every((f) => run.framesBefore!.has(f))) return;
  run.framesBefore = undefined;
  // A conversation running out of sight doesn't move the view.
  if (id === currentId) void laidOut().then(() => zoomToFit());
}

/** The run is over: cards for steps that never ran go, and the chat says how long it took. */
function finished(id: string, run: Run, seconds: number) {
  hideCursor();
  seconds = Math.max(0, seconds - run.iterated);
  update(id, (s) => ({ agentStatus: null, chat: s.chat.filter((c) => !(c.kind === "step" && c.state === "running")) }));
  // A run the person stopped says so, as in Pen, instead of how long it took.
  push(id, run.stopping ? { kind: "stopped" } : { kind: "designed", seconds });
  runs.delete(id);
  markLive();
  // One that finished out of sight goes into the history as it ended.
  const c = held.get(id);
  if (c) {
    held.delete(id);
    file(id, c);
  }
  schedule();
}

export function stopAgent(): void {
  const run = runs.get(currentId);
  if (!run && !store.get().agentStatus && !store.get().chat.some((c) => c.kind === "step" && c.state === "running")) return;
  if (run) run.stopping = true;
  void bridge.stopAgent(currentId);
}

/** An event of the run of conversation `runId` (the one shown when not given). */
export function handleAgentEvent(e: TaggedEvent, runId: string = currentId): void {
  const id = runId;
  let run = runs.get(id);
  if (!run) {
    run = newRun();
    // A run seen only from its start (a fixture's, or one the window missed sending).
    if (e.type === "started" || e.type === "team-started") runs.set(id, run);
  }
  const agent = "agent" in e ? e.agent : undefined;
  const tag = agent === undefined ? {} : { agent };
  const who = { agent: agent ?? 0, ...AGENTS[agent ?? 0]! };
  switch (e.type) {
    case "team-started":
      run.framesBefore = new Set(childIds(doc, ROOT_ID));
      run.landed.clear();
      run.team = true;
      update(id, (s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      push(id, { kind: "team", mode: e.mode, count: e.count });
      markLive();
      break;
    case "team-proposal":
      push(id, { kind: "proposal", text: e.text, agent: e.agent });
      break;
    case "team-plan":
      push(id, { kind: "plan", text: e.text, parts: e.parts });
      break;
    case "team-done":
      finished(id, run, Math.round(e.durationMs / 1000));
      break;
    case "started":
      // An agent of a team (its events carry its place), even if the team's own start went unseen.
      if (agent !== undefined && !run.team) {
        run.team = true;
        run.framesBefore = new Set(childIds(doc, ROOT_ID));
        update(id, (s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      } else if (!run.team) {
        run.framesBefore = new Set(childIds(doc, ROOT_ID));
        run.landed.clear();
        update(id, (s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      }
      markLive();
      push(id, { kind: "agent-head", name: e.name, model: modelLabel(e.model, store.get().codexModels, store.get().providers), ...tag });
      break;
    case "thought":
      push(id, { kind: "thought", seconds: e.seconds, ...tag });
      break;
    // The card appears as soon as the agent starts writing the step (step-writing); step-start
    // covers a step whose writing wasn't seen.
    case "step-writing":
    case "step-start":
      update(id, { agentStatus: null });
      if (stepAt(read(id).chat, agent, e.index) >= 0) updateStep(id, agent, e.index, { title: e.title });
      else push(id, { kind: "step", index: e.index, title: e.title, state: "running", ...tag });
      break;
    case "step-target": {
      const s = currentScene();
      const at = s && targetPoint(e.target, s);
      if (at) moveCursor([at], who);
      break;
    }
    // A statement of the step being written has landed.
    case "step-progress":
      run.landed.add(`${agent}:${e.index}`);
      moveCursor(aimPath(e.focus), who);
      fitNewFrame(id, run);
      break;
    case "step-end":
      updateStep(id, agent, e.step.index, {
        state: e.step.ok ? "ok" : "failed",
        script: e.detail.script,
        ...(e.detail.input ? { input: e.detail.input } : {}),
        ...(e.detail.markdown ? { markdown: true } : {}),
        output: e.detail.output,
        pictures: e.detail.pictures.map((p) => ({ url: pngUrl(p.png), width: p.width, height: p.height })),
      });
      if (!run.team) update(id, { agentStatus: "thinking" });
      // A step that landed all at once (a patched one); one that landed as it was written stays put.
      if (e.focus && !run.landed.has(`${agent}:${e.step.index}`)) moveCursor(aimPath(e.focus), who);
      fitNewFrame(id, run);
      schedule();
      break;
    case "text":
      // Codex sends deltas: append to its message even when team events interleave.
      if (e.streamId) {
        update(id, (s) => {
          const index = s.chat.findIndex((c) => c.kind === "text" && c.streamId === e.streamId && c.agent === agent);
          if (index < 0) return { chat: [...s.chat, { kind: "text", text: e.text, streamId: e.streamId, ...tag }] };
          return { chat: s.chat.map((c, i) => (i === index && c.kind === "text" ? { ...c, text: c.text + e.text } : c)) };
        });
      } else push(id, { kind: "text", text: e.text, ...tag });
      break;
    // One design is done and the next variation starts: its time, then Pen's message, then the agent again.
    case "iterating": {
      run.iterated += e.seconds;
      update(id, (s) => ({ chat: s.chat.filter((c) => !(c.kind === "step" && c.state === "running")) }));
      push(id, { kind: "designed", seconds: e.seconds });
      push(id, { kind: "user", text: ITERATING });
      const head = read(id).chat.findLast((c) => c.kind === "agent-head" && c.agent === agent);
      if (head) push(id, { ...head });
      update(id, { agentStatus: "planning" });
      break;
    }
    case "done":
      if (!run.team) finished(id, run, Math.round(e.stats.durationMs / 1000));
      else {
        // One of the team is done: its cursor goes, and its unfinished cards.
        hideCursor(agent);
        update(id, (s) => ({ chat: s.chat.filter((c) => !(c.kind === "step" && c.state === "running" && c.agent === agent)) }));
      }
      break;
    case "error":
      if (!run.stopping) push(id, { kind: "error", text: e.message, ...tag });
      break;
  }
}

/**
 * Sends a prompt. The chat shows `text` (or `parts`, with its chips); the agent gets `forAgent` (e.g.
 * with canvas references) if given, after the files attached to it and the SKILL.md of each skill
 * chip (`skills`, which the chat doesn't show as attached: the chip says it, as in Pen).
 */
export function sendPrompt(text: string, forAgent?: string, attachments: Attachment[] = [], parts?: PromptPart[], skills: Attachment[] = []): void {
  if (!text.trim() || !bridge.canRunAgent || store.get().agentStatus) return;
  const id = currentId;
  push(id, {
    kind: "user",
    text: text.trim(),
    ...(attachments.length ? { attachments: attachments.map(sent) } : {}),
    ...(parts?.some((p) => typeof p !== "string") ? { parts } : {}),
  });
  store.set((s) => ({ agentStatus: "planning", session: s.session ?? text.trim() }));
  // A new run of this conversation replaces any it had (the host stops that one).
  runs.set(id, newRun());
  markLive();
  const { model, team, effort, cook } = store.get();
  // "Let it cook" is for one request: it goes back to no variations once sent (as in Pen).
  if (cook.count > 1) store.set({ cook: { ...cook, count: 1 } });
  // Only what the agent needs crosses to the host (not the tray's ids).
  const files = [...attachments, ...skills].map(({ name, kind, mediaType, data }) => ({ name, kind, mediaType, data }));
  bridge.runAgent((forAgent ?? text).trim(), model, team, effort, cook.count > 1 ? cook : undefined, files.length ? files : undefined, id).catch((err: unknown) => {
    // A run that never got going (the host refused it) mustn't leave the conversation looking busy.
    if (!runs.has(id)) return;
    push(id, { kind: "error", text: err instanceof Error ? err.message : String(err) });
    update(id, { agentStatus: null });
    runs.delete(id);
    markLive();
  });
}

export function loadHistory(): void {
  store.set({ history: JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Session[] });
}
loadHistory();
const saveHistory = () => localStorage.setItem(HISTORY_KEY, JSON.stringify(store.get().history));

function stripPictures(chat: ChatItem[]): ChatItem[] {
  return chat.map((c) =>
    c.kind === "step" ? { ...c, pictures: [] } : c.kind === "user" && c.attachments ? { ...c, attachments: c.attachments.map((a) => ({ ...a, url: undefined })) } : c,
  );
}

/** Puts conversation `id` at the top of the history (if it has anything). */
function file(id: string, c: Conversation): void {
  if (!c.chat.length) return;
  const entry: Session = { id, title: c.session ?? "Untitled", at: Date.now(), chat: stripPictures(c.chat) };
  store.set((s) => ({ history: [entry, ...s.history.filter((h) => h.id !== id)] }));
  saveHistory();
}

/**
 * Files the current conversation in the history and starts an empty one. A conversation whose agent
 * is still working goes on out of sight (and shows its run in the history until it ends).
 */
export function newSession(): void {
  const s = store.get();
  file(currentId, s);
  if (runs.has(currentId)) held.set(currentId, { chat: s.chat, session: s.session, agentStatus: s.agentStatus });
  currentId = crypto.randomUUID();
  store.set({ chat: [], session: null, agentStatus: null });
}

/** Shows a past conversation, or one still running (filing the current one first). */
export function openSession(id: string): void {
  if (id === currentId) return;
  const live = held.get(id);
  const entry = store.get().history.find((h) => h.id === id);
  if (!live && !entry) return;
  newSession();
  currentId = id;
  if (live) {
    held.delete(id);
    store.set({ chat: live.chat, session: live.session, agentStatus: live.agentStatus });
  } else store.set({ chat: entry!.chat, session: entry!.title, agentStatus: null });
}

export function clearHistory(): void {
  store.set({ history: [] });
  saveHistory();
}

export function formatDuration(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
