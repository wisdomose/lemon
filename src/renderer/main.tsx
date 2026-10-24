// Window entry: connect to the document and engine, then render the editor.
import "./theme.css";
import { createRoot } from "react-dom/client";
import { PRODUCT } from "../product.js";
import type { AgentEvent } from "../agent/agent.js";
import { App } from "./App.js";
import { handleAgentEvent } from "./agent/chat.js";
import { setView } from "./canvas/canvas.js";
import { boot, bridge, currentScene } from "./scene.js";
import { store, type Tab } from "./store.js";

document.title = PRODUCT.name;
document.documentElement.classList.add("dark");
await boot();
bridge.onAgentEvent(handleAgentEvent);

// Headless checks set up a state from the address: ?view=x,y,zoom&select=id&tab=layers&chat=events.jsonl
const q = new URLSearchParams(location.search);
const initial = q.get("initial") ?? "Y";
createRoot(document.getElementById("root")!).render(<App initial={initial} />);
if (q.get("view")) {
  const [x, y, zoom] = q.get("view")!.split(",").map(Number);
  setView(x!, y!, zoom!);
}
if (q.get("select")) {
  // "@first" picks the first top-level frame (fixture ids are random).
  const want = q.get("select")!;
  store.set({ selection: want === "@first" ? (currentScene()?.tree.children[0]?.id ?? null) : want });
}
if (q.get("tab")) store.set({ tab: q.get("tab") as Tab });
if (q.get("chat")) {
  const lines = (await (await fetch(q.get("chat")!)).text()).split("\n").filter(Boolean);
  for (const line of lines) {
    const e = JSON.parse(line) as AgentEvent;
    if (e.type === "step-end") e.detail = { script: e.detail?.script ?? "", output: e.detail?.output ?? "", pictures: [] };
    handleAgentEvent(e);
  }
  if (q.get("running") === null) store.set({ agentStatus: null });
}
requestAnimationFrame(() => requestAnimationFrame(() => document.body.setAttribute("data-ready", "1")));
