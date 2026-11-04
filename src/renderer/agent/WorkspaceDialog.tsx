// "Add from workspace" (the prompt's "+" menu): pick files from the open document's folder to attach.
// Laid out as Pen's "Attach from workspace" (3 Nov 2026): 512px wide, a bordered list, a full-width
// Attach button. Pen's lists its cloud workspace; Lemon's lists the document's folder (main/workspace.ts).
import { useEffect, useState } from "react";
import { Dialog as D } from "radix-ui";
import { Check, FileText, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { bridge } from "../bridge.js";
import { store } from "../store.js";
import { cx } from "../ui/kit.js";
import type { WorkspaceFile } from "../../main/workspace.js";

export function WorkspaceDialog({ open, onOpenChange, focusPrompt }: { open: boolean; onOpenChange: (open: boolean) => void; focusPrompt: () => void }) {
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [attaching, setAttaching] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFiles(null);
    setChosen(new Set());
    void bridge.workspaceFiles().then(setFiles, () => setFiles([]));
  }, [open]);

  const toggle = (path: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const attach = async () => {
    setAttaching(true);
    try {
      const read = await bridge.readWorkspaceFiles([...chosen]);
      const added = read.map((a) => ({ ...a, id: crypto.randomUUID() }));
      store.set((s) => ({ attachments: [...s.attachments, ...added] }));
      onOpenChange(false);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content
          // Nothing in it looks focused on opening (as in Pen); Tab still goes through it.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            focusPrompt();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[512px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[12px] border border-border bg-background px-4 pt-[17px] pb-4 text-foreground outline-none"
        >
          <D.Title className="text-[13px] leading-4 font-semibold">Attach from workspace</D.Title>
          <D.Description className="mt-[5px] text-[11px] leading-[14px] text-muted-foreground">
            Choose images or text files from this file's folder.
          </D.Description>
          <div className="mt-[13px] h-[180px] overflow-y-auto rounded-[8px] border border-input p-1">
            {files === null ? (
              <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <LoaderCircle size={12} strokeWidth={1.75} className="animate-spin" /> Loading files...
              </div>
            ) : files.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">No attachable files in this workspace.</div>
            ) : (
              files.map((f) => {
                const on = chosen.has(f.path);
                const Icon = f.kind === "image" ? ImageIcon : FileText;
                return (
                  <button
                    key={f.path}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(f.path)}
                    className={cx(
                      "flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px]",
                      on ? "bg-input text-foreground" : "text-foreground/80 hover:bg-foreground/5",
                    )}
                  >
                    <Icon size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{f.path}</span>
                    {on && <Check size={13} strokeWidth={1.75} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            disabled={!chosen.size || attaching}
            onClick={() => void attach()}
            className="mt-[13px] h-[42px] rounded-[8px] bg-input text-[12px] font-semibold text-foreground disabled:text-foreground/60 enabled:hover:bg-input/80"
          >
            Attach
          </button>
          <D.Close aria-label="Close" className="absolute top-[14px] right-[14px] rounded-sm text-muted-foreground hover:text-foreground">
            <span className="text-[16px] leading-none">×</span>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
