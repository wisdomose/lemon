// Rules for people and agents editing the same document at once (measured in test/live-editing.test.ts):
//   - Both changes are kept when they touch different properties.
//   - The person wins on the same property. Two cases:
//       a. Edits at the same moment: Yjs breaks ties by client id, so people's copies take ids from the
//          upper half of the range and an agent's working copies from the lower half.
//       b. Edits the agent hasn't seen: an agent step doesn't overwrite properties a person changed
//          since that agent last reported back (PersonEdits; the script API skips those changes and
//          tells the agent), because its script was written before those edits existed.
//   - Undo (Ctrl+Z) undoes only the person's own changes and never overwrites newer agent work; an
//     agent step can be undone as one unit.
//   - A person's delete wins over an agent adding inside the deleted frame: leftovers are removed.
import * as Y from "yjs";
import { generateKeyBetween } from "fractional-indexing";
import { ROOT_ID } from "./schema.js";
import { childIds, nodesOf } from "./store.js";

const HALF = 2 ** 31;
/** A client id for a person's copy of the document (wins ties). */
export const personClientId = () => HALF + Math.floor(Math.random() * HALF);
/** A client id for an agent's working copy (loses ties to people). */
export const agentClientId = () => 1 + Math.floor(Math.random() * (HALF - 1));

/** The origin of changes a person makes in a window (in that window's copy). */
export const PERSON_EDIT = "person-edit";

/** The origin of a person's changes when the main process applies them (one per window). */
export class PersonChange {
  constructor(readonly windowId: number) {}
}

/** The origin of one agent step's changes. */
export class AgentChange {
  constructor(
    readonly agent: string,
    readonly step: number,
  ) {}
}

/** A person's undo history: only their own changes; quick successive edits (a drag) merge into one step. */
export function personUndo(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([nodesOf(doc), doc.getMap("vars")], { trackedOrigins: new Set([PERSON_EDIT]), captureTimeout: 500 });
}

/** Agents' undo history: each agent step is one entry. */
export function agentUndo(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([nodesOf(doc), doc.getMap("vars")], { trackedOrigins: new Set([AgentChange]), captureTimeout: 0 });
}

/** Node properties, by node id. */
export type Touched = Map<string, Set<string>>;

/** Records which node properties people change, so an agent step can leave them alone (rule b). */
export class PersonEdits {
  private touched: Touched = new Map();
  private stop: () => void;
  constructor(doc: Y.Doc) {
    const nodes = nodesOf(doc);
    const onTx = (tr: Y.Transaction) => {
      if (!(tr.origin instanceof PersonChange)) return;
      for (const [type, keys] of tr.changed) {
        if (type.parent !== nodes || !(type._item?.parentSub)) continue;
        const id = type._item.parentSub;
        let set = this.touched.get(id);
        if (!set) this.touched.set(id, (set = new Set()));
        for (const k of keys) if (k) set.add(k);
      }
    };
    doc.on("afterTransaction", onTx);
    this.stop = () => doc.off("afterTransaction", onTx);
  }
  /** The properties changed since the last call, and start afresh. */
  take(): Touched {
    const t = this.touched;
    this.touched = new Map();
    return t;
  }
  /** The properties changed so far (without starting afresh). */
  peek(): Touched {
    return this.touched;
  }
  dispose(): void {
    this.stop();
  }
}

/** The origin of the document's own repairs (see repairTree). */
export const REPAIR = "repair";

/**
 * Makes the tree whole again after concurrent edits: removes nodes whose parent was deleted (an agent
 * added inside a frame a person deleted) and breaks parent loops (two concurrent moves into each other)
 * by moving one node of the loop to the page. Returns whether anything changed.
 */
export function repairTree(doc: Y.Doc): boolean {
  const nodes = nodesOf(doc);
  let changed = false;
  doc.transact(() => {
    for (;;) {
      const reachable = new Set<string>([ROOT_ID]);
      const queue = [ROOT_ID];
      while (queue.length) for (const c of childIds(doc, queue.pop()!)) if (!reachable.has(c)) (reachable.add(c), queue.push(c));
      const stray = [...nodes.keys()].filter((id) => !reachable.has(id));
      if (!stray.length) return;
      changed = true;
      // A stray node whose ancestors end at a missing parent is left over from a delete.
      const leftovers = stray.filter((id) => {
        const seen = new Set<string>();
        for (let p: string | undefined = id; p && p !== ROOT_ID; p = nodes.get(p)?.get("parent") as string | undefined) {
          if (seen.has(p)) return false; // a loop, not a leftover
          seen.add(p);
          if (!nodes.has(p)) return true;
        }
        return false;
      });
      if (leftovers.length) {
        leftovers.forEach((id) => nodes.delete(id));
        continue;
      }
      // Only loops remain: put one node of a loop on the page, after the last frame.
      const id = stray.sort()[0]!;
      const last = childIds(doc, ROOT_ID).at(-1);
      const rec = nodes.get(id)!;
      rec.set("parent", ROOT_ID);
      rec.set("order", generateKeyBetween(last ? (nodes.get(last)!.get("order") as string) : null, null));
    }
  }, REPAIR);
  return changed;
}

/** The selection after a change: kept if the node still exists, cleared if someone deleted it. */
export function reconcileSelection(doc: Y.Doc, id: string | null): string | null {
  return id && nodesOf(doc).has(id) ? id : null;
}
