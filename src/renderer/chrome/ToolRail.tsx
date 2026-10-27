// The vertical tool rail as in Pen: a sidebar toggle, the tools (Move and the shape tool with a menu
// under their arrows), and the command palette button below.
import {
  Check,
  ChevronDown,
  Component,
  Ellipsis,
  Frame,
  Globe,
  Hand,
  Keyboard,
  MessageCircle,
  MousePointer2,
  PanelLeft,
  PenTool,
  Scaling,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Circle, Code, Diamond as IconShape, FileImage, FileInput, Triangle } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import phosphorTtf from "@phosphor-icons/web/thin/Phosphor-Thin.ttf?url";
import { store, useEditor, type Tool } from "../store.js";
import { IconButton, Island, Tip } from "../ui/kit.js";
import { MenuContent, MenuItem } from "../ui/menu.js";

// Pen's sticky-note icon is Phosphor's thin "note" (a page with lines and its corner folded at the bottom
// right), which lucide has no match for; it is drawn from Phosphor's font.
const PHOSPHOR_UI = "Phosphor UI";
new FontFace(PHOSPHOR_UI, `url(${phosphorTtf})`)
  .load()
  .then((face) => document.fonts.add(face))
  .catch(() => {});
const NoteIcon = (({ size = 16 }: { size?: number }) => (
  <span aria-hidden className="inline-flex items-center justify-center leading-none" style={{ fontFamily: PHOSPHOR_UI, fontSize: size + 2, width: size, height: size }}>
    {""}
  </span>
)) as unknown as LucideIcon;

interface Item {
  tool?: Tool;
  icon: LucideIcon;
  label: string;
  keys?: string;
}

/** Under the Move tool's arrow. Lemon has no Scale tool yet. */
const MOVES: Item[] = [
  { tool: "move", icon: MousePointer2, label: "Move", keys: "V" },
  { icon: Scaling, label: "Scale", keys: "K" },
];

/** Under the shape tool's arrow (05-shape-variants); only Rectangle and Ellipse draw yet. */
const SHAPES: Item[] = [
  { tool: "rect", icon: Square, label: "Rectangle", keys: "R" },
  { tool: "ellipse", icon: Circle, label: "Ellipse", keys: "O" },
  { icon: Triangle, label: "Polygon" },
  { icon: IconShape, label: "Icon" },
  { icon: Code, label: "Script" },
  { icon: FileImage, label: "Import Image or SVG..." },
  { icon: FileInput, label: "Import Figma" },
];

/** The rail's buttons, top to bottom, with Pen's names and keys. Comment and Variables do nothing yet. */
const TOOLS: (Item & { menu?: Item[] })[] = [
  { tool: "move", icon: MousePointer2, label: "Move", keys: "V", menu: MOVES },
  { tool: "rect", icon: Square, label: "Rectangle", keys: "R", menu: SHAPES },
  { tool: "pen", icon: PenTool, label: "Pen", keys: "P" },
  { tool: "text", icon: Type, label: "Text", keys: "T" },
  { tool: "frame", icon: Frame, label: "Frame", keys: "F" },
  { tool: "note", icon: NoteIcon, label: "Sticky Note", keys: "N" },
  { tool: "browser", icon: Globe, label: "Browser" },
  { tool: "hand", icon: Hand, label: "Hand", keys: "H" },
  { icon: MessageCircle, label: "Comment", keys: "C" },
  { icon: Component, label: "Variables" },
  { icon: Keyboard, label: "Keyboard Shortcuts", keys: "⇧+/" },
];

export function ToolRail({ panelOpen, onTogglePanel }: { panelOpen: boolean; onTogglePanel: () => void }) {
  const active = useEditor((s) => s.tool);
  // The shape button shows the shape last chosen.
  const [shape, setShape] = useState<Tool>("rect");
  const shapeTool = active === "rect" || active === "ellipse" ? active : shape;
  return (
    <div data-rail className="absolute top-[58px] flex w-9 flex-col gap-2" style={{ left: panelOpen ? 394 : 8 }}>
      {/* Pen shows no tooltip on the sidebar toggle. */}
      <Island className="flex h-9 w-9 items-center justify-center rounded-full">
        <IconButton icon={PanelLeft} round aria-label={panelOpen ? "Hide sidebar" : "Show sidebar"} onClick={onTogglePanel} className="text-rail-icon" />
      </Island>
      <Island className="flex w-9 flex-col items-center gap-1 rounded-full py-1">
        {TOOLS.map((tool) => {
          const t = tool.menu === SHAPES ? { ...tool, ...SHAPES.find((x) => x.tool === shapeTool)! } : tool;
          const current = tool.menu === SHAPES ? shapeTool : active;
          return (
            <div key={tool.label} className="flex flex-col items-center">
              <Tip label={t.label} keys={t.keys} side="right">
                <IconButton
                  icon={t.icon}
                  round
                  aria-label={t.label}
                  active={!!t.tool && t.tool === active}
                  className="text-rail-icon"
                  onClick={() => t.tool && store.set({ tool: t.tool })}
                />
              </Tip>
              {tool.menu && (
                <M.Root>
                  <M.Trigger asChild>
                    <button
                      type="button"
                      aria-label={`${tool.label} tools`}
                      className="my-px flex w-8 justify-center rounded-[6px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-foreground/20"
                    >
                      <ChevronDown size={10} strokeWidth={1.5} />
                    </button>
                  </M.Trigger>
                  <MenuContent side="right" align="start">
                    {tool.menu.map((x) => (
                      <MenuItem
                        key={x.label}
                        label={x.label}
                        keys={x.keys}
                        // Pen ticks the current one on the left, before its icon.
                        icon={
                          <>
                            <span className="flex w-3 shrink-0 justify-center">{x.tool === current && <Check size={12} strokeWidth={1.5} />}</span>
                            <x.icon size={14} strokeWidth={1.5} />
                          </>
                        }
                        disabled={!x.tool}
                        onSelect={() => {
                          if (!x.tool) return;
                          if (tool.menu === SHAPES) setShape(x.tool);
                          store.set({ tool: x.tool });
                        }}
                      />
                    ))}
                  </MenuContent>
                </M.Root>
              )}
            </div>
          );
        })}
      </Island>
      {/* Lemon has no command palette yet. */}
      <Island className="flex h-9 w-9 items-center justify-center rounded-full">
        <Tip label="Command palette" keys="Ctrl+P" side="right">
          <IconButton icon={Ellipsis} round aria-label="Command palette" className="text-rail-icon" />
        </Tip>
      </Island>
    </div>
  );
}
