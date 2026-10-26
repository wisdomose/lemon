// Several agents on one request (PRD: "up to 6 run in parallel (Split Work or Side by Side)"). Pen's
// behaviour was never captured (locked on its Free plan); this is ours, decided 26 Oct 2026:
//
// - Split Work: the agents plan together first. Each proposes a plan from its own starting points
//   (the look, and the split into one part per agent); then the team agrees one plan. The shared
//   look becomes the document's variables, the parts get their frames, and every agent builds its
//   own part at the same time.
// - Side by Side: each agent makes its own complete version in its own frames, from different starting
//   points; the frames end up in a row in agent order.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodex } from "./codex.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type * as Y from "yjs";
import { PRODUCT } from "../product.js";
import { AgentChange } from "../doc/live.js";
import { getVars, insert, nodesOf, setVars, toTree, update } from "../doc/store.js";
import { ROOT_ID } from "../doc/schema.js";
import { facesUsed, layout } from "../layout/layout.js";
import { GAP_BETWEEN_FRAMES, emptySpot } from "../layout/space.js";
import { runAgent, type AgentEvent, type AgentOptions, type AgentStats } from "./agent.js";
import { pickStartingPoints, type Direction } from "./directions.js";
import { PLANNING_CONTEXT } from "./instructions.js";
import { AGENTS, DEFAULT_MODEL, modelProvider, type Team } from "./models.js";
import type { Engine } from "../engine.js";

/** The plan a team agrees before building (Split Work). */
export interface TeamPlan {
  /** The look in a sentence or two, for the person. */
  summary: string;
  /** Colours, fonts and radii, set as the document's variables. */
  vars: Record<string, string | number>;
  /** One page made of sections, or separate screens. */
  layout: "page" | "screens";
  name: string;
  width: number;
  /** Screens only. */
  height?: number;
  /** One per agent, in reading order. */
  parts: { name: string; brief: string }[];
}

export type TeamEvent =
  | { type: "team-started"; mode: Team["mode"]; count: number; prompt: string; model: string }
  /** One agent's proposal while the team plans (Split Work). */
  | { type: "team-proposal"; agent: number; text: string }
  /** The plan the team agreed, and which agent builds which part. */
  | { type: "team-plan"; text: string; parts: { agent: number; name: string }[] }
  | { type: "team-done"; durationMs: number; costUsd: number; ok: boolean };

/** An event from a team run: the team's own, or one of its agents' (tagged with the agent). */
export type TaggedEvent = (AgentEvent & { agent?: number }) | TeamEvent;

export interface TeamOptions extends Omit<AgentOptions, "name" | "onEvent" | "directions" | "brief" | "globals" | "leaveMarked"> {
  team: Team;
  onEvent?: (e: TaggedEvent) => void;
}

/** What one planning call costs and says. */
interface Said {
  text: string;
  costUsd: number;
}

/** A question to the model with no tools: one answer, no canvas. */
async function ask(system: string, prompt: string, model: string, signal?: AbortSignal, effort?: string): Promise<Said> {
  // Planning follows the selected provider, including split-work proposals and agreement.
  if (modelProvider(model) === "codex") {
    const result = await runCodex({ system, prompt, model, signal, effort });
    return { text: result.reply, costUsd: 0 };
  }
  const abort = new AbortController();
  signal?.addEventListener("abort", () => abort.abort(), { once: true });
  const cwd = join(tmpdir(), `${PRODUCT.slug}-agent`);
  mkdirSync(cwd, { recursive: true });
  let text = "";
  let costUsd = 0;
  for await (const m of query({
    prompt,
    options: {
      model,
      systemPrompt: system,
      tools: [],
      strictMcpConfig: true,
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      maxTurns: 1,
      cwd,
      abortController: abort,
    },
  })) {
    if (m.type === "result") {
      if (m.subtype === "success") text = m.result;
      costUsd = m.total_cost_usd;
    }
  }
  return { text, costUsd };
}

