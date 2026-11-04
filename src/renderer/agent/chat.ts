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
import { store, type ChatItem, type Session } from "../store.js";
import type { Attachment } from "../../agent/attachments.js";
import { sent } from "./attach.js";
import type { PromptPart } from "./prompt-doc.js";

const pngUrl = (png: Uint8Array) => URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));

function push(item: ChatItem) {
  store.set((s) => ({ chat: [...s.chat, item] }));
}
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
function updateStep(agent: number | undefined, index: number, patch: Partial<StepItem>) {
  store.set((s) => {
    const at = stepAt(s.chat, agent, index);
    return at < 0 ? {} : { chat: s.chat.map((c, i) => (i === at ? { ...(c as StepItem), ...patch } : c)) };
  });
}

/** Top-level frames before this run; cleared once the view has been fitted to a new one. */
let framesBefore: Set<string> | undefined;
/** Steps whose elements landed while they were written (the cursor already followed them), as "agent:index". */
const landed = new Set<string>();
/** A team is running: one agent finishing doesn't end the run. */
let teamRunning = false;
/** Seconds of this run's earlier variations ("Let it cook"); the last one's time is what's left. */
let iteratedSeconds = 0;
/** What the chat shows for each further variation (Pen's words). */
const ITERATING = "Iterating more on the design…";

/** The first time the agent adds a top-level frame, fits the view to it once it can be laid out (its fonts may still be loading). */
function fitNewFrame(): void {
  if (!framesBefore || childIds(doc, ROOT_ID).every((id) => framesBefore!.has(id))) return;
  framesBefore = undefined;
  void laidOut().then(() => zoomToFit());
}

/** The run is over: cards for steps that never ran go, and the chat says how long it took. */
function finished(seconds: number) {
  hideCursor();
  teamRunning = false;
  seconds = Math.max(0, seconds - iteratedSeconds);
  iteratedSeconds = 0;
  store.set((s) => ({ agentStatus: null, chat: s.chat.filter((c) => !(c.kind === "step" && c.state === "running")) }));
  // A run the person stopped says so, as in Pen, instead of how long it took.
  push(stopping ? { kind: "stopped" } : { kind: "designed", seconds });
  stopping = false;
  schedule();
}

/** The person pressed Stop: the run's end says so, and the stop's own error isn't shown. */
let stopping = false;
export function stopAgent(): void {
  if (!store.get().agentStatus && !store.get().chat.some((c) => c.kind === "step" && c.state === "running")) return;
  stopping = true;
  void bridge.stopAgent();
}

