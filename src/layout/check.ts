// The automatic layout check: problems a person would see, found by measuring instead of looking.
import { ROOT_ID, type Fills, type TreeNode, type Vars } from "../doc/schema.js";
import { colorOf, contrast, isVarRef, over, resolveOr, withTheme, type RGBA } from "../doc/values.js";
import type { TextEngine } from "../text/paragraph.js";
import { faceOf, isEnabled, textColor, weightOf } from "../text/paragraph.js";
import { isOff, num, type Box, type Boxes } from "./layout.js";

export type IssueKind =
  | "clipped"
  | "overflow"
  | "collapsed"
  | "text-cut"
  | "contrast"
  | "hard-coded-colour"
  | "unknown-font"
  | "invisible-text";

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

/** The colour a node's fills come to, roughly (gradients as the average of their colours); undefined for none. */
function solidFill(node: TreeNode, vars: Vars): RGBA | undefined {
  const fills = Array.isArray(node.props.fill) ? node.props.fill : node.props.fill === undefined ? [] : [node.props.fill];
  let out: RGBA | undefined;
  for (const f of fills) {
    if (!isEnabled(f, vars)) continue;
    let c: RGBA | undefined;
    try {
      if (typeof f === "string") c = colorOf(f, vars);
      else if (f.type === "color") c = colorOf(f.color, vars);
      else if (f.type === "gradient" && f.colors?.length) {
        const cs = f.colors.map((s) => colorOf(s.color, vars));
        c = cs.reduce((a, x) => [a[0] + x[0] / cs.length, a[1] + x[1] / cs.length, a[2] + x[2] / cs.length, a[3] + x[3] / cs.length], [0, 0, 0, 0] as RGBA);
      } else if (f.type === "image") c = [0.5, 0.5, 0.5, 1];
    } catch {
      continue;
    }
    if (c) out = out && c[3] < 1 ? over(c, out) : c;
  }
  return out;
}

/** The colours given as literals (not variables) in a fill or fill list. */
function literalColours(fills: Fills | undefined): string[] {
  const list = Array.isArray(fills) ? fills : fills === undefined ? [] : [fills];
  return list.flatMap((f) => (typeof f === "string" && !isVarRef(f) ? [f] : f && typeof f === "object" && f.type === "color" && !isVarRef(f.color) ? [f.color] : []));
}

/** Checks the subtree at `start` (default: the whole page). `root` must be the page tree. */
export function check(root: TreeNode, boxes: Boxes, vars: Vars, text: TextEngine, start?: string): Issue[] {
  const issues: Issue[] = [];
  const hasVars = Object.keys(vars).length > 0;
  const add = (n: TreeNode, kind: IssueKind, message: string) =>
    issues.push({ id: n.id, ...(n.props.name ? { name: n.props.name } : {}), kind, message });

  // Walk with the chain of ancestors so clipping and backgrounds can be found.
  const walk = (n: TreeNode, ancestors: TreeNode[], active: boolean, outerVars: Vars) => {
    const vars = withTheme(outerVars, n.props.theme);
    const on = active || n.id === start || start === undefined;
    const box = boxes.get(n.id);
    if (isOff(n.props, vars)) return;
    if (on && box && n.id !== ROOT_ID) {
      const parent = ancestors[ancestors.length - 1];
      const pbox = parent ? boxes.get(parent.id) : undefined;

      const line = (n.type === "path" || n.type === "line") && (box.w < 1 || box.h < 1);
      if ((box.w < 1 || box.h < 1) && !line && ((n.type !== "frame" && n.type !== "group") || n.children.length > 0)) {
        add(n, "collapsed", `is ${Math.round(box.w)}×${Math.round(box.h)}px, so it can't be seen.`);
      }

      // Clipped by any clipping ancestor; otherwise sticking out of its parent.
      const clipper = [...ancestors].reverse().find((a) => resolveOr(a.props.clip, vars, false) === true && boxes.has(a.id));
      if (clipper) {
        const o = outside(box, boxes.get(clipper.id)!);
        const cb = boxes.get(clipper.id)!;
        const fully = box.x >= cb.x + cb.w || box.y >= cb.y + cb.h || box.x + box.w <= cb.x || box.y + box.h <= cb.y;
        if (fully) add(n, "clipped", `is fully hidden by "${clipper.props.name ?? clipper.id}", which clips its content.`);
        else if (describe(o)) add(n, "clipped", `is partly cut off by "${clipper.props.name ?? clipper.id}": ${describe(o)}.`);
      } else if (parent && pbox && parent.id !== ROOT_ID && n.props.layoutPosition !== "absolute" && parent.type !== "group" && describe(outside(box, pbox))) {
        add(n, "overflow", `sticks out of "${parent.props.name ?? parent.id}": ${describe(outside(box, pbox))}.`);
      }

      if (n.type === "text") {
        const face = faceOf(n.props, vars);
        if (!text.fonts.known(face.family)) add(n, "unknown-font", `uses "${face.family}", which isn't available; it falls back to another font.`);
        try {
          const para = text.paragraph(n.props, vars);
          para.layout((n.props.textGrowth ?? "auto") === "auto" ? 1e7 : Math.max(1, box.w));
          const needH = para.getHeight();
          if (needH > box.h + EPS) add(n, "text-cut", `needs ${Math.ceil(needH)}px of height but has ${Math.round(box.h)}px; text is cut off.`);
          para.layout(1e7);
          const longestWord = Math.max(
            0,
            ...String(n.props.content ?? "")
              .split(/\s+/)
              .map((w) => w.length),
          );
          if (longestWord > 0 && para.getMinIntrinsicWidth() > box.w + EPS) {
            add(n, "text-cut", `is ${Math.round(box.w)}px wide, narrower than its longest word (${Math.ceil(para.getMinIntrinsicWidth())}px), so words break or spill.`);
          }
          // Contrast against the nearest filled ancestor that sits behind it.
          const fg = textColor(n.props.fill, vars);
          let bg = WHITE;
          for (const a of [...ancestors].reverse()) {
            const f = solidFill(a, vars);
            if (f && f[3] > 0.05) {
              bg = f[3] >= 1 ? f : over(f, WHITE);
              break;
            }
          }
          const ratio = contrast(over(fg, bg), bg);
          const size = num(n.props.fontSize, vars, 14);
          const large = size >= 24 || (size >= 18.5 && weightOf(resolveOr(n.props.fontWeight, vars, "normal")) >= 700);
          const need = large ? 3 : 4.5;
          if (fg[3] === 0) add(n, "invisible-text", "has no fill, so it can't be seen; give it a `fill`.");
          else if (ratio < need) add(n, "contrast", `text contrast is ${ratio.toFixed(1)}:1 against its background; needs at least ${need}:1.`);
        } catch {
          /* unresolvable values are reported elsewhere */
        }
      }

      if (hasVars) {
        const literal = [...literalColours(n.props.fill).map((c) => `fill ${c}`), ...literalColours(n.props.stroke).map((c) => `stroke ${c}`)];
        if (literal.length) add(n, "hard-coded-colour", `uses ${literal.join(", ")} instead of a variable.`);
      }
    }
    for (const c of n.children) walk(c, n.id === ROOT_ID ? [] : [...ancestors, n], on, vars);
  };
  walk(root, [], false, vars);
  return issues;
}