const PLAN_SHAPE = `Reply with one JSON object and nothing else:
{
  "summary": "the look in one or two plain sentences, for the person (no jargon)",
  "vars": { "bg": "#…", "surface": "#…", "ink": "#…", "muted": "#…", "accent": "#…", "display": "<Google Fonts family>", "body": "<Google Fonts family>", "radius": 12 },
  "layout": "page" or "screens",
  "name": "what the design is, e.g. \\"Alfama Coffee — landing page\\"",
  "width": 1440 for a website, 390 for a phone screen,
  "height": for screens only, e.g. 844,
  "parts": [ { "name": "Hero", "brief": "what this part holds: its content, specifics, how it should feel" } ]
}
"vars" may add or rename variables; keep colours and fonts in them. "parts" has exactly COUNT entries in
reading order (sections of the page, or one screen each), balanced so each is a similar amount of work.`;

/** The first JSON object in a reply, checked against the plan's shape. */
export function readPlan(text: string, count: number): TeamPlan {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The plan wasn't JSON.");
  const p = JSON.parse(text.slice(start, end + 1)) as Partial<TeamPlan>;
  if (!Array.isArray(p.parts) || !p.parts.length) throw new Error("The plan has no parts.");
  const parts = p.parts
    .filter((x) => x && typeof x.name === "string" && typeof x.brief === "string")
    .slice(0, count)
    .map((x) => ({ name: x.name.trim(), brief: x.brief.trim() }));
  const vars: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p.vars ?? {})) if ((typeof v === "string" || typeof v === "number") && /^[A-Za-z][\w-]*$/.test(k)) vars[k] = v;
  const width = typeof p.width === "number" && p.width > 0 ? p.width : 1440;
  return {
    summary: typeof p.summary === "string" ? p.summary : "",
    vars,
    layout: p.layout === "screens" ? "screens" : "page",
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Design",
    width,
    ...(typeof p.height === "number" && p.height > 0 ? { height: p.height } : {}),
    parts,
  };
}

/** Different starting points for each agent, so their proposals (or versions) differ. */
function startingPointsFor(count: number, recent: string[] = []): Direction[][] {
  const taken = [...recent];
  return Array.from({ length: count }, () => {
    const picked = pickStartingPoints(taken);
    taken.push(...picked.map((d) => d.id));
    return picked;
  });
}

const describe = (ds: Direction[]) => ds.map((d) => `${d.name} (${d.id})`).join("; ");

/** Lays out the page (fonts loaded first): the boxes of everything on it. */
async function measure(engine: Engine, doc: Y.Doc) {
  const tree = toTree(doc);
  const vars = getVars(doc);
  await engine.fonts.ensure(facesUsed(tree, vars));
  return { tree, boxes: layout(tree, vars, engine.text) };
}

