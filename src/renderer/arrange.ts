// Copy, cut, paste, duplicate, group, frame selection and ungroup, as Pen does them (observed in Pen):
//   - Group (Ctrl+G) puts the selection in a nameless group at the topmost member's place; the group
//     sits at the members' top-left (in a row or column, it takes their place in the flow) and they keep
//     where they are on the canvas. Frame selection (Ctrl+Alt+G) does the same with a "Frame N" frame
//     the size of the selection, without layout or fill.
//   - Ungroup (Ctrl+Backspace or Ctrl+Shift+G) puts a group's or frame's children in its place, where
//     they were on the canvas, and drops it.
//   - Duplicate (Ctrl+D) puts a copy right after each node, in the same spot; a frame on the page goes
//     beside it instead, in the first free space to the right (40 apart).
//   - Copy writes Pen's clipboard: an HTML span carrying the nodes as base64 JSON, with "Node ID(s): …"
//     as its text, so copies go between Pen and Lemon either way.
//   - Paste goes into the selected frame or group, centred in it (last in a row or column), or beside
//     the selected node (into its parent). With the copied node itself selected, or nothing selected,
//     the copy keeps its spot, unless that spot is out of view or the copy came from another document:
//     then it lands in the middle of the view.
//   - Paste here (the canvas menu) puts the copy's top-left at the pointer, in the frame there.
//   - Paste to replace (Ctrl+Shift+R) puts the copy in each selected node's place: its slot among its
//     siblings and its top-left; the copy keeps its own size.
// Functions of the document and the laid-out tree, so they can be tested without a window.
import type * as Y from "yjs";
import * as docStore from "../doc/store.js";
import { nodeAsPen } from "../doc/file.js";
import { ROOT_ID, type PenNode, type TreeNode } from "../doc/schema.js";
import type { Box } from "../layout/layout.js";
import { index, parents, type Laid } from "./canvas/pick.js";
import { flows, frameAt, originIn } from "./canvas/place.js";

/** The attribute of Pen's clipboard span. */
export const CLIP_ATTR = "data-pen-node-clipboard";
/** The space Pen leaves between a duplicated frame and what is beside it. */
const BESIDE_GAP = 40;

export interface Clip {
  /** Which document (window) the copy came from. */
  source: string;
  /** The copied nodes' ids there. */
  ids: string[];
  nodes: PenNode[];
}

/** Nodes the person can move about: their own records (not parts of an instance or a script's output). */
function movable(doc: Y.Doc, id: string): boolean {
  const rec = docStore.nodesOf(doc).get(id);
  return id !== ROOT_ID && !!rec && !rec.has("replaces");
}

/** The selection's movable nodes in the document's order (bottom to top), parents before children dropped. */
function inOrder(doc: Y.Doc, s: Laid, ids: string[]): string[] {
  const wanted = new Set(ids.filter((id) => movable(doc, id)));
  const up = parents(s.tree);
  // A node inside another selected node goes along with it.
  for (const id of [...wanted]) for (let p = up.get(id); p; p = up.get(p.id)) if (wanted.has(p.id)) wanted.delete(id);
  const out: string[] = [];
  const walk = (n: TreeNode) => n.children.forEach((c) => (wanted.has(c.id) && out.push(c.id), walk(c)));
  walk(s.tree);
  return out;
}

const union = (list: Box[]): Box | undefined => {
  if (!list.length) return undefined;
  const l = Math.min(...list.map((b) => b.x));
  const t = Math.min(...list.map((b) => b.y));
  return { x: l, y: t, w: Math.max(...list.map((b) => b.x + b.w)) - l, h: Math.max(...list.map((b) => b.y + b.h)) - t };
};


/** Whether children of `parent` are placed by x and y (not in a row or column). */
const free = (parent: TreeNode | undefined) => !parent || !flows(parent);

/** Sets or clears a node's x and y for where it now sits. */
function place(doc: Y.Doc, id: string, at: { x: number; y: number } | null): void {
  docStore.update(doc, id, (at ? { x: at.x, y: at.y } : { x: null, y: null }) as never);
}

