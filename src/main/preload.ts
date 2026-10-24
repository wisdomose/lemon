// The bridge between a window and the main process. Windows get exactly these functions, nothing more.
import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../renderer/bridge.js";

const bridge: Bridge = {
  docState: () => ipcRenderer.invoke("doc:state"),
  onDocUpdate: (fn) => {
    ipcRenderer.on("doc:update", (_e, update: Uint8Array) => fn(update));
  },
  fontCatalogue: () => ipcRenderer.invoke("fonts:catalogue"),
  loadFont: (face) => ipcRenderer.invoke("fonts:load", face),
  runAgent: (prompt) => ipcRenderer.invoke("agent:run", prompt),
  stopAgent: () => ipcRenderer.invoke("agent:stop"),
  onAgentEvent: (fn) => {
    ipcRenderer.on("agent:event", (_e, event) => fn(event));
  },
  canRunAgent: true,
};

contextBridge.exposeInMainWorld("lemon", bridge);