export async function runTeam(o: TeamOptions): Promise<AgentStats[]> {
  const count = Math.max(1, Math.min(AGENTS.length, Math.round(o.team.count)));
  const model = o.model ?? DEFAULT_MODEL;
  const emit = o.onEvent ?? (() => {});
  const started = performance.now();
  let planningCost = 0;
  emit({ type: "team-started", mode: o.team.mode, count, prompt: o.prompt, model });
  const points = startingPointsFor(count, o.recentDirections);
  const origin = new AgentChange("Team", 0);
  const finish = (stats: AgentStats[], ok: boolean) => {
    emit({ type: "team-done", durationMs: performance.now() - started, costUsd: planningCost + stats.reduce((n, s) => n + s.costUsd, 0), ok });
    return stats;
  };

  const agent = (i: number, extra: Pick<AgentOptions, "brief" | "directions" | "globals" | "leaveMarked">) => {
    const { team: _team, onEvent: _onEvent, ...base } = o;
    void _team;
    void _onEvent;
    return runAgent({ ...base, ...extra, model, name: AGENTS[i]!.name, onEvent: (e) => emit({ ...e, agent: i }) });
  };

  if (o.team.mode === "side") {
    const before = new Set(toTree(o.doc).children.map((c) => c.id));
    const stats = await Promise.all(
      points.map((directions, i) =>
        agent(i, {
          directions,
          brief: `You are ${AGENTS[i]!.name}, one of ${count} agents each making their own complete version of this request at the same time; the person will compare the versions side by side. Your version is top-level frames: one for a single page, or one per screen when it has several (an app's screens are each their own top-level frame, never screens wrapped inside one bigger frame). Name every one "<what it is> — ${AGENTS[i]!.name}" (e.g. "Home — ${AGENTS[i]!.name}"), and don't touch the others' frames. Your starting points differ from theirs: commit to yours so the versions are clearly different. Don't set variables other agents could be using: name yours with the prefix "${AGENTS[i]!.name.toLowerCase()}-" (e.g. "$${AGENTS[i]!.name.toLowerCase()}-ink").`,
        }),
      ),
    );
    await lineUp(o.doc, o.engine, before, origin);
    return finish(stats, stats.some((s) => s.ok));
  }

  // ---- Split Work: plan together, agree, then build the parts at the same time.
  const request = `The person asked for:\n${o.prompt.trim()}\n\nThe canvas: ${toTree(o.doc).children.length ? "already has other frames; your design goes beside them." : "empty."}`;
  const shape = PLAN_SHAPE.replace("COUNT", String(count));
  let plan: TeamPlan;
  try {
    const proposals = await Promise.all(
      points.map(async (directions, i) => {
        const said = await ask(
          PLANNING_CONTEXT,
          `${request}\n\nYou are ${AGENTS[i]!.name}, one of ${count} designer agents who will build this together, each building one part at the same time. First the team agrees one plan. Propose yours, starting from: ${describe(directions)}.\n\n${shape}`,
          model,
          o.signal,
          o.effort,
        );
        planningCost += said.costUsd;
        const p = readPlan(said.text, count);
        emit({ type: "team-proposal", agent: i, text: `${p.summary}\nParts: ${p.parts.map((x) => x.name).join(", ")}.` });
        return { agent: AGENTS[i]!.name, plan: p };
      }),
    );
    const agreed = await ask(
      PLANNING_CONTEXT,
      `${request}\n\nThe ${count} agents who will build it proposed these plans:\n\n${proposals.map((p) => `${p.agent}: ${JSON.stringify(p.plan)}`).join("\n\n")}\n\nAs the team, agree one plan: take the strongest look (or combine the best of them, if it stays coherent) and split the work into exactly ${count} parts, one per agent in this order: ${AGENTS.slice(0, count).map((a) => a.name).join(", ")}.\n\n${shape}`,
      model,
      o.signal,
      o.effort,
    );
    planningCost += agreed.costUsd;
    plan = readPlan(agreed.text, count);
  } catch (e) {
    if (!o.signal?.aborted) emit({ type: "error", message: `The team couldn't agree a plan: ${e instanceof Error ? e.message : String(e)}` });
    return finish([], false);
  }
  if (o.signal?.aborted) return finish([], false);
  emit({
    type: "team-plan",
    text: plan.summary,
    parts: plan.parts.map((p, i) => ({ agent: i, name: p.name })),
  });

  // The agreed look and the parts' frames go on the canvas before anyone builds.
  const { tree, boxes } = await measure(o.engine, o.doc);
  const spot = emptySpot(tree, boxes);
  const frames: string[] = [];
  let page: string | undefined;
  const bg = "bg" in plan.vars ? "$bg" : undefined;
  o.doc.transact(() => {
    setVars(o.doc, plan.vars);
    if (plan.layout === "page") {
      page = insert(o.doc, ROOT_ID, { type: "frame", name: plan.name, ...spot, width: plan.width, height: "fit", layout: "column", generating: true, ...(bg ? { fill: bg } : {}) });
      for (const part of plan.parts) frames.push(insert(o.doc, page, { type: "frame", name: part.name, width: "fill", height: "fit", layout: "column" }));
    } else {
      plan.parts.forEach((part, i) =>
        frames.push(
          insert(o.doc, ROOT_ID, {
            type: "frame",
            name: part.name,
            x: spot.x + i * (plan.width + GAP_BETWEEN_FRAMES),
            y: spot.y,
            width: plan.width,
            height: plan.height ?? "fit",
            layout: "column",
            generating: true,
            ...(bg ? { fill: bg } : {}),
          }),
        ),
      );
    }
  }, origin);

  const planText = [
    plan.summary,
    `Variables (already set): ${Object.entries(plan.vars).map(([k, v]) => `$${k} = ${v}`).join(", ")}.`,
    `Parts: ${plan.parts.map((p, i) => `${AGENTS[i]!.name} — "${p.name}": ${p.brief}`).join(" | ")}`,
  ].join("\n");
  const stats = await Promise.all(
    plan.parts.map((part, i) =>
      agent(i, {
        directions: null,
        globals: { mine: frames[i]! },
        ...(page ? { leaveMarked: [page] } : {}),
        brief: [
          `You are ${AGENTS[i]!.name}, one of ${plan.parts.length} agents building this design together, each one part at the same time. The team agreed this plan:`,
          planText,
          `Your part: "${part.name}" — ${part.brief}`,
          page
            ? `It has its own frame (id ${frames[i]}, kept for you as \`mine\`) inside the page "${plan.name}" (id ${page}), in its place among the other parts. Build only inside it: add to it and set its own properties (padding, fill, gap, layout), but don't create top-level frames and don't change anything outside it — the others are working there. Don't set \`generating\`; the page is marked while the team works.`
            : `It is its own screen (id ${frames[i]}, kept for you as \`mine\`). Build only inside it, and don't change the other screens. It is marked \`generating\`; clear that when your screen is done.`,
          `The variables are already set: use them for every colour and font so the parts match, and don't change them (add your own only if you must, prefixed "${AGENTS[i]!.name.toLowerCase()}-").`,
          `When done, reply in one or two sentences about your part only.`,
        ].join("\n"),
      }),
    ),
  );
  if (page && nodesOf(o.doc).has(page)) o.doc.transact(() => update(o.doc, page!, { generating: null } as never), origin);
  return finish(stats, stats.some((s) => s.ok));
}

