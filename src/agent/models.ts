// The models the agent can use. Shared by the agent (main process) and the window (labels).
import { providerModelLabel, type ProviderRecord } from "./providers.js";
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

/** A Claude model as the signed-in Claude CLI offers it (`efforts` absent: it didn't say which). */
export interface ClaudeModel {
  id: string;
  label: string;
  provider: "claude";
  efforts?: string[];
}

/** "Claude Opus 5.5" for claude-opus-5-5; nothing for an id not shaped like that. */
export function claudeLabel(id: string): string | undefined {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  return m ? `Claude ${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : undefined;
}

/** Claude's models until Claude has been asked for its own (and when it can't be), and Codex's default. */
export const MODELS = [
  { id: "claude-fable-5-1", provider: "claude", label: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", provider: "claude", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", provider: "claude", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", provider: "claude", label: "Claude Haiku 5.5" },
  // Codex resolves its configured model, including account-specific model availability.
  { id: "codex", provider: "codex", label: "Codex (default)" },
] as const;
export type ModelBackend = "claude" | "codex" | "provider";
export const modelProvider = (id: string): ModelBackend =>
  id === "codex" || id.startsWith("codex:") ? "codex" : id.startsWith("prov:") ? "provider" : "claude";

export const DEFAULT_MODEL: string = "claude-opus-5-5";
export const modelLabel = (id: string, discovered: readonly { id: string; label: string }[] = [], providers: readonly ProviderRecord[] = []) =>
  discovered.find((m) => m.id === id)?.label ??
  MODELS.find((m) => m.id === id)?.label ??
  providerModelLabel(id, providers) ??
  claudeLabel(id) ??
  id.replace(/^codex:/, "");

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
