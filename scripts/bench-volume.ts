// Measures how Lemon holds up under volume: a board of thousands of pictures.
//
//   npx tsx scripts/bench-volume.ts [--pictures 1000] [--size 4000x3000] [--layout page|frame] [--app] [--keep]
//
// It writes the board to a temporary folder (a .pen file and its pictures beside it, as Pen keeps
// them) and times the editor's own functions on it: opening, the first layout, what one moved picture
// costs, saving, and painting one tile. With --app it then opens the board in a build of the app
// (`pnpm build` first) and reports, from the window itself over the DevTools protocol: how long until
// the first view is whole, frame times while the view pans at three zooms, the pictures' texture
// memory, and the app's processes' memory (Windows).
//
// The pictures are few distinct PNGs copied under many names: every one is fetched, decoded and held
// on its own (they are told apart by name), so decode time and memory are as for real photos, but the
// folder stays small (flat colours compress well). So this does not measure reading 10 GB from disk.
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as Y from "yjs";
import { createEngine } from "../src/engine.js";
import { GoogleFonts } from "../src/text/google-fonts.js";
import { fileText, picturesOf, readFile } from "../src/doc/file.js";
import { picturesBeside } from "../src/doc/picture-files.js";
import { IncrementalTree, changedRecords } from "../src/doc/incremental.js";
import { getVars, update } from "../src/doc/store.js";
import { layout, type LayoutReuse } from "../src/layout/layout.js";
import { damage, sceneBounds, type BoundsCache } from "../src/render/damage.js";
import { drawNode } from "../src/render/draw.js";

const { values } = parseArgs({
  options: { pictures: { type: "string", default: "1000" }, size: { type: "string", default: "4000x3000" }, layout: { type: "string", default: "page" }, app: { type: "boolean", default: false }, keep: { type: "boolean", default: false }, seconds: { type: "string", default: "4" } },
});
const N = Number(values.pictures);
const [W, H] = values.size!.split("x").map(Number) as [number, number];
const here = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "lemon-volume-"));
const ms = (t: number) => +(performance.now() - t).toFixed(1);
const time = <T>(fn: () => T): [T, number] => {
  const t = performance.now();
  const v = fn();
  return [v, ms(t)];
};
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;

const engine = await createEngine(await GoogleFonts.open(join(here, ".cache", "fonts")));
const { ck } = engine;

// ---- The board ---------------------------------------------------------------------------------------
const DISTINCT = 8;
mkdirSync(join(work, "images"));
const [, makeMs] = time(() => {
  for (let k = 0; k < DISTINCT; k++) {
    const surface = ck.MakeSurface(W, H)!;
    const c = surface.getCanvas();
    const paint = new ck.Paint();
    c.clear(ck.Color4f((k * 0.37) % 1, (k * 0.61) % 1, (k * 0.83) % 1, 1));
    for (let i = 0; i < 40; i++) {
      paint.setColor(ck.Color4f((i * 0.13 + k * 0.2) % 1, (i * 0.29) % 1, (i * 0.47 + k * 0.1) % 1, 1));
      c.drawRect(ck.XYWHRect(((i * 7919) % W) * 0.9, ((i * 104729) % H) * 0.9, W / 6, H / 6), paint);
    }
    paint.delete();
    const snap = surface.makeImageSnapshot();
    writeFileSync(join(work, "images", `source-${k}.png`), snap.encodeToBytes()!);
    snap.delete();
    surface.delete();
  }
  for (let i = 0; i < N; i++) copyFileSync(join(work, "images", `source-${i % DISTINCT}.png`), join(work, "images", `photo-${i}.png`));
});
const COLS = Math.ceil(Math.sqrt(N * 1.5));
const at = (i: number) => ({ x: (i % COLS) * 320, y: Math.floor(i / COLS) * 220 });
const pic = (i: number) => ({ type: "rectangle", id: `p${i}`, name: `Photo ${i}`, ...at(i), width: 300, height: 200, fill: { type: "image", url: `./images/photo-${i}.png`, mode: "cover" } });
const pics = Array.from({ length: N }, (_, i) => pic(i));
const board = { w: COLS * 320, h: Math.ceil(N / COLS) * 220 };
const pen = {
  version: "2.21",
  children: values.layout === "frame" ? [{ type: "frame", id: "board", name: "Board", x: 0, y: 0, width: board.w, height: board.h, layout: "none", children: pics }] : pics,
};
const file = join(work, "board.pen");
const text = JSON.stringify(pen, null, 2);
writeFileSync(file, text);
const folderMB = +(readdirSync(join(work, "images")).reduce((n, f) => n + statSync(join(work, "images", f)).size, 0) / 2 ** 20).toFixed(1);

