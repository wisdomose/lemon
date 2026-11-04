// The chat input island under the left panel: the prompt (with canvas references) and footer controls.
import { useRef, useState } from "react";
import { PromptEditor, type PromptEditorHandle, type Slash } from "./PromptEditor.js";
import { ParallelAgents, Variants } from "./RunOptions.js";
import { ArrowUp, Square } from "lucide-react";
import { ModelPicker } from "./ModelPicker.js";
import { bridge, currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { findNode } from "../../render/screenshot.js";
import type { TreeNode } from "../../doc/schema.js";
import type { ChipRef } from "./prompt-doc.js";
import { sendPrompt, stopAgent } from "./chat.js";
import { AddContext, AttachmentTray } from "./AddContext.js";
import { attachFiles } from "./attach.js";
import { FileList, matching, matchingFiles, SkillList } from "./SkillList.js";
import type { Skill } from "../../main/skills.js";
import type { WorkspaceFile } from "../../main/workspace.js";

/** Prompts sent from this window, oldest first, for ↑ and ↓ (as Pen brings back the last prompt). */
const sentPrompts: unknown[] = [];
import { styleText } from "../../agent/directions.js";

/** A prompt's reference to the element picked in the browser sidebar (the agent reads it with target "selection"). */
const BROWSER_SELECTION = "browser-selection";

export function ChatInput() {
  const footer = useRef<HTMLDivElement>(null);
  const status = useEditor((s) => s.agentStatus);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.docVersion);
  const tree = currentScene()?.tree;
  const nodes = tree ? selection.map((id) => findNode(tree, id)).filter((n) => !!n) : [];
  const one = (n: TreeNode) => ({ id: n.id, name: n.props.name ?? n.type[0]!.toUpperCase() + n.type.slice(1), kind: n.type });
  // Several selected nodes share one chip, "3 nodes", as in the reference.
  // An element picked in the browser sidebar is the reference while it is picked (as in Pen).
  const pick = useEditor((s) => (s.sidebar?.url ? s.sidebar.pick : null));
  const ref: ChipRef | null = pick
    ? { id: BROWSER_SELECTION, name: pick.crumbs[pick.index]?.tag ?? "element", kind: "browser" }
    : nodes.length > 1
      ? { id: nodes.map((n) => n.id).join(","), name: `${nodes.length} nodes`, kind: "nodes", members: nodes.map(one) }
      : nodes[0]
        ? one(nodes[0])
        : null;
  const editor = useRef<PromptEditorHandle>(null);
  const [canSend, setCanSend] = useState(false);
  const send = async () => {
    const p = editor.current?.read();
    if (!p || p.isEmpty) return;
    // A prompt of references only asks the agent to work on them.
    const forAgent = p.hasText ? p.forAgent : `${p.forAgent}\nImprove this.`;
    const files = store.get().attachments;
    store.set({ attachments: [] });
    sentPrompts.push(editor.current!.save());
    recalled.current = null;
    editor.current!.clear();
    // A skill chip brings its SKILL.md, after the attached files (as in Pen, they come before the prompt).
    const skills = await bridge.readSkills(p.refs.filter((r) => r.kind === "skill").map((r) => r.id));
    // An "@" file chip is its path in the prompt, as in Pen; Pen's agent reads the file itself, Lemon's
    // can't, so the file comes along too, named by that path.
    const mentioned = await bridge.readWorkspaceFiles(p.refs.filter((r) => r.kind === "file").map((r) => r.id), true);
    sendPrompt(p.shown, forAgent, files, p.parts, [...skills, ...mentioned]);
  };

  // ↑ in an empty prompt brings back the last one sent (chips and all), ↑ again the one before; ↓ goes
  // the other way, back to an empty prompt. Only while the prompt is empty or as it was brought back.
  const recalled = useRef<{ index: number; saved: string } | null>(null);
  const onRecall = (step: -1 | 1) => {
    const e = editor.current!;
    const now = JSON.stringify(e.save());
    const untouched = recalled.current ? now === recalled.current.saved : e.read().isEmpty;
    if (!untouched || !sentPrompts.length) return false;
    const from = recalled.current?.index ?? sentPrompts.length;
    const index = from + step;
    if (index < 0) return true;
    if (index >= sentPrompts.length) {
      if (!recalled.current) return false;
      recalled.current = null;
      e.clear();
      return true;
    }
    e.load(sentPrompts[index]);
    recalled.current = { index, saved: JSON.stringify(e.save()) };
    return true;
  };

  // The list a "/word" (skills) or "@word" (files) opens at the caret; Escape closes it until the word changes.
  const [slash, setSlash] = useState<Slash | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceFile[]>([]);
  const [active, setActive] = useState(0);
  const listOpen = !!slash && slash.from !== dismissed;
  const shown = slash?.char === "/" ? matching(skills, slash.query) : [];
  const shownFiles = slash?.char === "@" ? matchingFiles(workspace, slash.query) : [];
  const onSlash = (s: Slash | null) => {
    setSlash(s);
    setActive(0);
    if (!s || s.from !== dismissed) setDismissed(null);
    if (s?.char === "/" && slash?.char !== "/") void bridge.skills().then(setSkills);
    if (s?.char === "@" && slash?.char !== "@") void bridge.workspaceFiles(true).then(setWorkspace);
  };
  const pickSkill = (skill: Skill) => {
    if (!slash) return;
    editor.current!.insertChip({ id: skill.path, name: skill.name, kind: "skill", forAgent: `the skill "${skill.name}"` }, slash);
  };
  const pickFile = (f: WorkspaceFile) => {
    if (!slash) return;
    editor.current!.insertChip({ id: f.path, name: f.path.split("/").pop()!, kind: "file", forAgent: `"${f.path}"` }, slash);
  };
  const onListKey = (key: string) => {
    if (!listOpen) return false;
    if (key === "Escape") return (setDismissed(slash!.from), true);
    const count = slash!.char === "/" ? shown.length : shownFiles.length;
    if (!count) return false;
    if (key === "ArrowDown") setActive((a) => (a + 1) % count);
    else if (key === "ArrowUp") setActive((a) => (a - 1 + count) % count);
    else if (slash!.char === "/") pickSkill(shown[Math.min(active, count - 1)]!);
    else pickFile(shownFiles[Math.min(active, count - 1)]!);
    return true;
  };
  return (
    <Island
      className="group/box relative flex max-h-[calc(50%-4px)] min-h-[91px] shrink-0 flex-col pt-[14px] pb-2 pl-3 pr-[11px]"
      // Files dropped on the chat box are attached, as if picked.
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void attachFiles(e.dataTransfer.files);
      }}
    >
      {listOpen && slash.char === "/" && <SkillList skills={shown} active={active} onActive={setActive} onPick={pickSkill} onSkills={setSkills} />}
      {listOpen && slash.char === "@" && <FileList files={shownFiles} active={active} onActive={setActive} onPick={pickFile} />}
      <AttachmentTray />
      {/* The prompt, with canvas references inline (PromptEditor). Grows with its text up to the box's
          maximum, then scrolls. */}
      <div className="mb-1 flex min-h-0 flex-1 overflow-y-auto">
        <PromptEditor
          ref={editor}
          selection={ref}
          placeholder="Design anything..."
          onSubmit={() => void send()}
          onChange={setCanSend}
          onFiles={attachFiles}
          onSlash={onSlash}
          onListKey={onListKey}
          onRecall={onRecall}
        />
      </div>
      <div ref={footer} className="mt-auto flex h-6 items-center text-[11px] text-muted-foreground">
        <AddContext
          focusPrompt={() => editor.current?.focus()}
          pickSkill={() => editor.current?.type("/")}
          // The agent reads the style on lines of its own in the chip's place (as Pen's does).
          pickStyle={(d) => editor.current?.insertChip({ id: `style:${d.id}`, name: d.name, kind: "style", forAgent: `\n${styleText(d)}\n` })}
        />
        <ParallelAgents anchor={footer} />
        <Variants anchor={footer} />
        <ModelPicker />
        <button
          type="button"
          aria-label={status ? "Stop" : "Send"}
          onClick={() => (status ? stopAgent() : void send())}
          disabled={!status && !canSend}
          className="ml-[10px] flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background disabled:bg-send-off disabled:text-send-off-icon data-[running=true]:bg-send-off data-[running=true]:text-foreground"
          data-running={!!status}
        >
          {status ? <Square size={9} strokeWidth={2} /> : <ArrowUp size={12} strokeWidth={2.25} />}
        </button>
      </div>
    </Island>
  );
}
