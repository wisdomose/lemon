// The window's state: what panel is open, what is selected, and the agent chat. One small store read
// by React through useSyncExternalStore; the canvas reads it directly.
import { useSyncExternalStore } from "react";
import { DEFAULT_MODEL, type Team, type CodexModel } from "../agent/models.js";
import { PRODUCT } from "../product.js";
import type { FileInfo } from "../main/editor.js";

export type Tab = "agent" | "layers" | "slides" | "components" | "libraries";
export type Tool = "move" | "rect" | "ellipse" | "polygon" | "icon" | "script" | "pen" | "text" | "frame" | "note" | "browser" | "hand" | "comment";

/**
 * One thing in the chat. Items from one of several agents carry `agent` (its place in the team), and
 * the chat groups them under that agent.
 */
export type ChatItem = (
  | { kind: "user"; text: string }
  | { kind: "agent-head"; name: string; model: string }
  | { kind: "thought"; seconds: number }
  /** Several agents start on a request. */
  | { kind: "team"; mode: Team["mode"]; count: number }
  /** One agent's proposal while the team plans (Split Work). */
  | { kind: "proposal"; text: string }
  /** The plan the team agreed: the look, and who builds what. */
  | { kind: "plan"; text: string; parts: { agent: number; name: string }[] }
  | {
      kind: "step";
      index: number;
      title: string;
      state: "running" | "ok" | "failed";
      script?: string;
      output?: string;
      pictures?: { url: string; width: number; height: number }[];
    }
  | { kind: "text"; text: string; streamId?: string }
  | { kind: "designed"; seconds: number }
  | { kind: "error"; text: string }
) & { agent?: number };

export interface EditorState {
  tab: Tab;
  tool: Tool;
  /** Selected nodes, in the order they were picked (the last is the one panels show first). */
  selection: string[];
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
  /** Session cache stays visible while the picker refreshes its live Codex catalog. */
  codexModels: CodexModel[];
  codexModelsState: "idle" | "loading" | "ready" | "error";
  codexModelsError?: string;
  /** Selected Codex effort; undefined delegates to the model's server-side default. */
  effort?: string;
  /** How many agents the next request goes to, and how they share it (the ⚡ choice). */
  team: Team;
  settingsOpen: boolean;
  /** Past conversations, newest first. */
  history: Session[];
  /** The file this window shows. */
  file: FileInfo;
  /** A card's kind menu, open at a screen point (a click on a selected card's header). */
  cardMenu: { id: string; x: number; y: number } | null;
  /** The browser node whose address is being typed. */
  urlEdit: string | null;
  /** The browser node whose page is in use (a double-click): the pointer, wheel and keys go to the page. */
  browserLive: string | null;
  /** A comment being written where the Comment tool clicked (on a node, from its corner, or on the page). */
  commentDraft: { node?: string; x: number; y: number } | null;
  /** The comment thread shown beside its pin. */
  commentOpen: string | null;
  /** Comment pins on the canvas (Shift+C, or the eye in the Comments panel). */
  showComments: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  /** The left column (panel and chat box), Ctrl+\. */
  panelOpen: boolean;
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
  selection: [],
  hover: null,
  zoom: 1,
  docVersion: 0,
  chat: [],
  agentStatus: null,
  session: null,
  model: DEFAULT_MODEL,
  codexModels: [],
  codexModelsState: "idle",
  team: { count: 1, mode: "split" },
  settingsOpen: false,
  history: [],
  file: { name: `untitled.${PRODUCT.fileExtension}`, state: "saved", draft: true },
  cardMenu: null,
  urlEdit: null,
  browserLive: null,
  commentDraft: null,
  commentOpen: null,
  showComments: true,
  shortcutsOpen: false,
  paletteOpen: false,
  panelOpen: true,
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
