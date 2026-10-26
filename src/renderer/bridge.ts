// What a window can ask of the host. In the desktop app the preload script provides it over IPC; in a
// plain browser (development and headless checks) a stand-in reads a saved document and fonts over HTTP
// and has no agent.
import type { AgentEvent, AgentStats } from "../agent/agent.js";
import type { FontFace } from "../text/fonts.js";
import type { FileInfo, StartPrompt } from "../main/editor.js";
import type { FileCard } from "../main/files.js";
import type { WindowCommand } from "../main/menu.js";
import { PRODUCT } from "../product.js";

export interface Bridge {
  docState(): Promise<Uint8Array>;
  onDocUpdate(fn: (update: Uint8Array) => void): void;
  /** Sends a change made in this window to the host's document. */
  pushDocUpdate(update: Uint8Array): void;
  fontCatalogue(): Promise<Record<string, string[]>>;
  loadFont(face: FontFace): Promise<ArrayBuffer>;
  runAgent(prompt: string, model: string): Promise<AgentStats>;
  stopAgent(): Promise<void>;
  onAgentEvent(fn: (e: AgentEvent) => void): void;
  canRunAgent: boolean;
  /** Whether Claude Code is signed in on this computer, and as whom. */
  claudeStatus(): Promise<{ loggedIn: boolean; email?: string; plan?: string }>;
  /** The file this window shows: its name and whether it is saved. */
  fileInfo(): Promise<FileInfo>;
  onFileInfo(fn: (info: FileInfo) => void): void;
  /** Menu bar commands for this window. */
  onMenuCommand(fn: (command: WindowCommand) => void): void;
  /** A prompt this new window was opened with (from the Dashboard), once. */
  startPrompt(): Promise<StartPrompt | undefined>;
  showDashboard(): Promise<void>;
  /** The Dashboard's lists and actions. */
  dashboard: {
    files(): Promise<DashboardFiles>;
    onFiles(fn: (files: DashboardFiles) => void): void;
    open(path: string): Promise<void>;
    /** A new file, with the agent starting on `start` if given. */
    newFile(start?: StartPrompt): Promise<void>;
    openDialog(): Promise<void>;
    reveal(path: string): Promise<void>;
    forget(path: string): Promise<void>;
    deleteDraft(path: string): Promise<void>;
  };
}

export interface DashboardFiles {
  recents: FileCard[];
  drafts: FileCard[];
}

declare global {
  interface Window {
    lemon?: Bridge;
  }
}

/** Browser stand-in: `?doc=<url of a .yjs file>`; fonts from the dev server's /fonts routes. */
export function browserBridge(): Bridge {
  const docUrl = new URLSearchParams(location.search).get("doc");
  return {
    async docState() {
      if (!docUrl) return new Uint8Array();
      const res = await fetch(docUrl);
      return new Uint8Array(await res.arrayBuffer());
    },
    onDocUpdate() {},
    pushDocUpdate() {},
    async fontCatalogue() {
      return (await fetch("/fonts/catalogue.json")).json();
    },
    async loadFont(face) {
      const q = new URLSearchParams({ family: face.family, weight: String(face.weight), italic: face.italic ? "1" : "0" });
      const res = await fetch(`/fonts/file?${q}`);
      if (!res.ok) throw new Error(`font ${face.family}: HTTP ${res.status}`);
      return res.arrayBuffer();
    },
    runAgent() {
      return Promise.reject(new Error("The agent runs only in the desktop app."));
    },
    async stopAgent() {},
    onAgentEvent() {},
    canRunAgent: false,
    async claudeStatus() {
      return { loggedIn: false };
    },
    async fileInfo() {
      return { name: docUrl ? docUrl.split("/").pop()! : `untitled.${PRODUCT.fileExtension}`, state: "saved", draft: !docUrl };
    },
    onFileInfo() {},
    onMenuCommand() {},
    async startPrompt() {
      return undefined;
    },
    async showDashboard() {},
    // `?files=<url of a JSON file>` gives the Dashboard its lists.
    dashboard: {
      async files() {
        const url = new URLSearchParams(location.search).get("files");
        return url ? (await fetch(url)).json() : { recents: [], drafts: [] };
      },
      onFiles() {},
      async open() {},
      async newFile() {},
      async openDialog() {},
      async reveal() {},
      async forget() {},
      async deleteDraft() {},
    },
  };
}
