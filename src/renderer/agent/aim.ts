// Where the agent's cursor goes on the element a script is working on, the way a designer's hand
// would: just after the first word of a text (as if typing it), and for a box it has just made,
// from its top-left corner to its bottom-right (as if drawing it).
import type { Focus } from "../../agent/execute.js";
import { DEFAULTS, ROOT_ID } from "../../doc/schema.js";
import { parentOf, propsOf, typeOf } from "../../doc/store.js";
import { currentScene, doc } from "../scene.js";

/** Rough width of a character, as a share of the font size (enough to find the end of a word). */
const CHAR_WIDTH = 0.55;
/** How far into an element the cursor rests when the agent changes it. */
const INSET = 24;

type Point = { x: number; y: number };

/** The path, kept inside the top-level frame the element is in (what sticks out of it is hidden). */
export function aimPath(f: Focus): Point[] {
  let top = f.id;
  for (let p = parentOf(doc, top); p && p !== ROOT_ID; p = parentOf(doc, p)) top = p;
  const frame = currentScene()?.boxes.get(top);
  const path = aim(f);
  if (!frame) return path;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return path.map((p) => ({ x: clamp(p.x, frame.x, frame.x + frame.w), y: clamp(p.y, frame.y, frame.y + frame.h) }));
}

function aim(f: Focus): Point[] {
  const type = typeOf(doc, f.id);
  if (type === "text") {
    const p = propsOf(doc, f.id);
    const size = typeof p.fontSize === "number" ? p.fontSize : 14;
    const lineHeight = typeof p.lineHeight === "number" ? p.lineHeight : 1.2;
    const word = String(p.content ?? "").trim().split(/\s+/)[0] ?? "";
    const wordWidth = word.length * size * CHAR_WIDTH;
    return [{ x: f.x + Math.min(f.w, wordWidth + size * 0.15), y: f.y + (size * lineHeight) / 2 }];
  }
  if (f.created && f.w > 4 && f.h > 4) return [{ x: f.x, y: f.y }, { x: f.x + f.w, y: f.y + f.h }];
  return [{ x: f.x + Math.min(f.w / 2, INSET), y: f.y + Math.min(f.h / 2, INSET) }];
}
