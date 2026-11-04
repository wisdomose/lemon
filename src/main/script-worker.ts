// The utility process agents' scripts run in (Electron's utilityProcess; see main/script-runs.ts): the
// QuickJS sandbox, layout, the automatic check and screenshot PNGs all happen here, so Electron's main
// process (and with it every window) keeps answering while an agent works. It keeps a copy of each
// document the main process sends, level with Yjs updates, and sends back what its scripts change.
import * as Y from "yjs";
import { AgentChange, agentClientId } from "../doc/live.js";
import { createEngine } from "../engine.js";
import { GoogleFonts } from "../text/google-fonts.js";
import { Sandbox } from "../sandbox/sandbox.js";
import { inProcess, type LiveScript } from "../agent/runs.js";
import { thumbnail } from "../render/thumbnail.js";
import type { FromWorker, OriginData, ToWorker } from "./script-protocol.js";

interface Port {
  postMessage(message: unknown): void;
  on(event: "message", fn: (e: { data: unknown }) => void): void;
}
const port = (process as unknown as { parentPort: Port }).parentPort;
const send = (m: FromWorker) => port.postMessage(m);

const fontsDir = process.argv[2];
if (!fontsDir) throw new Error("script-worker: no fonts folder given");
const [engine, sandbox] = await Promise.all([GoogleFonts.open(fontsDir).then((f) => createEngine(f)), Sandbox.create()]);
const runs = inProcess(engine, sandbox);

/** The main process's changes, applied here: not sent back. */
const FROM_MAIN = Symbol("from main");
const docs = new Map<number, Y.Doc>();
const live = new Map<number, { script: LiveScript; origin: unknown; doc: number; told: boolean }>();
const toOrigin = (o: OriginData) => (typeof o === "string" ? o : new AgentChange(o.agent, o.step));

function open(id: number, state: Uint8Array): void {
  docs.get(id)?.destroy();
  const doc = new Y.Doc();
  doc.clientID = agentClientId();
  Y.applyUpdate(doc, state, FROM_MAIN);
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === FROM_MAIN) return;
    // The step's own changes carry its run; a step taken back (its undo manager) too.
    let run: number | undefined;
    for (const [r, l] of live) if (l.doc === id && (l.origin === origin || (origin as { trackedOrigins?: Set<unknown> })?.trackedOrigins?.has(l.origin))) run = r;
    send({ type: "update", doc: id, update, ...(run !== undefined ? { run } : {}) });
    // Its first statement has landed (LiveRun counts it once the change is made).
    const l = run !== undefined ? live.get(run) : undefined;
    if (l && !l.told)
      queueMicrotask(() => {
        if (l.told || !l.script.started) return;
        l.told = true;
        send({ type: "started", run: run! });
      });
  });
  docs.set(id, doc);
}

port.on("message", ({ data }) => {
  const m = data as ToWorker;
  switch (m.type) {
    case "open":
      return open(m.doc, m.state);
    case "update": {
      const doc = docs.get(m.doc);
      if (doc) Y.applyUpdate(doc, m.update, FROM_MAIN);
      return;
    }
    case "close":
      docs.get(m.doc)?.destroy();
      docs.delete(m.doc);
      return;
    case "start": {
      const doc = docs.get(m.doc);
      if (!doc) return;
      const origin = toOrigin(m.origin);
      const script = runs.live(doc, origin, m.protect, m.globals, m.progress ? (focus) => send({ type: "progress", run: m.run, focus }) : undefined);
      live.set(m.run, { script, origin, doc: m.doc, told: false });
      return;
    }
    case "feed":
      return live.get(m.run)?.script.feed(m.text);
    case "finish": {
      const l = live.get(m.run);
      if (!l) return;
      void l.script.finish(m.script).then((result) => {
        live.delete(m.run);
        send({ type: "result", run: m.run, result });
      });
      return;
    }
    case "thumbnail": {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, m.state);
      void thumbnail(engine, doc)
        .then((png) => send({ type: "thumbnail", req: m.req, ...(png ? { png } : {}) }))
        .catch((e: unknown) => send({ type: "thumbnail", req: m.req, error: e instanceof Error ? e.message : String(e) }))
        .finally(() => doc.destroy());
      return;
    }
    case "cancel": {
      const l = live.get(m.run);
      if (!l) return send({ type: "cancelled", run: m.run });
      void l.script.cancel().then(() => {
        live.delete(m.run);
        send({ type: "cancelled", run: m.run });
      });
      return;
    }
  }
});

send({ type: "ready" });
