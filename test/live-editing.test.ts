// People and agents editing the same document at once: the rules in src/doc/live.ts, exercised with the
// real agent tool against a main-process document and a window copy synced as the app syncs them.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ROOT_ID } from "../src/doc/schema.js";
import * as store from "../src/doc/store.js";
import { AgentChange, PERSON_EDIT, PersonChange, PersonEdits, REPAIR, agentClientId, agentUndo, personClientId, personUndo, reconcileSelection, repairTree } from "../src/doc/live.js";
import { LiveRun, execute } from "../src/agent/execute.js";
import { setup } from "./helpers.js";

/**
 * A main-process document and a window copy. Window → main messages can be held back to simulate a
 * person's edit that is still on its way while the agent's step lands.
 */
function app() {
  const main = new Y.Doc();
  main.clientID = agentClientId();
  const win = new Y.Doc();
  win.clientID = personClientId();
  const frame = store.insert(main, ROOT_ID, { type: "frame", name: "Card", width: 300, height: 200, fill: "#ffffff" });
  store.insert(main, frame, { type: "text", text: "Title", name: "Title" });
  Y.applyUpdate(win, Y.encodeStateAsUpdate(main));
  const undo = personUndo(win);
  const agentHistory = agentUndo(main);
  const personEdits = new PersonEdits(main);
  const fromWindow = new PersonChange(1);
  let held: Uint8Array[] | null = null;
  main.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== fromWindow) Y.applyUpdate(win, u, "from-main");
    if (origin !== REPAIR) repairTree(main);
  });
  win.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== PERSON_EDIT && origin !== undo) return;
    if (held) held.push(u);
    else Y.applyUpdate(main, u, fromWindow);
  });
  const person = (fn: () => void) => win.transact(fn, PERSON_EDIT);
  let step = 0;
  /** A step whose script is fed in as the model writes it. */
  const writing = async () => {
    const { engine, sandbox } = await setup();
    const origin = new AgentChange("Pip", ++step);
    return new LiveRun(main, engine, sandbox, origin, personEdits.peek());
  };
  const agent = async (script: string) => {
    const { engine, sandbox } = await setup();
    const r = await execute(main, engine, sandbox, script, new AgentChange("Pip", ++step), personEdits.peek());
    personEdits.take();
    expect(r.error).toBeUndefined();
    return r;
  };
  return {
    main,
    win,
    frame,
    undo,
    agentHistory,
    person,
    agent,
    writing,
    /** Holds the person's next changes back until `release()`: the agent's step lands first. */
    hold: () => void (held = []),
    release: () => {
      const queue = held ?? [];
      held = null;
      queue.forEach((u) => Y.applyUpdate(main, u, fromWindow));
    },
    get: (d: Y.Doc, id: string) => store.propsOf(d, id),
  };
}

describe("people and agents editing at once", () => {
  it("keeps both changes when they touch different properties", async () => {
    const t = app();
    t.hold();
    t.person(() => store.update(t.win, t.frame, { x: 40, y: 60 }));
    await t.agent(`doc.update(${JSON.stringify(t.frame)}, { fill: "#ffeedd", radius: 12 });`);
    t.release();
    for (const d of [t.main, t.win]) expect(t.get(d, t.frame)).toMatchObject({ x: 40, y: 60, fill: "#ffeedd", radius: 12 });
  });

  it("the person wins a clash on the same property, whichever arrives first", async () => {
    // Arriving first means while the agent was thinking: its script couldn't know about the edit.
    for (const personFirst of [false, true]) {
      const t = app();
      t.hold();
      t.person(() => store.update(t.win, t.frame, { fill: "#ff0000" }));
      if (personFirst) t.release();
      const r = await t.agent(`doc.update(${JSON.stringify(t.frame)}, { fill: "#0000ff" });`);
      if (!personFirst) t.release();
      if (personFirst) expect(r.leftAlone).toEqual([`${t.frame}: fill`]); // and the agent is told
      expect(t.get(t.main, t.frame).fill).toBe("#ff0000");
      expect(t.get(t.win, t.frame).fill).toBe("#ff0000");
    }
  });

  it("undo undoes only the person's own changes, and redo puts them back", async () => {
    const t = app();
    t.person(() => store.update(t.win, t.frame, { fill: "#ff0000" }));
    await t.agent(`doc.update(${JSON.stringify(t.frame)}, { radius: 16 });`);
    t.undo.undo();
    expect(t.get(t.main, t.frame)).toMatchObject({ fill: "#ffffff", radius: 16 });
    t.undo.redo();
    expect(t.get(t.main, t.frame)).toMatchObject({ fill: "#ff0000", radius: 16 });
  });

  it("undo never overwrites newer agent work on the same property", async () => {
    const t = app();
    t.person(() => store.update(t.win, t.frame, { width: 320 }));
    await t.agent(`doc.update(${JSON.stringify(t.frame)}, { radius: 4 });`); // reports back: it has seen 320
    await t.agent(`doc.update(${JSON.stringify(t.frame)}, { width: 480 });`);
    t.undo.undo();
    expect(t.get(t.main, t.frame).width).toBe(480);
  });

  it("a drag (many quick moves) is one undo step", () => {
    const t = app();
    for (let i = 1; i <= 30; i++) t.person(() => store.update(t.win, t.frame, { x: i * 3 }));
    t.undo.undo();
    expect(t.get(t.main, t.frame).x).toBeUndefined();
  });

  it("an agent step undoes as one unit and leaves the person's changes alone", async () => {
    const t = app();
    await t.agent(`
      doc.update(${JSON.stringify(t.frame)}, { fill: "#112233", padding: 24 });
      doc.insert(${JSON.stringify(t.frame)}, { type: "text", text: "Added by the agent" });
    `);
    t.person(() => store.update(t.win, t.frame, { x: 99 }));
    t.agentHistory.undo();
    const card = store.toTree(t.main, t.frame);
    expect(card.props).toMatchObject({ fill: "#ffffff", x: 99 });
    expect(card.props.padding).toBeUndefined();
    expect(card.children.map((c) => c.props.text)).toEqual(["Title"]);
    expect(store.toTree(t.win, t.frame).children).toHaveLength(1);
  });

  it("a person's delete wins over the agent adding inside the deleted frame", async () => {
    const t = app();
    t.hold();
    t.person(() => store.remove(t.win, t.frame));
    await t.agent(`doc.insert(${JSON.stringify(t.frame)}, { type: "rect", width: 50, height: 50 });`);
    t.release();
    for (const d of [t.main, t.win]) {
      expect(store.toTree(d).children).toHaveLength(0);
      expect(store.nodesOf(d).size).toBe(0); // no leftovers
    }
  });

  it("two moves into each other don't make nodes vanish", () => {
    const main = new Y.Doc();
    const a = store.insert(main, ROOT_ID, { type: "frame", name: "A" });
    const b = store.insert(main, ROOT_ID, { type: "frame", name: "B" });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(main));
    store.move(main, a, b); // one side puts A in B
    store.move(other, b, a); // the other puts B in A, at the same time
    Y.applyUpdate(main, Y.encodeStateAsUpdate(other));
    expect(repairTree(main)).toBe(true);
    const names = (n: ReturnType<typeof store.toTree>): string[] => [n.props.name ?? "", ...n.children.flatMap(names)];
    expect(names(store.toTree(main)).filter(Boolean).sort()).toEqual(["A", "B"]);
  });

  it("the selection is kept while the node exists and cleared when the agent deletes it", async () => {
    const t = app();
    const title = store.childIds(t.win, t.frame)[0]!;
    await t.agent(`doc.update(${JSON.stringify(title)}, { text: "New title" });`);
    expect(reconcileSelection(t.win, title)).toBe(title);
    await t.agent(`doc.remove(${JSON.stringify(title)});`);
    expect(reconcileSelection(t.win, title)).toBeNull();
  });
});

