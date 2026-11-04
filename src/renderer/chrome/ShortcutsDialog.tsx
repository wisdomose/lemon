// Keyboard Shortcuts (?, or the rail's keyboard button), as Pen's dialog: seven tabs, each two columns
// of groups, every shortcut as key caps. The list is Pen's.
import { useState, type ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { Circle, Frame, Hand, MessageCircle, MousePointer2, PenTool, Scaling, Scissors, Square, Type, ZoomIn, type LucideIcon } from "lucide-react";
import { store, useEditor } from "../store.js";
import { cx } from "../ui/kit.js";

/** Keys are caps; "or" joins alternatives; "Click", "Drag", "Scroll" and the like are caps too. */
type Row = { label: string; keys: string[]; icon?: LucideIcon };
type Group = { title: string; rows: Row[] };
const k = (label: string, keys: string, icon?: LucideIcon): Row => ({ label, keys: keys.split(" "), ...(icon ? { icon } : {}) });

const TABS: { name: string; columns: [Group[], Group[]] }[] = [
  {
    name: "App",
    columns: [
      [
        { title: "File", rows: [k("Save", "Ctrl S"), k("New file", "Ctrl N"), k("Open file", "Ctrl O")] },
        { title: "View", rows: [k("Pixel grid", "Ctrl '"), k("Snap to pixel grid", "Ctrl ⇧ '"), k("Comment markers", "⇧ C"), k("Keyboard shortcuts", "?")] },
      ],
      [{ title: "AI Chat", rows: [k("Toggle chat", "Ctrl K"), k("New chat tab", "Ctrl T"), k("Next chat tab", "Ctrl ⇥"), k("Previous chat tab", "Ctrl ⇧ ⇥"), k("Prompt history", "↑ ↓")] }],
    ],
  },
  {
    name: "Tools",
    columns: [
      [{ title: "General", rows: [k("Move", "V", MousePointer2), k("Scale", "K", Scaling), k("Hand", "H", Hand), k("Comment", "C", MessageCircle), k("Zoom (hold)", "Z", ZoomIn)] }],
      [
        {
          title: "Shapes",
          rows: [k("Frame", "A or F", Frame), k("Text", "T", Type), k("Sticky note", "N", Square), k("Rectangle", "R", Square), k("Ellipse", "O", Circle), k("Pen", "P", PenTool)],
        },
      ],
    ],
  },
  {
    name: "Design",
    columns: [
      [
        {
          title: "Editing",
          rows: [
            k("Duplicate", "Ctrl D"),
            k("Delete", "⌫"),
            k("Group", "Ctrl G"),
            k("Ungroup", "Ctrl ⌫ or Ctrl ⇧ G"),
            k("Frame selection", "Ctrl Alt G"),
            k("Add flex layout", "⇧ A"),
            k("Remove flex layout", "⇧ Alt A"),
            k("Flip horizontal", "⇧ H"),
            k("Flip vertical", "⇧ V"),
            k("Eyedropper", "I"),
            k("Undo", "Ctrl Z"),
            k("Redo", "Ctrl ⇧ Z"),
          ],
        },
      ],
      [
        { title: "Components", rows: [k("Create component", "Ctrl Alt K"), k("Detach instance", "Ctrl Alt X"), k("Replace inside instance", "Alt ⇧ R")] },
        {
          title: "Clipboard",
          rows: [k("Copy", "Ctrl C"), k("Cut", "Ctrl X"), k("Paste", "Ctrl V"), k("Paste to replace", "Ctrl ⇧ R"), k("Copy as PNG", "Ctrl ⇧ C"), k("Copy as HTML", "Ctrl Alt C")],
        },
      ],
    ],
  },
  {
    name: "Arrange",
    columns: [
      [{ title: "Align", rows: [k("Align top", "Alt W"), k("Align left", "Alt A"), k("Align bottom", "Alt S"), k("Align right", "Alt D"), k("Align center", "Alt H"), k("Align middle", "Alt V")] }],
      [{ title: "Ordering", rows: [k("Bring forward", "Ctrl ]"), k("Send backward", "Ctrl ["), k("Bring to front", "]"), k("Send to back", "[")] }],
    ],
  },
  {
    name: "Selection",
    columns: [
      [
        { title: "General", rows: [k("Select all", "Ctrl A"), k("Deselect", "Esc")] },
        { title: "Layers", rows: [k("Select children", "↵"), k("Select parent", "⇧ ↵")] },
      ],
      [
        {
          title: "Mouse",
          rows: [k("Select", "Click"), k("Add to selection", "⇧ Click"), k("Deep select", "Ctrl Click"), k("Box select", "Drag"), k("Add to box selection", "⇧ Drag"), k("Deep box select", "Ctrl Drag")],
        },
      ],
    ],
  },
  {
    name: "Navigation",
    columns: [
      [
        {
          title: "Zoom",
          rows: [
            k("Zoom", "Ctrl Scroll"),
            k("Zoom in", "Ctrl +"),
            k("Zoom out", "Ctrl -"),
            k("Zoom to 100%", "Ctrl 0"),
            k("Zoom to fit", "⇧ 1"),
            k("Zoom to selection", "⇧ 2"),
            k("Zoom in at pointer", "Z Click"),
            k("Zoom out at pointer", "Z Alt Click"),
            k("Zoom to region", "Z Drag"),
          ],
        },
      ],
      [{ title: "Move", rows: [k("Pan", "Scroll"), k("Pan horizontally", "⇧ Scroll"), k("Pan by dragging", "Space Drag"), k("Pan by dragging", "Middle Drag")] }],
    ],
  },
  {
    name: "Path",
    columns: [
      [
        { title: "Tools", rows: [k("Pen", "P", PenTool), k("Select points", "V", MousePointer2), k("Cut", "X", Scissors), k("Edit points of a selected shape", "↵"), k("Finish editing", "↵ or Esc")] },
        {
          title: "Selection",
          rows: [
            k("Select all points", "Ctrl A"),
            k("Duplicate selection", "Ctrl D"),
            k("Drag off a duplicate", "Alt Drag"),
            k("Connect selected points", "Ctrl J"),
            k("Nudge selection (⇧ for big nudge)", "Arrows"),
            k("Delete selected points, segments, or handles", "⌫"),
          ],
        },
      ],
      [
        { title: "Pen tool", rows: [k("Add a point", "Click"), k("Move a point without drawing", "Alt Drag"), k("Insert point on segment", "Alt Click")] },
        { title: "Points & handles", rows: [k("Toggle smooth and corner", "Double·click"), k("Pull symmetric handles", "Ctrl Drag"), k("Break handle symmetry", "Alt Drag")] },
        {
          title: "Segments",
          rows: [k("Bend into a curve", "Ctrl Drag"), k("Bend without moving neighbors", "Ctrl Alt Drag"), k("Straighten segment", "Ctrl Double·click"), k("Select all connected points", "Double·click")],
        },
      ],
    ],
  },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, i) =>
        key === "or" ? (
          <span key={i} className="px-0.5 text-[11px] text-muted-foreground">
            or
          </span>
        ) : (
          <kbd key={i} className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] bg-input px-1.5 font-sans text-[11px] font-semibold text-foreground">
            {key.replace("·", " ")}
          </kbd>
        ),
      )}
    </span>
  );
}

