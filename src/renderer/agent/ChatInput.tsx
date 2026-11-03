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
import { sendPrompt } from "./chat.js";
import { AddContext, AttachmentTray } from "./AddContext.js";
import { attachFiles } from "./attach.js";
import { matching, SkillList } from "./SkillList.js";
import type { Skill } from "../../main/skills.js";
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
    editor.current!.clear();
    // A skill chip brings its SKILL.md, after the attached files (as in Pen, they come before the prompt).
    const skills = await bridge.readSkills(p.refs.filter((r) => r.kind === "skill").map((r) => r.id));
    sendPrompt(p.shown, forAgent, files, p.parts, skills);
  };

  // The list of skills, open while a "/word" is at the caret (Escape closes it until the word changes).
  const [slash, setSlash] = useState<Slash | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [active, setActive] = useState(0);
  const listOpen = !!slash && slash.from !== dismissed;
  const shown = slash ? matching(skills, slash.query) : [];
  const onSlash = (s: Slash | null) => {
    setSlash(s);
    setActive(0);
    if (!s || s.from !== dismissed) setDismissed(null);
    if (s && !slash) void bridge.skills().then(setSkills);
  };
  const pickSkill = (skill: Skill) => {
    if (!slash) return;
    editor.current!.insertChip({ id: skill.path, name: skill.name, kind: "skill", forAgent: `the skill "${skill.name}"` }, slash);
  };
  const onListKey = (key: string) => {
    if (!listOpen) return false;
    if (key === "Escape") return (setDismissed(slash!.from), true);
    if (!shown.length) return false;
    if (key === "ArrowDown") setActive((a) => (a + 1) % shown.length);
    else if (key === "ArrowUp") setActive((a) => (a - 1 + shown.length) % shown.length);
    else pickSkill(shown[Math.min(active, shown.length - 1)]!);
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
      {listOpen && <SkillList skills={shown} active={active} onActive={setActive} onPick={pickSkill} onSkills={setSkills} />}
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
          onClick={() => (status ? void bridge.stopAgent() : void send())}
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