describe("after the agent has reported back", () => {
  it("a later step may change a property the person set earlier, on purpose", async () => {
    const t = app();
    t.person(() => store.update(t.win, t.frame, { fill: "#ff0000" }));
    await t.agent(`doc.update(${JSON.stringify(t.frame)}, { radius: 4 });`); // reports back
    await t.agent(`doc.update(${JSON.stringify(t.frame)}, { fill: "#00ff00" });`);
    expect(t.get(t.main, t.frame).fill).toBe("#00ff00");
  });
});

describe("a step that lands while it is written", () => {
  /** Lets the run's queued statements land. */
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("shows each statement as soon as it is complete, and undoes as one unit", async () => {
    const t = app();
    const f = JSON.stringify(t.frame);
    const script = `doc.update(${f}, { fill: "#112233" });\ndoc.insert(${f}, { type: "text", text: "One" });\ndoc.insert(${f}, { type: "text", text: "Two" });`;
    const run = await t.writing();
    const before = t.agentHistory.undoStack.length;
    run.feed(script.slice(0, script.indexOf("doc.insert")));
    await settle();
    expect(t.get(t.win, t.frame).fill).toBe("#112233");
    expect(store.childIds(t.win, t.frame)).toHaveLength(1);
    run.feed(script.slice(0, script.lastIndexOf("doc.insert") + 10));
    await settle();
    expect(store.childIds(t.win, t.frame)).toHaveLength(2);
    const r = await run.finish(script);
    expect(r.ok).toBe(true);
    expect(store.childIds(t.win, t.frame)).toHaveLength(3);
    expect(t.agentHistory.undoStack.length).toBe(before + 1);
    t.agentHistory.undo();
    expect(store.childIds(t.main, t.frame)).toHaveLength(1);
    expect(t.get(t.main, t.frame).fill).toBe("#ffffff");
  });

  it("if it fails, all of it is removed, leaving the person's edit made meanwhile and no undo entry", async () => {
    const t = app();
    const f = JSON.stringify(t.frame);
    const run = await t.writing();
    const before = t.agentHistory.undoStack.length;
    run.feed(`doc.update(${f}, { radius: 12 });\ndoc.insert(${f}, { type: "text", text: "One" });\n`);
    await settle();
    expect(store.childIds(t.win, t.frame)).toHaveLength(2);
    t.person(() => store.update(t.win, t.frame, { x: 99 }));
    const r = await run.finish(`doc.update(${f}, { radius: 12 });\ndoc.insert(${f}, { type: "text", text: "One" });\ndoc.update("nope", {});`);
    expect(r.ok).toBe(false);
    expect(r.error?.line).toBe(3);
    for (const d of [t.main, t.win]) {
      expect(store.childIds(d, t.frame)).toHaveLength(1);
      expect(t.get(d, t.frame)).toMatchObject({ x: 99 });
      expect(t.get(d, t.frame).radius).toBeUndefined();
    }
    expect(t.agentHistory.undoStack.length).toBe(before);
  });
});
