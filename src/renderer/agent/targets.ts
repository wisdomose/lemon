// Where on the canvas the agent cursor goes for a target read from the script being written
// (src/agent/live-script.ts): page coordinates in this window's own layout, so the cursor follows
// things that moved in the meantime.
import type { Target } from "../../agent/live-script.js";
import { ROOT_ID } from "../../doc/schema.js";
import { kindOf } from "../../layout/layout.js";
import { emptySpot } from "../../layout/space.js";
import { findNode } from "../../render/screenshot.js";
import type { Scene } from "../scene.js";

export function targetPoint(t: Target, s: Scene): { x: number; y: number } | undefined {
  if ("id" in t) return s.boxes.get(t.id);
  if (t.parent === ROOT_ID) return t.at ?? emptySpot(s.tree, s.boxes);
  const parent = findNode(s.tree, t.parent);
  const pb = s.boxes.get(t.parent);
  if (!parent || !pb) return undefined;
  const layout = kindOf(parent);
  if (layout === "free") return t.at ? { x: pb.x + t.at.x, y: pb.y + t.at.y } : pb;
  // In a row or column: where the new child will sit — before the child now at `index`, or after the last.
  const kids = parent.children.map((c) => s.boxes.get(c.id)).filter((b) => !!b);
  const at = kids[t.index ?? kids.length];
  if (at) return at;
  const last = kids.at(-1);
  if (!last) return pb;
  return layout === "row" ? { x: last.x + last.w, y: last.y } : { x: last.x, y: last.y + last.h };
}
