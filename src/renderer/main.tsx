// Window entry: connect to the document and engine, then render the editor.
import "./theme.css";
import { createRoot } from "react-dom/client";
import { PRODUCT } from "../product.js";
import type { AgentEvent } from "../agent/agent.js";
import { App } from "./App.js";
import { handleAgentEvent, loadHistory, sendPrompt } from "./agent/chat.js";
import { setView } from "./canvas/canvas.js";
import { boot, bridge, laidOut } from "./scene.js";
import { store, type Tab } from "./store.js";
import { applyTheme, setSetting } from "./settings.js";

document.title = PRODUCT.name;
if (new URLSearchParams(location.search).get("theme") === "light") setSetting("theme", "light");
applyTheme();
// Headless checks can preload the conversation history with ?history=<url>.
const historyUrl = new URLSearchParams(location.search).get("history");
if (historyUrl) {
  localStorage.setItem("agent-history", await (await fetch(historyUrl)).text());
  loadHistory();
}
await boot();
const firstScene = await laidOut();
bridge.onAgentEvent(handleAgentEvent);

// Headless checks set up a state from the address: ?view=x,y,zoom&select=id&tab=layers&chat=events.jsonl
const q = new URLSearchParams(location.search);
const initial = q.get("initial") ?? "Y";
createRoot(document.getElementById("root")!).render(<App initial={initial} />);
// A file started from the Dashboard's prompt: the agent starts on it here, so the chat shows it.
const start = await bridge.startPrompt();
if (start) {
  if (start.model) store.set({ model: start.model });
  sendPrompt(start.text, start.forAgent);
}
if (q.get("view")) {
  const [x, y, zoom] = q.get("view")!.split(",").map(Number);
  setView(x!, y!, zoom!);
}
if (q.get("select")) {
  // "@first" picks the first top-level frame, "@first-child" its first child (fixture ids are random).
  const want = q.get("select")!;
  const first = firstScene.tree.children[0];
  const id = want === "@first" ? first?.id : want === "@first-child" ? first?.children[0]?.id : want;
  store.set({ selection: id ? [id] : [] });
}
if (q.get("tab")) store.set({ tab: q.get("tab") as Tab });
if (q.get("settings")) store.set({ settingsOpen: true });
if (q.get("chat")) {
  const lines = (await (await fetch(q.get("chat")!)).text()).split("\n").filter(Boolean);
  for (const line of lines) {
    const e = JSON.parse(line) as AgentEvent | { type: "user"; text: string };
    if (e.type === "user") {
      store.set((s) => ({ chat: [...s.chat, { kind: "user", text: e.text }] }));
      continue;
    }
    handleAgentEvent(e);
    // Fixture pictures are given by address rather than as bytes.
    if (e.type === "step-end") {
      const urls = (e.detail.pictures as unknown as { url?: string; width: number; height: number }[]).filter((p) => p.url);
      if (urls.length)
        store.set((s) => ({
          chat: s.chat.map((c) => (c.kind === "step" && c.index === e.step.index ? { ...c, pictures: urls as { url: string; width: number; height: number }[] } : c)),
        }));
    }
  }
  if (q.get("running") === null) store.set({ agentStatus: null });
}
requestAnimationFrame(() => requestAnimationFrame(() => document.body.setAttribute("data-ready", "1")));