/**
 * Side by Side: every version's frames in one row, in agent order, each agent's screens in the order it
 * placed them, with a double gap between versions (each agent placed its own frames as it began).
 */
async function lineUp(doc: Y.Doc, engine: Engine, before: Set<string>, origin: AgentChange): Promise<void> {
  const { tree, boxes } = await measure(engine, doc);
  const made = tree.children.filter((c) => !before.has(c.id) && boxes.has(c.id));
  if (made.length < 2) return;
  // An agent's frames carry its name ("Home — Zest"); agent order, then left to right as it placed them.
  const rank = (name: string | undefined) => {
    const i = AGENTS.findIndex((a) => name?.endsWith(a.name));
    return i < 0 ? AGENTS.length : i;
  };
  const ordered = [...made].sort((a, b) => rank(a.props.name) - rank(b.props.name) || boxes.get(a.id)!.x - boxes.get(b.id)!.x || boxes.get(a.id)!.y - boxes.get(b.id)!.y);
  let x = Math.min(...made.map((c) => boxes.get(c.id)!.x));
  const y = Math.min(...made.map((c) => boxes.get(c.id)!.y));
  doc.transact(() => {
    ordered.forEach((f, n) => {
      if (n > 0 && rank(f.props.name) !== rank(ordered[n - 1]!.props.name)) x += GAP_BETWEEN_FRAMES;
      update(doc, f.id, { x, y });
      x += boxes.get(f.id)!.w + GAP_BETWEEN_FRAMES;
    });
  }, origin);
}
