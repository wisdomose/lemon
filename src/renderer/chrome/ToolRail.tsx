// The vertical tool rail: a sidebar toggle, then the tools. Order, names and keys from the PRD.
import {
  ChevronDown,
  Frame,
  Globe,
  Hand,
  Keyboard,
  MousePointer2,
  PanelLeft,
  PenTool,
  Square,
  StickyNote,
  Type,
  Diamond,
  type LucideIcon,
} from "lucide-react";
import { store, useEditor, type Tool } from "../store.js";
import { IconButton, Island, Tip } from "../ui/kit.js";

const TOOLS: { tool?: Tool; icon: LucideIcon; label: string; keys?: string; variants?: boolean }[] = [
  { tool: "move", icon: MousePointer2, label: "Move", keys: "V", variants: true },
  { tool: "rect", icon: Square, label: "Rectangle", keys: "R", variants: true },
  { tool: "pen", icon: PenTool, label: "Pen", keys: "P" },
  { tool: "text", icon: Type, label: "Text", keys: "T" },
  { tool: "frame", icon: Frame, label: "Frame", keys: "A" },
  { tool: "note", icon: StickyNote, label: "Sticky Note", keys: "N" },
  { tool: "browser", icon: Globe, label: "Browser" },
  { tool: "hand", icon: Hand, label: "Hand", keys: "H" },
  { icon: Diamond, label: "Variables" },
  { icon: Keyboard, label: "Keyboard Shortcuts", keys: "?" },
];

export function ToolRail({ panelOpen, onTogglePanel }: { panelOpen: boolean; onTogglePanel: () => void }) {
  const active = useEditor((s) => s.tool);
  return (
    <div data-rail className="absolute top-[58px] flex w-9 flex-col gap-2" style={{ left: panelOpen ? 394 : 8 }}>
      <Island className="flex h-9 w-9 items-center justify-center rounded-full">
        <Tip label={panelOpen ? "Hide sidebar" : "Show sidebar"} side="right">
          <IconButton icon={PanelLeft} round aria-label="Toggle sidebar" onClick={onTogglePanel} className="text-popover-foreground" />
        </Tip>
      </Island>
      <Island className="flex w-9 flex-col items-center gap-1 rounded-full py-1">
        {TOOLS.map((t) => (
          <div key={t.label} className="flex flex-col items-center">
            <Tip label={t.label} keys={t.keys} side="right">
              <IconButton
                icon={t.icon}
                round
                aria-label={t.label}
                active={t.tool === active}
                className="text-popover-foreground"
                onClick={() => t.tool && store.set({ tool: t.tool })}
              />
            </Tip>
            {t.variants && <ChevronDown size={10} strokeWidth={1.5} className="my-px text-muted-foreground" />}
          </div>
        ))}
      </Island>
    </div>
  );
}
