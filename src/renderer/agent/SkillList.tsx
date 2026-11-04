// The list of skills a "/" in the prompt opens ("+" → Pick a skill types the "/"). As in Pen (3 Nov
// 2026): it sits in the bottom of the panel above the chat box, on the panel's own background; rows
// show the skill's name and description; typing after the "/" keeps the skills whose names hold it;
// skills the person added show a bin while hovered; "Add SKILL.md file..." adds one from a folder.
import { useEffect, useState } from "react";
import { Box, FileText, Trash2 } from "lucide-react";
import { bridge } from "../bridge.js";
import { cx } from "../ui/kit.js";
import type { Skill } from "../../main/skills.js";
import type { WorkspaceFile } from "../../main/workspace.js";

/** The skills whose names hold `query`. */
export const matching = (skills: Skill[], query: string) => skills.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

export function SkillList({
  skills,
  active,
  onActive,
  onPick,
  onSkills,
}: {
  /** The skills shown (already filtered). */
  skills: Skill[];
  /** The highlighted row. */
  active: number;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  /** The list changed (a skill added or removed). */
  onSkills: (skills: Skill[]) => void;
}) {
  // Keep the highlighted row in view as the arrows move it.
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    rows?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [rows, active]);
  return (
    <div
      // Clicks in the list mustn't take the caret out of the prompt.
      onMouseDown={(e) => e.preventDefault()}
      className="absolute right-px bottom-[calc(100%+9px)] left-px rounded-b-[19px] bg-island px-2 pt-2 pb-1.5 text-[12px]"
    >
      <div ref={setRows} role="listbox" aria-label="Skills" className="scroll-quiet max-h-[300px] overflow-y-auto">
        {skills.map((s, i) => (
          <div
            key={s.path}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => onActive(i)}
            onClick={() => onPick(s)}
            className={cx("group flex h-[30px] cursor-default items-center gap-2 rounded-[6px] px-2.5", i === active && "bg-input")}
          >
            <Box size={14} strokeWidth={1.5} className="shrink-0 text-[#a78bfa]" />
            <span className="shrink-0 font-semibold text-foreground">{s.name}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{s.description}</span>
            {s.added && (
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void bridge.removeSkill(s.path, s.name).then(onSkills);
                }}
                className="hidden shrink-0 text-muted-foreground group-hover:block hover:text-foreground"
              >
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => void bridge.addSkill().then(onSkills)} className="mt-1 h-[22px] px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
        Add SKILL.md file...
      </button>
    </div>
  );
}

/**
 * The list an "@" opens: the files beside the document, the open one too (Pen, 4 Nov 2026), each with
 * the folder it is in. Typing after the "@" keeps the files whose names hold it.
 */
export function FileList({ files, active, onActive, onPick }: { files: WorkspaceFile[]; active: number; onActive: (i: number) => void; onPick: (f: WorkspaceFile) => void }) {
  const [rows, setRows] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    rows?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [rows, active]);
  if (!files.length) return null;
  return (
    <div onMouseDown={(e) => e.preventDefault()} className="absolute right-px bottom-[calc(100%+9px)] left-px rounded-b-[19px] bg-island px-2 pt-2 pb-2 text-[12px]">
      <div ref={setRows} role="listbox" aria-label="Files" className="scroll-quiet max-h-[300px] overflow-y-auto">
        {files.map((f, i) => {
          const at = f.path.lastIndexOf("/");
          return (
            <div
              key={f.path}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => onActive(i)}
              onClick={() => onPick(f)}
              className={cx("flex h-[30px] cursor-default items-center gap-2 rounded-[6px] px-2.5", i === active && "bg-input")}
            >
              <FileText size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-foreground">{f.path.slice(at + 1)}</span>
              {at > 0 && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{f.path.slice(0, at)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The files whose names hold `query`. */
export const matchingFiles = (files: WorkspaceFile[], query: string) => files.filter((f) => (f.path.split("/").pop() ?? "").toLowerCase().includes(query.toLowerCase()));