function Column({ groups }: { groups: Group[] }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="mb-1 text-[13px] font-semibold text-foreground">{g.title}</div>
          {g.rows.map((r, i) => (
            <div key={i} className="flex h-[28px] items-center gap-2 text-[12px] text-muted-foreground">
              {r.icon && <r.icon size={12} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <Keys keys={r.keys} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useEditor((s) => s.shortcutsOpen);
  const [tab, setTab] = useState(0);
  const current = TABS[tab]!;
  return (
    <D.Root open={open} onOpenChange={(o) => store.set({ shortcutsOpen: o })}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content className="fixed top-1/2 left-1/2 z-50 flex h-[490px] w-[660px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[12px] border border-border bg-background text-foreground outline-none">
          <D.Title className="px-[17px] pt-[18px] text-[15px] font-semibold">Keyboard Shortcuts</D.Title>
          <D.Description className="sr-only">Every shortcut, by what it is for.</D.Description>
          <div className="mx-[8px] mt-[14px] flex h-[32px] rounded-[10px] bg-input/60 p-[2px]">
            {TABS.map((t, i) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setTab(i)}
                className={cx("flex-1 rounded-[8px] text-[13px]", tab === i ? "border border-foreground/30 bg-background font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div className="mt-[14px] min-h-0 flex-1 overflow-y-auto px-[17px] pb-4">
            <div className="grid grid-cols-2 gap-x-8">
              <Column groups={current.columns[0]} />
              <Column groups={current.columns[1]} />
            </div>
          </div>
          <D.Close aria-label="Close" className="absolute top-[16px] right-[18px] rounded-sm text-muted-foreground hover:text-foreground">
            <span className="text-[16px] leading-none">×</span>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
