// Builds the desktop app into out/: the main process and preload with esbuild, the window with Vite.
import { build } from "esbuild";
import { build as viteBuild } from "vite";

await Promise.all([
  build({
    entryPoints: ["src/main/main.ts"],
    outfile: "out/main/main.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    // Packages that ship their own binaries or WebAssembly stay in node_modules.
    external: ["electron", "@anthropic-ai/claude-agent-sdk", "canvaskit-wasm", "quickjs-emscripten", "yoga-layout"],
  }),
  build({
    entryPoints: ["src/main/preload.ts"],
    outfile: "out/main/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  viteBuild({ configFile: "vite.config.ts", logLevel: "warn" }),
]);
console.log("built out/");