/** A name "<base> N" one past the highest such name in the document. */
function numbered(doc: Y.Doc, base: string): string {
  let n = 0;
  const pattern = new RegExp(`^${base} (\\d+)$`);
  for (const rec of docStore.nodesOf(doc).values()) {
    const m = pattern.exec(String(rec.get("name") ?? ""));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${base} ${n + 1}`;
}

/** Group (or Frame selection): returns the new group or frame, or null when nothing could go in one. */
export function groupNodes(doc: Y.Doc, s: Laid, ids: string[], kind: "group" | "frame"): string | null {
  const members = inOrder(doc, s, ids).filter((id) => s.boxes.has(id));
  if (!members.length) return null;
  const byId = index(s.tree);
  const up = parents(s.tree);
  const parent = up.get(members[0]!)!;
  const siblings = parent.children.map((c) => c.id);
  const at = Math.max(...members.map((id) => siblings.indexOf(id)));
  const box = union(members.map((id) => s.boxes.get(id)!))!;
  const origin = originIn(s, parent);
  const spec: PenNode =
    kind === "group"
      ? { type: "group" }
      : { type: "frame", name: numbered(doc, "Frame"), width: box.w, height: box.h, layout: "none" };
  if (free(parent)) Object.assign(spec, { x: box.x - origin.x, y: box.y - origin.y });
  // Right after the topmost member: once the members leave, it takes that member's place.
  const container = docStore.insert(doc, parent.id, spec, at + 1);
  for (const id of members) {
    const b = s.boxes.get(id)!;
    docStore.move(doc, id, container);
    if (byId.get(id)?.props.layoutPosition === "absolute") docStore.update(doc, id, { layoutPosition: null } as never);
    place(doc, id, { x: b.x - box.x, y: b.y - box.y });
  }
  return container;
}

/** Ungroup: each selected group or frame gives way to its children. Returns the children. */
export function ungroupNodes(doc: Y.Doc, s: Laid, ids: string[]): string[] {
  const up = parents(s.tree);
  const byId = index(s.tree);
  const out: string[] = [];
  for (const id of inOrder(doc, s, ids)) {
    const node = byId.get(id);
    if (!node || (node.type !== "group" && node.type !== "frame") || docStore.isInstance(doc, id)) continue;
    const parent = up.get(id)!;
    const origin = originIn(s, parent);
    let at = docStore.childIds(doc, parent.id).indexOf(id);
    for (const kid of docStore.childIds(doc, id)) {
      const b = s.boxes.get(kid);
      docStore.move(doc, kid, parent.id, at++);
      place(doc, kid, free(parent) && b ? { x: b.x - origin.x, y: b.y - origin.y } : null);
      out.push(kid);
    }
    docStore.remove(doc, id);
  }
  return out;
}

/** The first free spot right of `box` among the page's frames and nodes, `BESIDE_GAP` from each. */
function besideFree(box: Box, taken: Box[]): { x: number; y: number } {
  let x = box.x + box.w + BESIDE_GAP;
  for (let moved = true; moved; ) {
    moved = false;
    for (const t of taken) {
      if (x < t.x + t.w && x + box.w > t.x && box.y < t.y + t.h && box.y + box.h > t.y) {
        x = t.x + t.w + BESIDE_GAP;
        moved = true;
      }
    }
  }
  return { x, y: box.y };
}

/** A copy of a node right after it, in the same spot (Alt-drag's copy); `at` moves it. Returns the copy. */
export function copyInPlace(doc: Y.Doc, id: string, at?: { x: number; y: number }): string {
  const parent = docStore.parentOf(doc, id)!;
  const spec = { ...nodeAsPen(doc, id), ...at };
  return docStore.insert(doc, parent, spec, docStore.childIds(doc, parent).indexOf(id) + 1);
}

/** Duplicate: a copy right after each node. Returns the copies. */
export function duplicateNodes(doc: Y.Doc, s: Laid, ids: string[]): string[] {
  const taken = s.tree.children.map((c) => s.boxes.get(c.id)).filter((b): b is Box => !!b);
  const out: string[] = [];
  for (const id of inOrder(doc, s, ids)) {
    const box = s.boxes.get(id);
    let spot: { x: number; y: number } | undefined;
    if (docStore.parentOf(doc, id) === ROOT_ID && docStore.typeOf(doc, id) === "frame" && box) {
      spot = besideFree(box, taken);
      taken.push({ ...box, ...spot });
    }
    out.push(copyInPlace(doc, id, spot));
  }
  return out;
}

// ---- The clipboard --------------------------------------------------------------------------------------
const toBase64 = (text: string) => {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
};
const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

/** The selection as Pen puts it on the clipboard (in the order it was selected). */
export function copyNodes(doc: Y.Doc, ids: string[], source: string): { html: string; text: string; ids: string[] } | null {
  const list = ids.filter((id) => movable(doc, id));
  if (!list.length) return null;
  const payload = { source, localData: list, remoteData: { nodes: list.map((id) => nodeAsPen(doc, id)) } };
  const text = list.length === 1 ? `Node ID: ${list[0]}` : `Node IDs: ${list.join(", ")}`;
  return { html: `<span ${CLIP_ATTR}="${toBase64(JSON.stringify(payload))}">${text}</span>`, text, ids: list };
}

/** Nodes copied in Pen or Lemon, from the clipboard's HTML; null when it holds none. */
export function readClip(html: string): Clip | null {
  const m = new RegExp(`${CLIP_ATTR}="([^"]+)"`).exec(html);
  if (!m) return null;
  try {
    const data = JSON.parse(fromBase64(m[1]!)) as { source?: string; localData?: string[]; remoteData?: { nodes?: PenNode[] } };
    const nodes = data.remoteData?.nodes;
    if (!Array.isArray(nodes) || !nodes.length) return null;
    return { source: String(data.source ?? ""), ids: data.localData ?? [], nodes };
  } catch {
    return null;
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/**
 * Paste: puts the copied nodes in the document (new ids) and returns them. `view` is the part of the
 * page in view; `here` says the copy came from this document, so its nodes' places on the page are known.
 */
export function pasteNodes(doc: Y.Doc, s: Laid, clip: Clip, selection: string[], view: Box, here: boolean): string[] {
  const byId = index(s.tree);
  const up = parents(s.tree);
  const { was, all } = measure(s, clip, here);
  const chosen = selection.filter((id) => byId.has(id) && movable(doc, id));
  const first = chosen[0];
  let parent: TreeNode = s.tree;
  if (first && !(here && clip.ids.includes(first))) {
    const n = byId.get(first)!;
    parent = (n.type === "frame" || n.type === "group") && !docStore.isInstance(doc, first) ? n : up.get(first)!;
  } else if (first) parent = up.get(first)!;
  // Into a frame (not beside the copied node itself): centred in it.
  let shift = { x: 0, y: 0 };
  const into = parent.id !== ROOT_ID && !(here && first && clip.ids.includes(first));
  if (into) {
    const pb = s.boxes.get(parent.id)!;
    shift = { x: pb.x + (pb.w - all.w) / 2 - all.x, y: pb.y + (pb.h - all.h) / 2 - all.y };
  } else if (!here || !(all.x >= view.x && all.y >= view.y && all.x + all.w <= view.x + view.w && all.y + all.h <= view.y + view.h)) {
    shift = { x: view.x + (view.w - all.w) / 2 - all.x, y: view.y + (view.h - all.h) / 2 - all.y };
  }
  const origin = originIn(s, parent);
  const out: string[] = [];
  clip.nodes.forEach((n, i) => {
    const b = was[i]!;
    const spec: PenNode = { ...n };
    if (free(parent)) Object.assign(spec, { x: b.x + shift.x - origin.x, y: b.y + shift.y - origin.y });
    else {
      delete spec.x;
      delete spec.y;
    }
    try {
      out.push(docStore.insert(doc, parent.id, spec));
    } catch {
      // A node this document can't take (say, an instance of a component it doesn't have) is left out.
    }
  });
  return out;
}

/** Where each copied node was (on this page if it is here, else as the file had it), and all of them together. */
function measure(s: Laid, clip: Clip, here: boolean): { was: Box[]; all: Box } {
  const was = clip.nodes.map((n): Box => {
    const b = here && n.id ? s.boxes.get(n.id) : undefined;
    return b ?? { x: num(n.x), y: num(n.y), w: num(n.width), h: num(n.height) };
  });
  return { was, all: union(was)! };
}

/** Puts the copied nodes under `parent` with their top-left corner together at `corner` (page), from `index` on. */
function putAt(doc: Y.Doc, s: Laid, clip: Clip, here: boolean, parent: TreeNode, corner: { x: number; y: number }, index?: number): string[] {
  const { was, all } = measure(s, clip, here);
  const origin = originIn(s, parent);
  const out: string[] = [];
  clip.nodes.forEach((n, i) => {
    const spec: PenNode = { ...n };
    if (free(parent)) Object.assign(spec, { x: corner.x + was[i]!.x - all.x - origin.x, y: corner.y + was[i]!.y - all.y - origin.y });
    else {
      delete spec.x;
      delete spec.y;
    }
    try {
      out.push(docStore.insert(doc, parent.id, spec, index === undefined ? undefined : index + out.length));
    } catch {
      // A node this document can't take is left out (as in pasteNodes).
    }
  });
  return out;
}

/** Paste here: the copy's top-left at the pointer (page point), in the frame there. */
export function pasteAt(doc: Y.Doc, s: Laid, clip: Clip, at: { x: number; y: number }, here: boolean): string[] {
  return putAt(doc, s, clip, here, frameAt(s, at.x, at.y), at);
}

/** Paste to replace: the copy takes each selected node's place. Returns the copies. */
export function pasteReplacing(doc: Y.Doc, s: Laid, clip: Clip, ids: string[], here: boolean): string[] {
  const up = parents(s.tree);
  const out: string[] = [];
  for (const id of inOrder(doc, s, ids)) {
    const box = s.boxes.get(id);
    const parent = up.get(id);
    if (!box || !parent) continue;
    const index = docStore.childIds(doc, parent.id).indexOf(id);
    docStore.remove(doc, id);
    out.push(...putAt(doc, s, clip, here, parent, box, index));
  }
  return out;
}