export function handleAgentEvent(e: TaggedEvent): void {
  const agent = "agent" in e ? e.agent : undefined;
  const tag = agent === undefined ? {} : { agent };
  const who = { agent: agent ?? 0, ...AGENTS[agent ?? 0]! };
  switch (e.type) {
    case "team-started":
      framesBefore = new Set(childIds(doc, ROOT_ID));
      landed.clear();
      teamRunning = true;
      store.set((s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      push({ kind: "team", mode: e.mode, count: e.count });
      break;
    case "team-proposal":
      push({ kind: "proposal", text: e.text, agent: e.agent });
      break;
    case "team-plan":
      push({ kind: "plan", text: e.text, parts: e.parts });
      break;
    case "team-done":
      finished(Math.round(e.durationMs / 1000));
      break;
    case "started":
      // An agent of a team (its events carry its place), even if the team's own start went unseen.
      if (agent !== undefined && !teamRunning) {
        teamRunning = true;
        framesBefore = new Set(childIds(doc, ROOT_ID));
        store.set((s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      } else if (!teamRunning) {
        framesBefore = new Set(childIds(doc, ROOT_ID));
        landed.clear();
        store.set((s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      }
      push({ kind: "agent-head", name: e.name, model: modelLabel(e.model, store.get().codexModels, store.get().providers), ...tag });
      break;
    case "thought":
      push({ kind: "thought", seconds: e.seconds, ...tag });
      break;
    // The card appears as soon as the agent starts writing the step (step-writing); step-start
    // covers a step whose writing wasn't seen.
    case "step-writing":
    case "step-start":
      store.set({ agentStatus: null });
      if (stepAt(store.get().chat, agent, e.index) >= 0) updateStep(agent, e.index, { title: e.title });
      else push({ kind: "step", index: e.index, title: e.title, state: "running", ...tag });
      break;
    case "step-target": {
      const s = currentScene();
      const at = s && targetPoint(e.target, s);
      if (at) moveCursor([at], who);
      break;
    }
    // A statement of the step being written has landed.
    case "step-progress":
      landed.add(`${agent}:${e.index}`);
      moveCursor(aimPath(e.focus), who);
      fitNewFrame();
      break;
    case "step-end":
      updateStep(agent, e.step.index, {
        state: e.step.ok ? "ok" : "failed",
        script: e.detail.script,
        ...(e.detail.input ? { input: e.detail.input } : {}),
        ...(e.detail.markdown ? { markdown: true } : {}),
        output: e.detail.output,
        pictures: e.detail.pictures.map((p) => ({ url: pngUrl(p.png), width: p.width, height: p.height })),
      });
      if (!teamRunning) store.set({ agentStatus: "thinking" });
      // A step that landed all at once (a patched one); one that landed as it was written stays put.
      if (e.focus && !landed.has(`${agent}:${e.step.index}`)) moveCursor(aimPath(e.focus), who);
      fitNewFrame();
      schedule();
      break;
    case "text":
      // Codex sends deltas: append to its message even when team events interleave.
      if (e.streamId) {
        store.set((s) => {
          const index = s.chat.findIndex((c) => c.kind === "text" && c.streamId === e.streamId && c.agent === agent);
          if (index < 0) return { chat: [...s.chat, { kind: "text", text: e.text, streamId: e.streamId, ...tag }] };
          return { chat: s.chat.map((c, i) => i === index && c.kind === "text" ? { ...c, text: c.text + e.text } : c) };
        });
      } else push({ kind: "text", text: e.text, ...tag });
      break;
    // One design is done and the next variation starts: its time, then Pen's message, then the agent again.
    case "iterating": {
      iteratedSeconds += e.seconds;
      store.set((s) => ({ chat: s.chat.filter((c) => !(c.kind === "step" && c.state === "running")) }));
      push({ kind: "designed", seconds: e.seconds });
      push({ kind: "user", text: ITERATING });
      const head = store.get().chat.findLast((c) => c.kind === "agent-head" && c.agent === agent);
      if (head) push({ ...head });
      store.set({ agentStatus: "planning" });
      break;
    }
    case "done":
      if (!teamRunning) finished(Math.round(e.stats.durationMs / 1000));
      else {
        // One of the team is done: its cursor goes, and its unfinished cards.
        hideCursor(agent);
        store.set((s) => ({ chat: s.chat.filter((c) => !(c.kind === "step" && c.state === "running" && c.agent === agent)) }));
      }
      break;
    case "error":
      if (!stopping) push({ kind: "error", text: e.message, ...tag });
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
  push({
    kind: "user",
    text: text.trim(),
    ...(attachments.length ? { attachments: attachments.map(sent) } : {}),
    ...(parts?.some((p) => typeof p !== "string") ? { parts } : {}),
  });
  store.set((s) => ({ agentStatus: "planning", session: s.session ?? text.trim() }));
  const { model, team, effort, cook } = store.get();
  // "Let it cook" is for one request: it goes back to no variations once sent (as in Pen).
  if (cook.count > 1) store.set({ cook: { ...cook, count: 1 } });
  // Only what the agent needs crosses to the host (not the tray's ids).
  const files = [...attachments, ...skills].map(({ name, kind, mediaType, data }) => ({ name, kind, mediaType, data }));
  void bridge.runAgent((forAgent ?? text).trim(), model, team, effort, cook.count > 1 ? cook : undefined, files.length ? files : undefined);
}

// Past conversations are kept in this window's local storage (STOPGAP: they belong in the document's
// folder or the main process once files are saved; pictures are not kept, attached ones included).
const HISTORY_KEY = "agent-history";
export function loadHistory(): void {
  store.set({ history: JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as Session[] });
}
loadHistory();
const saveHistory = () => localStorage.setItem(HISTORY_KEY, JSON.stringify(store.get().history));
let currentId: string = crypto.randomUUID();

function stripPictures(chat: ChatItem[]): ChatItem[] {
  return chat.map((c) =>
    c.kind === "step" ? { ...c, pictures: [] } : c.kind === "user" && c.attachments ? { ...c, attachments: c.attachments.map((a) => ({ ...a, url: undefined })) } : c,
  );
}

/** Files the current conversation in the history (if it has anything) and starts an empty one. */
export function newSession(): void {
  const s = store.get();
  if (s.agentStatus) return;
  if (s.chat.length) {
    const entry: Session = { id: currentId, title: s.session ?? "Untitled", at: Date.now(), chat: stripPictures(s.chat) };
    store.set({ history: [entry, ...s.history.filter((h) => h.id !== currentId)] });
    saveHistory();
  }
  currentId = crypto.randomUUID();
  store.set({ chat: [], session: null });
}

/** Shows a past conversation (filing the current one first). */
export function openSession(id: string): void {
  const entry = store.get().history.find((h) => h.id === id);
  if (!entry || store.get().agentStatus) return;
  newSession();
  currentId = entry.id;
  store.set({ chat: entry.chat, session: entry.title });
}

export function clearHistory(): void {
  store.set({ history: [] });
  saveHistory();
}

export function formatDuration(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
