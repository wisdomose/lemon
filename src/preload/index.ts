// The bridge between a window and the main process. Windows get exactly these functions, nothing more.
import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../renderer/bridge.js";

const bridge: Bridge = {
  docState: () => ipcRenderer.invoke("doc:state"),
  onDocUpdate: (fn) => {
    ipcRenderer.on("doc:update", (_e, update: Uint8Array) => fn(update));
  },
  pushDocUpdate: (update) => ipcRenderer.send("doc:push", update),
  fontCatalogue: () => ipcRenderer.invoke("fonts:catalogue"),
  loadFont: (face) => ipcRenderer.invoke("fonts:load", face),
  runAgent: (prompt, model, team, effort) => ipcRenderer.invoke("agent:run", prompt, model, team, effort),
  stopAgent: () => ipcRenderer.invoke("agent:stop"),
  onAgentEvent: (fn) => {
    ipcRenderer.on("agent:event", (_e, event) => fn(event));
  },
  canRunAgent: true,
  claudeStatus: () => ipcRenderer.invoke("claude:status"),
  codexModels: (fresh) => ipcRenderer.invoke("codex:models", fresh),
  codexSignIn: () => ipcRenderer.invoke("codex:sign-in"),
  codexStatus: () => ipcRenderer.invoke("codex:status"),
  fileInfo: () => ipcRenderer.invoke("file:info"),
  onFileInfo: (fn) => {
    ipcRenderer.on("file:info", (_e, info) => fn(info));
  },
  onMenuCommand: (fn) => {
    ipcRenderer.on("menu:command", (_e, command) => fn(command));
  },
  startPrompt: () => ipcRenderer.invoke("agent:start-prompt"),
  notice: () => ipcRenderer.invoke("editor:notice"),
  showDashboard: () => ipcRenderer.invoke("dashboard:show"),
  browser: {
    onFrame: (fn) => {
      ipcRenderer.on("browser:frame", (_e, id, frame) => fn(id, frame));
    },
    onCursor: (fn) => {
      ipcRenderer.on("browser:cursor", (_e, id, cursor) => fn(id, cursor));
    },
    onClosed: (fn) => {
      ipcRenderer.on("browser:closed", (_e, id) => fn(id));
    },
    input: (id, ev) => ipcRenderer.send("browser:input", id, ev),
    command: (id, what) => ipcRenderer.invoke("browser:command", id, what),
    repaint: () => ipcRenderer.send("browser:repaint"),
  },
  tabs: {
    get: () => ipcRenderer.invoke("tabs:get"),
    onChange: (fn) => {
      ipcRenderer.on("tabs:state", (_e, tabs) => fn(tabs));
    },
    show: (id) => ipcRenderer.invoke("tabs:show", id),
    close: (id) => ipcRenderer.invoke("tabs:close", id),
    newFile: () => ipcRenderer.invoke("tabs:new"),
  },
  dashboard: {
    files: () => ipcRenderer.invoke("dashboard:files"),
    onFiles: (fn) => {
      ipcRenderer.on("dashboard:files", (_e, files) => fn(files));
    },
    open: (path) => ipcRenderer.invoke("dashboard:open", path),
    newFile: (start) => ipcRenderer.invoke("dashboard:new", start),
    openDialog: () => ipcRenderer.invoke("dashboard:open-dialog"),
    reveal: (path) => ipcRenderer.invoke("dashboard:reveal", path),
    forget: (path) => ipcRenderer.invoke("dashboard:forget", path),
    deleteDraft: (path) => ipcRenderer.invoke("dashboard:delete", path),
  },
};

contextBridge.exposeInMainWorld("lemon", bridge);
