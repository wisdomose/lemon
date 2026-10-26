// What the canvas draws over the document while the person works (page coordinates): written by the
// pointer handling (gestures.ts) and the text editor, read by the drawing (canvas.ts).
import type { Box } from "../../layout/layout.js";

export type Line = { x1: number; y1: number; x2: number; y2: number };

export const overlay = {
  /** The selection box being dragged out. */
  marquee: null as Box | null,
  /** Snapping guides (red) while moving. */
  guides: [] as Line[],
  /** Where dragged nodes will land in a row or column. */
  drop: null as Line | null,
  /** Outlines of nodes being dragged to another place (they move when dropped). */
  ghosts: [] as Box[],
  /** The shape being drawn with a drawing tool. */
  draft: null as Box | null,
  /** A move is under way: handles, size pill and badge are hidden (as in Pen). */
  moving: false,
  /** A resize is under way: handles are hidden, the size pill stays. */
  resizing: false,
  /** The text being typed into, with its caret and selected range (UTF-16 offsets). */
  editing: null as { id: string; start: number; end: number; since: number } | null,
};
