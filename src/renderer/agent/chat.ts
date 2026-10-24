// Turns agent events from the host into chat items, and sends prompts.
import type { AgentEvent } from "../../agent/agent.js";
import { modelLabel } from "../../agent/models.js";
import { cursor, schedule, zoomToFit } from "../canvas/canvas.js";
import { bridge } from "../scene.js";
import { store, type ChatItem } from "../store.js";

const pngUrl = (png: Uint8Array) => URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));

function push(item: ChatItem) {
  store.set((s) => ({ chat: [...s.chat, item] }));
}
function updateStep(index: number, patch: Partial<Extract<ChatItem, { kind: "step" }>>) {
  store.set((s) => ({
    chat: s.chat.map((c) => (c.kind === "step" && c.index === index ? { ...c, ...patch } : c)),
  }));
}

export function handleAgentEvent(e: AgentEvent): void {
  switch (e.type) {
    case "started":
      cursor.name = e.name;
      store.set((s) => ({ agentStatus: "planning", session: s.session ?? e.prompt }));
      push({ kind: "agent-head", name: e.name, model: modelLabel(e.model) });
      break;
    case "thought":
      push({ kind: "thought", seconds: e.seconds });
      break;
    case "step-start":
      store.set({ agentStatus: null });
      push({ kind: "step", index: e.index, title: e.title, state: "running" });
      break;
    case "step-end":
      updateStep(e.step.index, {
        state: e.step.ok ? "ok" : "failed",
        script: e.detail.script,
        output: e.detail.output,
        pictures: e.detail.pictures.map((p) => ({ url: pngUrl(p.png), width: p.width, height: p.height })),
      });
      store.set({ agentStatus: "thinking" });
      if (e.focus) {
        if (!cursor.shown) cursor.since = performance.now();
        Object.assign(cursor, { x: e.focus.x, y: e.focus.y, shown: true });
      }
      if (e.step.index === 1) zoomToFit();
      schedule();
      break;
    case "text":
      push({ kind: "text", text: e.text });
      break;
    case "done":
      cursor.shown = false;
      store.set({ agentStatus: null });
      push({ kind: "designed", seconds: Math.round(e.stats.durationMs / 1000) });
      schedule();
      break;
    case "error":
      push({ kind: "error", text: e.message });
      break;
  }
}

export function sendPrompt(text: string): void {
  if (!text.trim() || !bridge.canRunAgent || store.get().agentStatus) return;
  push({ kind: "user", text: text.trim() });
  store.set((s) => ({ agentStatus: "planning", session: s.session ?? text.trim() }));
  void bridge.runAgent(text.trim(), store.get().model);
}

export function newSession(): void {
  if (store.get().agentStatus) return;
  store.set({ chat: [], session: null });
}

export function formatDuration(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
