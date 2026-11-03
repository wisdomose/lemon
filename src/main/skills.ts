// Skills for the prompt's "/" list ("+" → Pick a skill). As in Pen (3 Nov 2026): its own skills, then
// the ones the person added ("Add SKILL.md file..."), which are kept by where their SKILL.md is, never
// copied. Lemon's own skills are the ones Pen keeps on this machine (~/.pencil/skills), read where they are.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  /** Its SKILL.md. */
  path: string;
  /** Added by the person: it can be removed. */
  added: boolean;
}

/** Pen's skills folder: one folder per skill, each with a SKILL.md. */
export const PEN_SKILLS = join(homedir(), ".pencil", "skills");

/** The name and description from a SKILL.md's front matter (the folder's name if it has none). */
export function readSkillInfo(path: string): { name: string; description: string } | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const lines = front.split(/\r?\n/);
  const field = (key: string) => {
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at < 0) return undefined;
    const value = lines[at]!.slice(key.length + 1).trim();
    // A block (">" folds its indented lines into one, "|" keeps them as lines).
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      for (const l of lines.slice(at + 1)) {
        if (l.trim() && !/^\s/.test(l)) break;
        block.push(l.trim());
      }
      return block.join(value.startsWith(">") ? " " : "\n").trim();
    }
    return value.replace(/^(["'])(.*)\1$/, "$2");
  };
  return { name: field("name") || basename(dirname(path)), description: field("description") ?? "" };
}

export class Skills {
  /** `store`: where the added skills' SKILL.md paths are kept (a JSON list). */
  constructor(
    private store: string,
    private builtIn = PEN_SKILLS,
  ) {}

  private added(): string[] {
    try {
      const list = JSON.parse(readFileSync(this.store, "utf8")) as unknown;
      return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  private save(list: string[]) {
    writeFileSync(this.store, JSON.stringify(list, null, 2));
  }

  /** Every skill: the built-in ones by name, then the added ones in the order they were added. */
  list(): Skill[] {
    let folders: string[] = [];
    try {
      folders = readdirSync(this.builtIn, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // No skills of Pen's on this machine.
    }
    const own = folders.flatMap((f) => {
      const path = join(this.builtIn, f, "SKILL.md");
      const info = existsSync(path) ? readSkillInfo(path) : null;
      return info ? [{ ...info, path, added: false }] : [];
    });
    const added = this.added().flatMap((path) => {
      const info = readSkillInfo(path);
      return info ? [{ ...info, path, added: true }] : [];
    });
    return [...own, ...added];
  }

  /** Adds the skill in `folder`; an error message if it has no SKILL.md. */
  add(folder: string): string | null {
    const path = join(folder, "SKILL.md");
    if (!existsSync(path)) return `There is no SKILL.md in ${basename(folder)}.`;
    const list = this.added();
    if (!list.includes(path)) this.save([...list, path]);
    return null;
  }

  remove(path: string): void {
    this.save(this.added().filter((p) => p !== path));
  }

  /** A skill's SKILL.md, for the agent; only a listed skill's. */
  read(path: string): string | null {
    if (!this.list().some((s) => s.path === path)) return null;
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  }
}
