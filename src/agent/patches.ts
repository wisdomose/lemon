// Fixing a failed script with small find-and-replace edits instead of writing it again (as in Pen):
// the agent sends only what changes, so a retry takes seconds rather than a full rewrite.

export interface Edit {
  find: string;
  replace: string;
}

/** Failed scripts by edit id, kept until a patched version succeeds. */
export class FailedScripts {
  private scripts = new Map<string, string>();
  private next = 1;

  /** Files a failed script and returns its edit id; a failed patch keeps the id it was sent under. */
  keep(script: string, editId?: string): string {
    const id = editId ?? `e${this.next++}`;
    this.scripts.set(id, script);
    return id;
  }

  /** The script under `editId` with `edits` applied in order. Throws if an edit doesn't fit. */
  patch(editId: string, edits: Edit[]): string {
    let script = this.scripts.get(editId);
    if (script === undefined) throw new Error(`There is no failed script with edit id "${editId}".`);
    for (const [i, e] of edits.entries()) {
      const at = script.indexOf(e.find);
      if (!e.find || at < 0) throw new Error(`Edit ${i + 1}: \`find\` doesn't match the script${i ? " as patched by the edits before it" : ""}.`);
      if (script.indexOf(e.find, at + 1) >= 0) throw new Error(`Edit ${i + 1}: \`find\` matches more than once; include more of the surrounding text.`);
      script = script.slice(0, at) + e.replace + script.slice(at + e.find.length);
    }
    return script;
  }

  /** A patched script worked: it no longer needs fixing. */
  done(editId: string): void {
    this.scripts.delete(editId);
  }
}
