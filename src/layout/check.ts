// The automatic layout check: problems a person would see, found by measuring instead of looking.
import type { TreeNode, Vars } from "../doc/schema.js";
import { colorOf, contrast, isVarRef, over, type RGBA } from "../doc/values.js";
import type { TextEngine } from "../text/paragraph.js";
import { faceOf } from "../text/paragraph.js";
import type { Box, Boxes } from "./layout.js";

export type IssueKind =
  | "clipped"
  | "overflow"
  | "collapsed"
  | "text-cut"
  | "contrast"
  | "hard-coded-colour"
  | "unknown-font";

export interface Issue {
  id: string;
  name?: string;
  kind: IssueKind;
  message: string;
}

const EPS = 0.5;
const WHITE: RGBA = [1, 1, 1, 1];

function outside(child: Box, parent: Box): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.max(0, parent.x - child.x),
    top: Math.max(0, parent.y - child.y),
    right: Math.max(0, child.x + child.w - (parent.x + parent.w)),
    bottom: Math.max(0, child.y + child.h - (parent.y + parent.h)),
  };
}

function describe(o: ReturnType<typeof outside>): string {
  const parts = Object.entries(o)
    .filter(([, v]) => v > EPS)
    .map(([side, v]) => `${Math.round(v)}px past the ${side}`);
  return parts.join(", ");
}

function solidFill(node: TreeNode, vars: Vars): RGBA | undefined {
  const f = node.props.fill;
  if (f === undefined) return undefined;
  try {
    if (typeof f === "string") return colorOf(f, vars);
    if (f.type === "linear" && f.stops.length) {
      const cs = f.stops.map((s) => colorOf(s.color, vars));
      return cs.reduce((a, c) => [a[0] + c[0] / cs.length, a[1] + c[1] / cs.length, a[2] + c[2] / cs.length, a[3] + c[3] / cs.length], [0, 0, 0, 0] as RGBA);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Checks the subtree at `start` (default: the whole page). `root` must be the page tree. */
export function check(root: TreeNode, boxes: Boxes, vars: Vars, text: TextEngine, start?: string): Issue[] {
  const issues: Issue[] = [];
  const hasVars = Object.keys(vars).length > 0;
  const add = (n: TreeNode, kind: IssueKind, message: string) =>
    issues.push({ id: n.id, ...(n.props.name ? { name: n.props.name } : {}), kind, message });

  // Walk with the chain of ancestors so clipping and backgrounds can be found.
  const walk = (n: TreeNode, ancestors: TreeNode[], active: boolean) => {
    const on = active || n.id === start || start === undefined;
    const box = boxes.get(n.id);
    if (on && box && n.props.visible !== false && n.id !== "root") {
      const parent = ancestors[ancestors.length - 1];
      const pbox = parent ? boxes.get(parent.id) : undefined;

      if ((box.w < 1 || box.h < 1) && (n.type !== "frame" || n.children.length > 0)) {
        add(n, "collapsed", `is ${Math.round(box.w)}×${Math.round(box.h)}px, so it can't be seen.`);
      }

      // Clipped by any clipping ancestor; otherwise sticking out of its parent.
      const clipper = [...ancestors].reverse().find((a) => a.props.clip && boxes.has(a.id));
      if (clipper) {
        const o = outside(box, boxes.get(clipper.id)!);
        const cb = boxes.get(clipper.id)!;
        const fully = box.x >= cb.x + cb.w || box.y >= cb.y + cb.h || box.x + box.w <= cb.x || box.y + box.h <= cb.y;
        if (fully) add(n, "clipped", `is fully hidden by "${clipper.props.name ?? clipper.id}", which clips its content.`);
        else if (describe(o)) add(n, "clipped", `is partly cut off by "${clipper.props.name ?? clipper.id}": ${describe(o)}.`);
      } else if (parent && pbox && parent.id !== "root" && !n.props.absolute && describe(outside(box, pbox))) {
        add(n, "overflow", `sticks out of "${parent.props.name ?? parent.id}": ${describe(outside(box, pbox))}.`);
      }

      if (n.type === "text") {
        const face = faceOf(n.props, vars);
        if (!text.fonts.known(face.family)) add(n, "unknown-font", `uses "${face.family}", which isn't available; it falls back to another font.`);
        try {
          const para = text.paragraph(n.props, vars);
          para.layout(Math.max(1, box.w));
          const needH = para.getHeight();
          if (needH > box.h + EPS) add(n, "text-cut", `needs ${Math.ceil(needH)}px of height but has ${Math.round(box.h)}px; text is cut off.`);
          para.layout(1e7);
          const longestWord = Math.max(
            0,
            ...String(n.props.text ?? "")
              .split(/\s+/)
              .map((w) => w.length),
          );
          if (longestWord > 0 && para.getMinIntrinsicWidth() > box.w + EPS) {
            add(n, "text-cut", `is ${Math.round(box.w)}px wide, narrower than its longest word (${Math.ceil(para.getMinIntrinsicWidth())}px), so words break or spill.`);
          }
          // Contrast against the nearest filled ancestor that sits behind it.
          const fg = colorOf(n.props.color ?? "#000000", vars);
          let bg = WHITE;
          for (const a of [...ancestors].reverse()) {
            const f = solidFill(a, vars);
            if (f && f[3] > 0.05) {
              bg = f[3] >= 1 ? f : over(f, WHITE);
              break;
            }
          }
          const ratio = contrast(over(fg, bg), bg);
          const size = Number(n.props.size ?? 16);
          const large = size >= 24 || (size >= 18.5 && Number(n.props.weight ?? 400) >= 700);
          const need = large ? 3 : 4.5;
          if (ratio < need) add(n, "contrast", `text contrast is ${ratio.toFixed(1)}:1 against its background; needs at least ${need}:1.`);
        } catch {
          /* unresolvable values are reported elsewhere */
        }
      }

      if (hasVars) {
        const literal: string[] = [];
        for (const key of ["fill", "color"] as const) {
          const v = n.props[key];
          if (typeof v === "string" && !isVarRef(v)) literal.push(`${key} ${v}`);
        }
        if (n.props.stroke && !isVarRef(n.props.stroke.color)) literal.push(`stroke ${n.props.stroke.color}`);
        if (literal.length) add(n, "hard-coded-colour", `uses ${literal.join(", ")} instead of a variable.`);
      }
    }
    for (const c of n.children) walk(c, n.id === "root" ? [] : [...ancestors, n], on);
  };
  walk(root, [], false);
  return issues;
}
