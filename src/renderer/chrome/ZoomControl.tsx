// The zoom pill at the bottom right: −, the zoom level (opens the zoom menu), +.
import { Minus, Plus } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import { setZoom, zoomStep, zoomToFit } from "../canvas/canvas.js";
import { currentScene } from "../scene.js";
import { store, useEditor } from "../store.js";
import { Island } from "../ui/kit.js";
import { MenuContent, MenuItem } from "../ui/menu.js";

export function ZoomControl() {
  const zoom = useEditor((s) => s.zoom);
  // Sits 8px left of the properties panel while something is selected, as in the reference.
  const panel = useEditor((s) => s.selection !== null);
  const zoomToSelection = () => {
    const id = store.get().selection;
    const box = id ? currentScene()?.boxes.get(id) : undefined;
    if (box) zoomToFit(true, box, 32);
  };
  return (
    <Island className="absolute bottom-2 flex h-8 items-center gap-0.5 rounded-full px-1" style={{ right: panel ? 8 + 221 + 8 : 8 }}>
      <button type="button" aria-label="Zoom out" onClick={() => zoomStep(-1)} className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5">
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <M.Root>
        <M.Trigger asChild>
          <button type="button" className="h-6 min-w-[44px] rounded-md px-1 text-[13px] font-semibold text-foreground tabular-nums hover:bg-foreground/5">
            {Math.round(zoom * 100)}%
          </button>
        </M.Trigger>
        <MenuContent side="top" align="end">
          <MenuItem label="Zoom in" keys="Ctrl +" onSelect={() => zoomStep(1)} />
          <MenuItem label="Zoom out" keys="Ctrl −" onSelect={() => zoomStep(-1)} />
          <MenuItem label="Zoom to fit" keys="Shift 1" onSelect={() => zoomToFit()} />
          <MenuItem label="Zoom to selection" keys="Shift 2" onSelect={zoomToSelection} />
          <MenuItem label="Zoom to 50%" onSelect={() => setZoom(0.5)} />
          <MenuItem label="Zoom to 100%" keys="Ctrl 0" onSelect={() => setZoom(1)} />
          <MenuItem label="Zoom to 200%" onSelect={() => setZoom(2)} />
        </MenuContent>
      </M.Root>
      <button type="button" aria-label="Zoom in" onClick={() => zoomStep(1)} className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5">
        <Plus size={14} strokeWidth={1.5} />
      </button>
    </Island>
  );
}
