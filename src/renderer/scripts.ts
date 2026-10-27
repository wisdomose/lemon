// What this file's script nodes show (main/scripts.ts runs them): the nodes a script returned, grafted
// under its node in the scene so they are laid out and drawn as its children, or why it didn't run.
import type { NodeProps, NodeType, TreeNode } from "../doc/schema.js";
import type { ScriptOutput } from "../main/scripts.js";
import { bridge } from "./bridge.js";

const outputs = new Map<string, ScriptOutput>();
const listeners = new Set<() => void>();

// Listening from the start: the host sends the outputs as soon as the page has loaded.
bridge.scripts.onOutput((id, out) => {
  if (out) outputs.set(id, out);
  else outputs.delete(id);
  listeners.forEach((fn) => fn());
});

/** Calls `fn` whenever a script's output changes. */
export function onScriptOutput(fn: () => void): void {
  listeners.add(fn);
}

export const scriptOutput = (id: string): ScriptOutput | undefined => outputs.get(id);

/** A returned node as a scene node, with an id of its own under its script ("<script>~<path>"). */
function made(spec: Record<string, unknown>, script: string, path: string): TreeNode {
  const { type, id: _id, children, ...props } = spec;
  return {
    id: `${script}~${path}`,
    type: type as NodeType,
    props: props as NodeProps,
    children: Array.isArray(children) ? (children as Record<string, unknown>[]).map((c, i) => made(c, script, `${path}.${i}`)) : [],
    script,
  };
}

/** Puts each script node's output in the tree as its children (the tree is a fresh copy each time). */
export function graftScripts(n: TreeNode): void {
  for (const c of n.children) {
    if (c.type === "script") {
      const out = outputs.get(c.id);
      c.children = out?.ok ? out.nodes.map((spec, i) => made(spec, c.id, String(i))) : [];
    } else graftScripts(c);
  }
}
