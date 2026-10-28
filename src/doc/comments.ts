// Comments on a design, as Pen's: a pin on the canvas (on a node, which it follows, or on the page)
// with a thread of messages, open or resolved. Like Pen, they aren't part of the .pen file: they live
// in the document's "comments" map (outside the person's undo) and the host keeps them beside the app's
// data, by the file's token (main/comments.ts).
import * as Y from "yjs";

export interface CommentMessage {
  author: string;
  at: number;
  text: string;
}

export interface CommentThread {
  id: string;
  /** Where the pin is: on a node (from its top-left corner), or on the page. */
  node?: string;
  x: number;
  y: number;
  messages: CommentMessage[];
  resolved: boolean;
  createdAt: number;
}

export const commentsOf = (doc: Y.Doc): Y.Map<CommentThread> => doc.getMap("comments");

/** Every thread, oldest first. */
export function threads(doc: Y.Doc): CommentThread[] {
  return [...commentsOf(doc).values()].sort((a, b) => a.createdAt - b.createdAt);
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** Starts a thread with its first message; its id. */
export function addThread(doc: Y.Doc, at: { node?: string; x: number; y: number }, message: CommentMessage): string {
  const id = newId();
  commentsOf(doc).set(id, { id, ...at, messages: [message], resolved: false, createdAt: message.at });
  return id;
}

function change(doc: Y.Doc, id: string, fn: (t: CommentThread) => CommentThread): void {
  const t = commentsOf(doc).get(id);
  if (t) commentsOf(doc).set(id, fn(t));
}

export const reply = (doc: Y.Doc, id: string, message: CommentMessage) => change(doc, id, (t) => ({ ...t, messages: [...t.messages, message] }));
export const setResolved = (doc: Y.Doc, id: string, resolved: boolean) => change(doc, id, (t) => ({ ...t, resolved }));
export const removeThread = (doc: Y.Doc, id: string) => commentsOf(doc).delete(id);
