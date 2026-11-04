// Measures how smooth the window stays: frame times with an animated shader on the canvas (selected and
// not), and how long the window stops answering while an outside agent (through the app's MCP server)
// runs a script of a few hundred statements. Runs a build of the app (pnpm build) headless, so on
// Linux under a virtual screen:
//
//   xvfb-run -s "-screen 0 1600x1000x24" npx tsx scripts/bench-window.ts [app folder, default .] [--statements 300]
//
// The window is driven over the DevTools protocol (Playwright's connectOverCDP); fonts come from
// .cache/fonts (the tests' cache), so nothing is downloaded.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { statements: { type: "string", default: "300" }, seconds: { type: "string", default: "4" } } });
const appDir = resolve(positionals[0] ?? ".");
const STATEMENTS = Number(values.statements);
const SECONDS = Number(values.seconds);
const here = resolve(import.meta.dirname, "..");
// Playwright: the project's, or the one installed beside Node.
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const at of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try {
      return require(at);
    } catch {}
  }
  throw new Error("Playwright isn't installed");
})();

const work = mkdtempSync(join(tmpdir(), "lemon-bench-"));
const profile = join(work, "profile");
mkdirSync(join(profile, "fonts"), { recursive: true });
if (existsSync(join(here, ".cache", "fonts"))) cpSync(join(here, ".cache", "fonts"), join(profile, "fonts"), { recursive: true });
cpSync(join(here, "src", "main", "shader-library", "aurora.glsl"), join(work, "aurora.glsl"));

// The document: a page of 240 cards (a rectangle and two texts each), and a 600 × 400 aurora shader
// above it, in view right of the panels.
const cards = Array.from({ length: 240 }, (_, i) => ({
  type: "frame",
  id: `card${i}`,
  name: `Card ${i}`,
  layout: "vertical",
  gap: 6,
  padding: 12,
  width: 160,
  fill: "#ffffff",
  cornerRadius: 8,
  stroke: { type: "solid", color: "#e4e4e7" },
  strokeWidth: 1,
  children: [
    { type: "rectangle", id: `pic${i}`, width: "fill_container", height: 60, fill: `#${((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(0, 6)}`, cornerRadius: 4 },
    { type: "text", id: `title${i}`, content: `Card number ${i}`, fontSize: 14, fontWeight: "600", fill: "#18181b" },
    { type: "text", id: `body${i}`, content: "Some words about this card, wrapping.", fontSize: 12, fill: "#52525b", textGrowth: "fixed-width", width: "fill_container" },
  ],
}));
const rows = Array.from({ length: 12 }, (_, r) => ({ type: "frame", id: `row${r}`, layout: "horizontal", gap: 16, children: cards.slice(r * 20, r * 20 + 20) }));
const pen = {
  version: "2.21",
  children: [
    { type: "frame", id: "page", name: "Page", x: 0, y: 0, layout: "vertical", gap: 16, padding: 32, fill: "#f4f4f5", children: rows },
    { type: "rectangle", id: "aurora", name: "Aurora", x: 900, y: -460, width: 600, height: 400, cornerRadius: 24, fill: { type: "shader", url: "./aurora.glsl" } },
  ],
};
const file = join(work, "bench.pen");
writeFileSync(file, JSON.stringify(pen));