// ---- The editor's own functions ------------------------------------------------------------------------
const doc = new Y.Doc();
const reader = picturesBeside(() => file);
const [report, readMs] = time(() => readFile(text, doc, reader));
const tree = new IncrementalTree(doc);
doc.on("afterTransaction", (tr: Y.Transaction) => tree.mark(changedRecords(doc, tr)));
const reuse: LayoutReuse = new WeakMap();
const cache: BoundsCache = new WeakMap();
const scene = () => {
  const t = tree.build();
  const vars = getVars(doc);
  return { tree: t, vars, boxes: layout(t, vars, engine.text, reuse) };
};
let [s, sceneMs] = time(scene);
let [b, boundsMs] = time(() => sceneBounds(s, cache, engine.text));
const steps = { tree: [] as number[], layout: [] as number[], bounds: [] as number[], damage: [] as number[] };
for (let k = 0; k < 10; k++) {
  doc.transact(() => update(doc, `p${N >> 1}`, { x: at(N >> 1).x + 5 + k }));
  const [t, a] = time(() => tree.build());
  const vars = getVars(doc);
  const [boxes, l] = time(() => layout(t, vars, engine.text, reuse));
  const s2 = { tree: t, vars, boxes };
  const [b2, c] = time(() => sceneBounds(s2, cache, engine.text));
  const [, d] = time(() => damage(s, b, s2, b2));
  steps.tree.push(a), steps.layout.push(l), steps.bounds.push(c), steps.damage.push(d);
  [s, b] = [s2, b2];
}
const moved = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, median(v)])) as Record<string, number>;
moved.total = +Object.values(moved).reduce((x, y) => x + y, 0).toFixed(1);

// One tile, as the canvas paints it: the page drawn straight in, only what reaches the tile. Pictures
// are still on their way here (the window's store fetches them), so this is the walk and the culling.
const surface = ck.MakeSurface(128, 128)!;
const mid = { x: board.w / 2, y: board.h / 2, w: 128, h: 128 };
const tile = () => {
  const c = surface.getCanvas();
  c.save();
  c.clear(ck.WHITE);
  c.translate(-mid.x, -mid.y);
  for (const top of s.tree.children) {
    const reach = b.reach.get(top.id);
    if (!reach || reach.x >= mid.x + mid.w || mid.x >= reach.x + reach.w || reach.y >= mid.y + mid.h || mid.y >= reach.y + reach.h) continue;
    drawNode({ ck, text: engine.text, vars: s.vars, boxes: s.boxes, assets: () => undefined, pictures: () => "loading", scale: 1, lod: true, cull: { rect: mid, reach: (id) => b.reach.get(id) } }, c, top);
  }
  c.restore();
  surface.flush();
};
const tileMs = median(Array.from({ length: 20 }, () => time(tile)[1]));
surface.delete();

const model = {
  pictures: N,
  pictureSize: `${W}x${H}`,
  layout: values.layout,
  picturesFolderMB: folderMB,
  makeBoardMs: makeMs,
  penFileMB: +(text.length / 2 ** 20).toFixed(2),
  open: { readFileMs: readMs, missingPictures: report.missingPictures.length, firstSceneMs: sceneMs, firstBoundsMs: boundsMs },
  documentStateMB: +(Y.encodeStateAsUpdate(doc).length / 2 ** 20).toFixed(2),
  onePictureMovedMs: moved,
  save: { fileTextMs: time(() => fileText(doc))[1], picturesToWrite: time(() => picturesOf(doc))[0].length, picturesOfMs: time(() => picturesOf(doc))[1] },
  oneTileMs: tileMs,
};
console.log(JSON.stringify({ model }, null, 2));

