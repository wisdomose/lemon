// Builds the window (src/renderer). In development and headless checks, the dev server also serves
// fonts (/fonts/…) and saved documents (/proof-output/…), standing in for the desktop app's host.
import { defineConfig, type Plugin } from "vite";
import { join } from "node:path";
import { GoogleFonts } from "./src/text/google-fonts.js";

function devHost(): Plugin {
  let fonts: Promise<GoogleFonts> | undefined;
  return {
    name: "lemon-dev-host",
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
  root: "src/renderer",
  base: "./",
  publicDir: false,
  plugins: [devHost()],
  build: { outDir: "../../out/renderer", emptyOutDir: true, target: "esnext" },
  server: { fs: { allow: [".."] } },
});
