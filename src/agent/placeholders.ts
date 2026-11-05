// Placeholders an outside agent leaves on. An agent marks a frame it is building with
// `placeholder: true` (the canvas shows it "Generating", with a moving sheen) and is told to turn it
// off when the frame is done; one that stops early or forgets leaves it on, and the canvas keeps
// drawing the sheen for good. So each agent's placeholders are remembered, and turned off when it
// leaves or goes quiet (main/mcp.ts).
import type * as Y from "yjs";
import { nodesOf } from "../doc/store.js";

/** The nodes marked as placeholders now. */
export function placeholderIds(doc: Y.Doc): Set<string> {
  const ids = new Set<string>();
  for (const [id, n] of nodesOf(doc)) if (n.get("placeholder") === true) ids.add(id);
  return ids;
}

/** The placeholders one agent turned on in one document, and still on. */
export class AgentPlaceholders {
  private mine = new Set<string>();

  /** After one of the agent's calls: what it turned on in it (`before`: those on before the call). */
  track(doc: Y.Doc, before: Set<string>): void {
    const now = placeholderIds(doc);
    for (const id of now) if (!before.has(id)) this.mine.add(id);
    for (const id of this.mine) if (!now.has(id)) this.mine.delete(id);
  }

  /** How many are on. */
  get size(): number {
    return this.mine.size;
  }

  /** Turns off those still on (one change, with `origin`); returns their ids. */
  clear(doc: Y.Doc, origin: unknown): string[] {
    const nodes = nodesOf(doc);
    const ids = [...this.mine].filter((id) => nodes.get(id)?.get("placeholder") === true);
    this.mine.clear();
    if (ids.length) doc.transact(() => ids.forEach((id) => nodes.get(id)!.delete("placeholder")), origin);
    return ids;
  }
}