const electron = join(here, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const port = 9333;
const pipe = join(work, "mcp.sock");
const app = spawn(electron, [appDir, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"], {
  env: { ...process.env, LEMON_OPEN: file, LEMON_MCP_PIPE: pipe },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", (b: Buffer) => (appLog += b));
app.stderr.on("data", (b: Buffer) => (appLog += b));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  let browser;
  for (let i = 0; i < 100 && !browser; i++) {
    await sleep(200);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error(`The app didn't start:\n${appLog}`);
  const findPage = async () => {
    for (let i = 0; i < 100; i++) {
      for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes("index.html")) return p;
      await sleep(200);
    }
    throw new Error("No editor window");
  };
  let page = await findPage();
  const ready = async () => {
    // tsx names functions with a helper the page doesn't have.
    await page.waitForFunction(() => (((window as unknown as { __name: unknown }).__name = (f: unknown) => f), document.body.dataset.ready), undefined, { timeout: 60_000 });
    await sleep(1500);
  };
  await ready();

  /** Frames for `seconds`: intervals between frames, and how busy the window's main thread was. */
  const frames = async (seconds: number) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const busy = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m: { name: string }) => m.name === "TaskDuration").value as number;
    const t0 = await busy();
    const gaps: number[] = await page.evaluate(
      (ms: number) =>
        new Promise<number[]>((done) => {
          const out: number[] = [];
          let last = performance.now();
          const end = last + ms;
          const tick = (now: number) => {
            out.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else done(out);
          };
          requestAnimationFrame(tick);
        }),
      seconds * 1000,
    );
    const t1 = await busy();
    await cdp.detach();
    gaps.shift();
    gaps.sort((a, b) => a - b);
    const q = (k: number) => gaps[Math.min(gaps.length - 1, Math.floor(k * gaps.length))]!;
    return { fps: +(gaps.length / seconds).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +gaps.at(-1)!.toFixed(1), busyMsPerSecond: +(((t1 - t0) * 1000) / seconds).toFixed(0) };
  };

  // The view: the shader and part of the page, at 50%.
  const at = (params: string) => page.evaluate((p: string) => (location.search = p), params).catch(() => {});
  await at("?view=-40,-500,0.5");
  page = await findPage();
  await ready();
  if (process.env.BENCH_SHOT) await page.screenshot({ path: process.env.BENCH_SHOT });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl ? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "no WebGL";
  });
  /** Whether the shader's area changes between two screenshots 400 ms apart (it animates). */
  const moves = async () => {
    const clip = { x: 470, y: 20, width: 300, height: 200 };
    const a = await page.screenshot({ clip });
    await sleep(400);
    const b = await page.screenshot({ clip });
    return !a.equals(b);
  };
  const notSelectedMoves = await moves();
  const notSelected = { ...(await frames(SECONDS)), moves: notSelectedMoves };
  await at("?view=-40,-500,0.5&select=aurora");
  page = await findPage();
  await ready();
  const selectedMoves = await moves();
  const selected = { ...(await frames(SECONDS)), moves: selectedMoves };
  await at("?view=-40,-500,0.5");
  page = await findPage();
  await ready();

  // The agent run: a script of STATEMENTS statements, sent through the MCP server, while the window
  // checks every 10 ms that it can still draw a frame and reach the app (an IPC round trip).
  const script = [
    `const board = Insert(document, { type: "frame", name: "Board", x: 4000, y: 0, width: 1200, layout: "vertical", gap: 8, padding: 24, fill: "#fafafa" });`,
    // Each row is two statements: the row, then its text.
    ...Array.from({ length: Math.floor((STATEMENTS - 1) / 2) }, (_, i) => [
      `const r${i} = Insert(board, { type: "frame", name: "Row ${i}", layout: "horizontal", gap: 12, padding: 8, fill: "#${((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(0, 6)}", width: "fill_container", cornerRadius: 6 });`,
      `Insert(r${i}, { type: "text", content: "Row ${i}: something the agent wrote", fontSize: 14, fill: "#27272a" });`,
    ]).flat(),
  ].join("\n");
  await page.evaluate(() => {
    const w = window as unknown as { __watch: { frames: number[]; pings: number[]; stop: boolean } };
    w.__watch = { frames: [], pings: [], longTasks: [], stop: false } as typeof w.__watch;
    new PerformanceObserver((list) => list.getEntries().forEach((e) => (w.__watch as unknown as { longTasks: number[] }).longTasks.push(e.duration))).observe({ type: "longtask" });
    let last = performance.now();
    const tick = (now: number) => {
      w.__watch.frames.push(now - last);
      last = now;
      if (!w.__watch.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const lemon = (window as unknown as { lemon: { fileInfo(): Promise<unknown> } }).lemon;
    const ping = async () => {
      while (!w.__watch.stop) {
        const t = performance.now();
        await lemon.fileInfo();
        w.__watch.pings.push(performance.now() - t);
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    void ping();
  });
  // BENCH_PROFILE=1: where the window's time goes during the run (self time by function).
  const profiler = process.env.BENCH_PROFILE ? await page.context().newCDPSession(page) : undefined;
  if (profiler) (await profiler.send("Profiler.enable"), await profiler.send("Profiler.start"));
  const t0 = Date.now();
  const reply = await mcpExecute(pipe, script);
  const runMs = Date.now() - t0;
  if (reply.isError) console.error(JSON.stringify(reply.content).slice(0, 2000));
  // Until the window has caught up with the last statement.
  await ready();
  const watch = await page.evaluate(() => {
    const w = (window as unknown as { __watch: { frames: number[]; pings: number[]; stop: boolean } }).__watch;
    w.stop = true;
    return { frames: w.frames.slice(1), pings: w.pings, longTasks: (w as unknown as { longTasks: number[] }).longTasks };
  });
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    const self = new Map<string, number>();
    const byId = new Map(profile.nodes.map((n: { id: number }) => [n.id, n]));
    const dt = profile.timeDeltas as number[];
    (profile.samples as number[]).forEach((id, k) => {
      const n = byId.get(id) as { callFrame: { functionName: string; url: string; lineNumber: number } };
      const name = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
      self.set(name, (self.get(name) ?? 0) + (dt[k] ?? 0) / 1000);
    });
    console.error([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${n}`).join("\n"));
  }
  const stalled = (list: number[], over: number) => list.filter((g) => g > over).reduce((a, b) => a + b, 0);
  const agent = {
    statements: STATEMENTS,
    ok: !reply.isError,
    runMs,
    longestFrameMs: +Math.max(...watch.frames).toFixed(0),
    framesOver100ms: watch.frames.filter((g: number) => g > 100).length,
    windowStalledMs: +stalled(watch.frames, 100).toFixed(0),
    longestAppReplyMs: +Math.max(...watch.pings).toFixed(0),
    // The window's own main thread: tasks over 50 ms (time it couldn't answer input).
    windowLongTasks: watch.longTasks.length,
    windowLongestTaskMs: +Math.max(0, ...watch.longTasks).toFixed(0),
    windowBlockedMs: +watch.longTasks.reduce((a: number, b: number) => a + b, 0).toFixed(0),
    appStalledMs: +stalled(watch.pings, 100).toFixed(0),
  };
  console.log(JSON.stringify({ app: appDir, gpu, shaderNotSelected: notSelected, shaderSelected: selected, agent }, null, 2));
  await browser.close().catch(() => {});
} finally {
  app.kill();
  await sleep(500);
  rmSync(work, { recursive: true, force: true });
}

/** Calls the execute tool through the app's MCP server, as the connector would. */
async function mcpExecute(path: string, input: string): Promise<{ isError?: boolean; content: unknown[] }> {
  const socket = createConnection(path);
  await new Promise((r, j) => (socket.once("connect", r), socket.once("error", j)));
  socket.write(JSON.stringify({ agent: "bench" }) + "\n");
  let buffer = "";
  const waiting = new Map<number, (v: { result?: unknown; error?: unknown }) => void>();
  socket.on("data", (b: Buffer) => {
    buffer += b.toString("utf8");
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const call = (method: string, params: unknown) =>
    new Promise<{ result?: unknown; error?: unknown }>((r) => {
      waiting.set(++id, r);
      socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bench", version: "0" } });
  socket.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const r = await call("tools/call", { name: "execute", arguments: { input, filePath: "" } });
  socket.end();
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result as { isError?: boolean; content: unknown[] };
}

