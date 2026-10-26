// The models the agent can use. Shared by the agent (main process) and the window (labels).
/** Public model metadata shared across IPC; Codex retains ownership of account credentials. */
export interface CodexModel {
  id: string;
  label: string;
  description: string;
  provider: "codex";
  efforts: { id: string; description: string }[];
  defaultEffort?: string;
  isDefault: boolean;
}

export const MODELS = [
  { id: "claude-fable-5-1", provider: "claude", label: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", provider: "claude", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", provider: "claude", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", provider: "claude", label: "Claude Haiku 5.5" },
  // Codex resolves its configured model, including account-specific model availability.
  { id: "codex", provider: "codex", label: "Codex (default)" },
] as const;
export const modelProvider = (id: string): "claude" | "codex" => id === "codex" || id.startsWith("codex:") ? "codex" : "claude";

export const DEFAULT_MODEL: string = "claude-opus-5-5";
export const modelLabel = (id: string, discovered: readonly CodexModel[] = []) =>
  discovered.find((m) => m.id === id)?.label ?? MODELS.find((m) => m.id === id)?.label ?? id.replace(/^codex:/, "");

/**
 * The agents' names and cursor colours, in the order they join a run (one agent is the first). Our own
 * citrus set (decided 26 Oct 2026); Pen's name sets must not be used.
 */
export const AGENTS = [
  { name: "Pip", color: "#a855f7" },
  { name: "Zest", color: "#f97316" },
  { name: "Rind", color: "#14b8a6" },
  { name: "Yuzu", color: "#eab308" },
  { name: "Lime", color: "#84cc16" },
  { name: "Kumquat", color: "#ec4899" },
] as const;
export const MAX_AGENTS = AGENTS.length;

/** How several agents share one request: parts of one design, or a version each. */
export type TeamMode = "split" | "side";
export interface Team {
  count: number;
  mode: TeamMode;
}
