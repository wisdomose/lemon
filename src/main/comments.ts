// Keeps a file's comments beside the app's data (Comments/<file token>.json), as Pen keeps them
// outside the .pen file. The file gets a token (Pen's `fileToken`) the first time it has a comment.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import * as Y from "yjs";
import { commentsOf, type CommentThread } from "../doc/comments.js";
import { metaOf } from "../doc/store.js";

/** The origin of comments read from disk (they aren't written straight back). */
const LOADED = Symbol("comments loaded");
const SAVE_AFTER_MS = 500;

function folder(): string {
  const dir = join(app.getPath("userData"), "Comments");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class Comments {
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly doc: Y.Doc) {
    this.load();
    commentsOf(doc).observe((e) => {
      if (e.transaction.origin === LOADED) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.save(), SAVE_AFTER_MS);
    });
  }

  private token(create: boolean): string | undefined {
    const meta = metaOf(this.doc);
    let token = meta.get("fileToken") as string | undefined;
    if (!token && create) {
      token = randomUUID();
      meta.set("fileToken", token);
    }
    return token;
  }

  /** The file's comments, read again (the panel's refresh). */
  load(): void {
    const token = this.token(false);
    const path = token && join(folder(), `${token}.json`);
    if (!path || !existsSync(path)) return;
    try {
      const list = JSON.parse(readFileSync(path, "utf8")) as CommentThread[];
      this.doc.transact(() => {
        const map = commentsOf(this.doc);
        map.clear();
        for (const t of list) map.set(t.id, t);
      }, LOADED);
    } catch {
      // A damaged comments file leaves the comments as they are.
    }
  }

  save(): void {
    clearTimeout(this.timer);
    const list = [...commentsOf(this.doc).values()];
    const token = this.token(list.length > 0);
    if (!token) return;
    writeFileSync(join(folder(), `${token}.json`), JSON.stringify(list, null, 2));
  }

  dispose(): void {
    if (this.timer) this.save();
  }
}
