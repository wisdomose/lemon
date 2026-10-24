// The models the agent can use. Shared by the agent (main process) and the window (labels).
export const MODELS = [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }] as const;
export const DEFAULT_MODEL = MODELS[0].id;
export const modelLabel = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

/** The agent's name on its cursor and in the chat. A placeholder of our own; not Pen's agent names. */
export const AGENT_NAME = "Pip";