// ---- The app --------------------------------------------------------------------------------------------
if (values.app) {
  if (!existsSync(join(here, "out", "main", "index.js"))) throw new Error("Build the app first: pnpm build");
  const profile = join(work, "profile");
  mkdirSync(join(profile, "fonts"), { recursive: true });
  if (existsSync(join(here, ".cache", "fonts"))) cpSync(join(here, ".cache", "fonts"), join(profile, "fonts"), { recursive: true });
  const electron = join(here, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const port = 9334;
  const started = performance.now();
  const app = spawn(electron, [
    here,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    // The window keeps drawing when other windows cover it (Windows pauses a covered window's frames).
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ], { env: { ...process.env, LEMON_OPEN: file, LEMON_BENCH: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let appLog = "";
  app.stdout.on("data", (d: Buffer) => (appLog += d));
  app.stderr.on("data", (d: Buffer) => (appLog += d));
  const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
  try {
    // The editor's page, over the DevTools protocol.
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 150 && !target; i++) {
      await sleep(200);
      const list = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])) as { url: string; type: string; webSocketDebuggerUrl: string }[];
      target = list.find((t) => t.type === "page" && t.url.includes("index.html"));
    }
    if (!target) throw new Error(`The app didn't open the board:\n${appLog.slice(-2000)}`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    let nextId = 0;
    const waiting = new Map<number, (v: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>();
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number };
      if (m.id !== undefined) waiting.get(m.id)?.(m as never);
    };
    const evaluate = async <T>(expression: string): Promise<T> => {
      const id = ++nextId;
      const reply = await new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((r) => {
        waiting.set(id, r);
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
      return reply.result?.result?.value as T;
    };
    for (let i = 0; i < 300 && !(await evaluate<boolean>("!!window.__lemon && !!window.__lemon.canvasState().size")); i++) await sleep(100);
    const readyMs = Math.round(performance.now() - started);
    /** Waits until the view is whole (every tile painted, no picture on its way), at most `limit` ms. */
    const whole = `(limit) => new Promise((done) => { const t0 = performance.now(); let calm = 0; setTimeout(() => done({ ms: Math.round(performance.now() - t0), whole: false, stalled: "no frames: is the window minimised?", ...window.__lemon.canvasState() }), limit + 5000); const tick = () => { const s = window.__lemon.canvasState(); calm = s.settled ? calm + 1 : 0; if (calm > 10 || performance.now() - t0 > limit) done({ ms: Math.round(performance.now() - t0), whole: calm > 10, ...s }); else requestAnimationFrame(tick); }; tick(); })`;
    /** Frame gaps while the view moves right by `step` screen pixels a frame for `seconds`. */
    const pan = `(seconds, step) => new Promise((done) => { const gaps = []; const s0 = window.__lemon.canvasState().view; let x = s0.x; let last = performance.now(); const end = last + seconds * 1000; let holes = 0; let frames = 0; const tick = (now) => { gaps.push(now - last); last = now; frames++; if (window.__lemon.canvasState().bare) holes++; x += step / s0.zoom; window.__lemon.setView(x, s0.y, s0.zoom); if (now < end) requestAnimationFrame(tick); else { gaps.shift(); gaps.sort((a, b) => a - b); const q = (k) => +gaps[Math.min(gaps.length - 1, Math.floor(k * gaps.length))].toFixed(1); done({ fps: +(gaps.length / seconds).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +gaps.at(-1).toFixed(1), over33ms: gaps.filter((g) => g > 33).length, framesWithBareTiles: holes, frames }); } }; requestAnimationFrame(tick); })`;
    const memory = (): { processes: number; workingSetMB: number } | undefined => {
      if (process.platform !== "win32") return undefined;
      try {
        const out = execFileSync("powershell", ["-NoProfile", "-Command", `$all = Get-CimInstance Win32_Process; $ids = @(${app.pid}); do { $n = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Select-Object -Unique) } while ($ids.Count -ne $n); $p = $all | Where-Object { $ids -contains $_.ProcessId }; "$($p.Count) $([math]::Round(($p | Measure-Object WorkingSetSize -Sum).Sum / 1MB))"`], { encoding: "utf8" });
        const [processes, workingSetMB] = out.trim().split(/\s+/).map(Number);
        return { processes: processes!, workingSetMB: workingSetMB! };
      } catch {
        return undefined;
      }
    };
    const seconds = Number(values.seconds);
    const SIZE = `window.__lemon.canvasState().size`;
    // All of the board in view (every picture small).
    const firstView = await evaluate(`(${whole})(120000)`);
    const afterFirstView = memory();
    const results: Record<string, unknown> = { windowReadyMs: readyMs, firstViewWhole: firstView, memoryAfterFirstView: afterFirstView };
    for (const zoom of [0.25, 1]) {
      // From the board's left edge, at its middle height.
      await evaluate(`window.__lemon.setView(0, ${board.h / 2}, ${zoom})`);
      const settle = await evaluate<{ ms: number; whole: boolean }>(`(${whole})(60000)`);
      const cold = await evaluate(`(${pan})(${seconds}, 12)`);
      await evaluate(`(${whole})(60000)`);
      // The same stretch again: its tiles and pictures are here now.
      await evaluate(`window.__lemon.setView(0, ${board.h / 2}, ${zoom})`);
      await evaluate(`(${whole})(60000)`);
      const warm = await evaluate(`(${pan})(${seconds}, 12)`);
      // Fast: five times the speed, over ground not seen yet.
      await evaluate(`(${whole})(60000)`);
      const fast = await evaluate(`(${pan})(${seconds}, 60)`);
      await evaluate(`(${whole})(60000)`);
      const state = await evaluate<{ pictures: unknown }>(`window.__lemon.canvasState()`);
      results[`zoom${zoom}`] = { viewWholeAfterMs: settle.ms, wholeInTime: settle.whole, panCold: cold, panWarm: warm, panFast: fast, pictures: state.pictures, canvas: await evaluate(SIZE), memory: memory() };
    }
    // Zooming out from the middle, 1 to 0.2 over a second and a half: frames in which a tile in view showed the bare canvas.
    await evaluate(`window.__lemon.setView(${board.w / 2}, ${board.h / 2}, 1)`);
    await evaluate(`(${whole})(60000)`);
    await evaluate(`window.__lemon.canvasState(true)`);
    results.zoomOut = await evaluate(`new Promise((done) => { const size = window.__lemon.canvasState().size; const cx = ${board.w / 2} + size.width / 2, cy = ${board.h / 2} + size.height / 2; const t0 = performance.now(); let holes = 0, frames = 0; const gaps = []; let last = t0; const tick = (now) => { gaps.push(now - last); last = now; frames++; if (window.__lemon.canvasState().bare) holes++; const k = Math.min(1, (now - t0) / 1500); const zoom = Math.exp(Math.log(1) + (Math.log(0.2) - Math.log(1)) * k); window.__lemon.setView(cx - size.width / 2 / zoom, cy - size.height / 2 / zoom, zoom); if (k < 1) requestAnimationFrame(tick); else { gaps.shift(); gaps.sort((a, b) => a - b); done({ frames, framesWithBareTiles: holes, p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), max: +gaps.at(-1).toFixed(1), longest: window.__lemon.canvasState(true).spent }); } }; requestAnimationFrame(tick); })`);
    console.log(JSON.stringify({ app: results }, null, 2));
    ws.close();
  } finally {
    app.kill();
    await sleep(800);
  }
}
if (values.keep) console.error(`The board is in ${work}`);
else rmSync(work, { recursive: true, force: true });
process.exit(0);
