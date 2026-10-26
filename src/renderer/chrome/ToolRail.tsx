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
import { useState } from "react";
import { Circle, Code, Diamond as IconShape, FileImage, FileInput, Triangle } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { store, useEditor, type Tool } from "../store.js";
import { IconButton, Island, Tip } from "../ui/kit.js";
import { MenuContent, MenuItem } from "../ui/menu.js";

/** The shapes under the shape tool's arrow (05-shape-variants); only Rectangle and Ellipse draw yet. */
const SHAPES: { tool?: Tool; icon: LucideIcon; label: string; keys?: string }[] = [
  { tool: "rect", icon: Square, label: "Rectangle", keys: "R" },
  { tool: "ellipse", icon: Circle, label: "Ellipse", keys: "O" },
  { icon: Triangle, label: "Polygon" },
  { icon: IconShape, label: "Icon" },
  { icon: Code, label: "Script" },
  { icon: FileImage, label: "Import Image or SVG..." },
  { icon: FileInput, label: "Import Figma" },
];

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
  // The shape button shows the shape last chosen.
  const [shape, setShape] = useState<Tool>("rect");
  const shapeTool = active === "rect" || active === "ellipse" ? active : shape;
  return (
    <div data-rail className="absolute top-[58px] flex w-9 flex-col gap-2" style={{ left: panelOpen ? 394 : 8 }}>
      <Island className="flex h-9 w-9 items-center justify-center rounded-full">
        <Tip label={panelOpen ? "Hide sidebar" : "Show sidebar"} side="right">
          <IconButton icon={PanelLeft} round aria-label="Toggle sidebar" onClick={onTogglePanel} className="text-rail-icon" />
        </Tip>
      </Island>
      <Island className="flex w-9 flex-col items-center gap-1 rounded-full py-1">
        {TOOLS.map((tool) => {
          const shapeSlot = tool.tool === "rect";
          const t = shapeSlot ? { ...tool, ...SHAPES.find((x) => x.tool === shapeTool)! } : tool;
          return (
            <div key={tool.label} className="flex flex-col items-center">
              <Tip label={t.label} keys={t.keys} side="right">
                <IconButton
                  icon={t.icon}
                  round
                  aria-label={t.label}
                  active={t.tool === active}
                  className="text-rail-icon"
                  onClick={() => t.tool && store.set({ tool: t.tool })}
                />
              </Tip>
              {shapeSlot ? (
                <M.Root>
                  <M.Trigger asChild>
                    <button type="button" aria-label="Shapes" className="my-px text-muted-foreground">
                      <ChevronDown size={10} strokeWidth={1.5} />
                    </button>
                  </M.Trigger>
                  <MenuContent side="right" align="start">
                    {SHAPES.map((x) => (
                      <MenuItem
                        key={x.label}
                        label={x.label}
                        keys={x.keys}
                        checked={x.tool === shapeTool}
                        icon={<x.icon size={14} strokeWidth={1.5} />}
                        disabled={!x.tool}
                        onSelect={() => x.tool && (setShape(x.tool), store.set({ tool: x.tool }))}
                      />
                    ))}
                  </MenuContent>
                </M.Root>
              ) : (
                tool.variants && <ChevronDown size={10} strokeWidth={1.5} className="my-px text-muted-foreground" />
              )}
            </div>
          );
        })}
      </Island>
    </div>
  );
}
