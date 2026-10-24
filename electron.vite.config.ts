// Builds and runs the app: the main process (src/main), the preload bridge (src/preload) and the window
// (src/renderer). `pnpm dev` serves the window live and restarts Electron when the main process changes.
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { join } from "node:path";
import { GoogleFonts } from "./src/text/google-fonts.js";

/**
 * Serves fonts over HTTP (/fonts/…) so the window also works in a plain browser for headless checks,
 * where there is no desktop host to ask. Development only.
 */
function devFonts(): Plugin {
  let fonts: Promise<GoogleFonts> | undefined;
  return {
    name: "lemon-dev-fonts",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (!url.pathname.startsWith("/fonts/")) return next();
        try {
          fonts ??= GoogleFonts.open(join(import.meta.dirname, ".cache", "fonts"));
          const g = await fonts;
          if (url.pathname === "/fonts/catalogue.json") {
            res.setHeader("content-type", "application/json");
            return res.end(JSON.stringify(g.catalogue.families));
          }
          const face = {
            family: url.searchParams.get("family") ?? "",
            weight: Number(url.searchParams.get("weight") ?? 400),
            italic: url.searchParams.get("italic") === "1",
          };
          res.setHeader("content-type", "font/ttf");
          res.end(Buffer.from(await g.load(face)));
        } catch (e) {
          res.statusCode = 404;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  main: {
    build: { sourcemap: true },
  },
  preload: {
    // Sandboxed windows need a single CommonJS preload file with nothing left to import.
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss(), devFonts()],
    build: { target: "esnext" },
    server: { fs: { allow: [import.meta.dirname] } },
  },
});
