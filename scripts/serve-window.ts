// Serves only the window (src/renderer) in a plain browser, for headless checks: electron-vite's own
// dev command always starts Electron too. Uses the renderer section of electron.vite.config.ts.
//   npx tsx scripts/serve-window.ts [port]
import { resolveConfig } from "electron-vite";
import { createServer } from "vite";

const { config } = await resolveConfig({}, "serve");
if (!config?.renderer) throw new Error("electron.vite.config.ts has no renderer section");
const server = await createServer({
  ...config.renderer,
  configFile: false,
  server: { ...config.renderer.server, port: Number(process.argv[2] ?? 5173), strictPort: true },
});
await server.listen();
server.printUrls();
