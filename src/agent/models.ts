// The models the agent can use. Shared by the agent (main process) and the window (labels).
export const MODELS = [
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
] as const;
export const DEFAULT_MODEL: string = "claude-opus-5-5";
export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

/** The agent's name on its cursor and in the chat. A placeholder of our own; not Pen's agent names. */
export const AGENT_NAME = "Pip";
