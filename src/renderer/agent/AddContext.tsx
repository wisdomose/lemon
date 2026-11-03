// The prompt's "+" menu, "Add to context", and the tray of attached files above the prompt. As in Pen
// (3 Nov 2026): images show as 48px squares whose × shows while the pointer is over the chat box,
// other files as named pills that always show theirs; the tray is one row tall and scrolls.
import { useState } from "react";
import { DropdownMenu as M } from "radix-ui";
import { Box, FileText, Globe, HardDrive, Palette, Paperclip, Plus, X } from "lucide-react";
import { MenuContent, MenuItem, MenuLabel } from "../ui/menu.js";
import { toggleSidebar } from "../chrome/BrowserSidebar.js";
import { useEditor } from "../store.js";
import { dataUrl, detach, pickFiles } from "./attach.js";
import { WorkspaceDialog } from "./WorkspaceDialog.js";

const ICON = { size: 14, strokeWidth: 1.5 } as const;

/**
 * `focusPrompt`: where the caret goes once the menu closes (the prompt, as in Pen). `pickSkill` types
 * the "/" that opens the list of skills.
 */
export function AddContext({ focusPrompt, pickSkill }: { focusPrompt: () => void; pickSkill: () => void }) {
  const [workspace, setWorkspace] = useState(false);
  return (
    <>
      <M.Root>
        <M.Trigger asChild>
          <button
            type="button"
            aria-label="Add to context"
            className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md hover:bg-foreground/5 data-[state=open]:bg-foreground/5"
          >
            <Plus size={14} strokeWidth={1.5} />
          </button>
        </M.Trigger>
        <MenuContent
          side="top"
          align="start"
          sideOffset={8}
          alignOffset={1}
          className="w-[207px]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusPrompt();
          }}
        >
          <MenuLabel>Add to context</MenuLabel>
          <MenuItem icon={<Paperclip {...ICON} />} label="Add image or file" onSelect={pickFiles} />
          <MenuItem icon={<HardDrive {...ICON} />} label="Add from workspace" onSelect={() => setWorkspace(true)} />
          <MenuItem icon={<Globe {...ICON} />} label="Import from browser" onSelect={() => toggleSidebar(true)} />
          <MenuItem icon={<Palette {...ICON} />} label="Choose a style" />
          <MenuItem icon={<Box {...ICON} />} label="Pick a skill" onSelect={pickSkill} />
        </MenuContent>
      </M.Root>
      <WorkspaceDialog open={workspace} onOpenChange={setWorkspace} focusPrompt={focusPrompt} />
    </>
  );
}

/** The attached files, above the prompt; nothing while there are none. */
export function AttachmentTray() {
  const attachments = useEditor((s) => s.attachments);
  if (!attachments.length) return null;
  return (
    // One row shows (and a sliver of the next); the × of the top row overhangs into the padding.
    <div className="scroll-quiet -mt-[6px] mb-[10px] flex max-h-[63px] shrink-0 flex-wrap items-start gap-1.5 overflow-y-auto pt-[5px] pr-1">
      {attachments.map((a) =>
        a.kind === "image" ? (
          <div key={a.id} className="relative h-12 w-12 shrink-0">
            <img src={dataUrl(a)} alt={a.name} title={a.name} className="h-12 w-12 rounded-[6px] object-cover" />
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => detach(a.id)}
              className="absolute -top-[5px] -right-[5px] hidden h-[14px] w-[14px] items-center justify-center rounded-full bg-[#52525b] text-white group-hover/box:flex"
            >
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <div
            key={a.id}
            className="flex h-[26px] max-w-[180px] shrink-0 items-center gap-1 rounded-[6px] border border-input pr-1.5 pl-2 text-[11px] text-muted-foreground"
          >
            <FileText size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate text-foreground/80">{a.name}</span>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => detach(a.id)}
              className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:text-foreground"
            >
              <X size={10} strokeWidth={2} />
            </button>
          </div>
        ),
      )}
    </div>
  );
}
