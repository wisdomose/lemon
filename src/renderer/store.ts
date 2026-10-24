// The window's state: what panel is open, what is selected, and the agent chat. One small store read
// by React through useSyncExternalStore; the canvas reads it directly.
import { useSyncExternalStore } from "react";
import { DEFAULT_MODEL } from "../agent/models.js";

export type Tab = "agent" | "layers" | "slides" | "components" | "libraries";
export type Tool = "move" | "rect" | "pen" | "text" | "frame" | "note" | "browser" | "hand";

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "agent-head"; name: string; model: string }
  | { kind: "thought"; seconds: number }
  | {
      kind: "step";
      index: number;
      title: string;
      state: "running" | "ok" | "failed";
      script?: string;
      output?: string;
      pictures?: { url: string; width: number; height: number }[];
    }
  | { kind: "text"; text: string }
  | { kind: "designed"; seconds: number }
  | { kind: "error"; text: string };

export interface EditorState {
  tab: Tab;
  tool: Tool;
  selection: string | null;
  hover: string | null;
  zoom: number;
  /** Bumped on every document change, so panels that show the document re-read it. */
  docVersion: number;
  chat: ChatItem[];
  /** The agent is working: "planning" before its first step, "thinking" between steps. */
  agentStatus: "planning" | "thinking" | null;
  /** The chat session's title (its first prompt). */
  session: string | null;
  model: string;
  settingsOpen: boolean;
  /** Past conversations, newest first. */
  history: Session[];
}

export interface Session {
  id: string;
  title: string;
  at: number;
  chat: ChatItem[];
}

const initial: EditorState = {
  tab: "agent",
  tool: "move",
  selection: null,
  hover: null,
  zoom: 1,
  docVersion: 0,
  chat: [],
  agentStatus: null,
  session: null,
  model: DEFAULT_MODEL,
  settingsOpen: false,
  history: [],
};

let state = initial;
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Reads one value from the store; re-renders when it changes. Return primitives or stable objects. */
export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(state));
}
