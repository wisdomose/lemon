// The document as a tree, rebuilt only where it changed (as Pen marks what is dirty and keeps the rest).
// Each Yjs transaction says which records it changed (`changedRecords`); the next tree rebuilds those
// records, everything above them (where they are now and where they were), and every instance of a
// component that changed, and gives back the earlier node objects for the rest. So an unchanged
// subtree is the same object as before, and layout and drawing can tell, by identity alone, that
// nothing in it changed.
import type * as Y from "yjs";
import { ROOT_ID, type TreeNode } from "./schema.js";
import { nodesOf, toTree } from "./store.js";

/**
 * The records a transaction changed (added, removed or edited), or "all" when something every node may
 * read changed (variables, themes, pictures). Comments change nothing drawn.
 */
export function changedRecords(doc: Y.Doc, tr: Y.Transaction): Set<string> | "all" {
  const nodes = nodesOf(doc) as unknown;
  const comments = doc.getMap("comments") as unknown;
  const out = new Set<string>();
  for (const [type, keys] of tr.changed) {
    if ((type as unknown) === nodes) {
      for (const k of keys) if (k !== null) out.add(k);
      continue;
    }
    // A record, or something inside one (a list in a property).
    let t: Y.AbstractType<unknown> | null = type as Y.AbstractType<unknown>;
    while (t && (t.parent as unknown) !== nodes && t.parent) t = t.parent as Y.AbstractType<unknown>;
    if (t && (t.parent as unknown) === nodes) {
      const id = t._item?.parentSub;
      if (id) out.add(id);
      continue;
    }
    if (t === comments || (type as unknown) === comments) continue;
    return "all";
  }
  return out;
}

export class IncrementalTree {
  private prev = new Map<string, TreeNode>();
  /** Each record's parent when the last tree was built. */
  private parents = new Map<string, string>();
  private dirty: Set<string> | "all" = "all";
  /** The last tree. */
  tree: TreeNode | undefined;

  constructor(
    private readonly doc: Y.Doc,
    /** Gives a script node its children (the editor's script outputs). */
    private readonly graft?: (node: TreeNode) => void,
  ) {}

  /** Records `ids` (or everything) as changed since the last tree. */
  mark(ids: Iterable<string> | "all"): void {
    if (this.dirty === "all") return;
    if (ids === "all") {
      this.dirty = "all";
      return;
    }
    for (const id of ids) this.dirty.add(id);
  }

  /** Whether anything changed since the last tree. */
  get stale(): boolean {
    return this.dirty === "all" || this.dirty.size > 0 || !this.tree;
  }

  /** The tree now: the last one if nothing changed, else rebuilt where it changed. */
  build(): TreeNode {
    if (this.tree && !this.stale) return this.tree;
    const nodes = nodesOf(this.doc);
    const parents = new Map<string, string>();
    const refsTo = new Map<string, string[]>();
    for (const [id, rec] of nodes) {
      const p = rec.get("parent");
      if (typeof p === "string") parents.set(id, p);
      if (rec.get("type") === "ref") {
        const of = rec.get("ref") as string;
        let list = refsTo.get(of);
        if (!list) refsTo.set(of, (list = []));
        list.push(id);
      }
    }
    const all = this.dirty === "all" || !this.tree;
    const rebuild = new Set<string>([ROOT_ID]);
    if (!all) {
      const queue = [...(this.dirty as Set<string>)];
      const up = (id: string, from: Map<string, string>) => {
        for (let p: string | undefined = id, n = 0; p && n < 10_000; p = from.get(p), n++) {
          if (rebuild.has(p) && p !== id) return;
          if (!rebuild.has(p)) {
            rebuild.add(p);
            queue.push(p);
          }
        }
      };
      while (queue.length) {
        const id = queue.pop()!;
        rebuild.add(id);
        // Above it where it is now and where it was (a move changes both parents).
        up(id, parents);
        const before = this.parents.get(id);
        if (before) up(before, this.parents);
        // Every instance of a component that changed reads it again.
        for (const ref of refsTo.get(id) ?? []) if (!rebuild.has(ref)) (rebuild.add(ref), queue.push(ref));
      }
    }
    const made = new Map<string, TreeNode>();
    const tree = toTree(this.doc, ROOT_ID, { prev: all ? new Map() : this.prev, rebuild, made, ...(this.graft ? { graft: this.graft } : {}) });
    this.prev = made;
    this.parents = parents;
    this.dirty = new Set();
    this.tree = tree;
    return tree;
  }
}
