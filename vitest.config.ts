// Tests run from the project root, separately from the app build (electron.vite.config.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { root: ".", include: ["test/**/*.test.ts"], testTimeout: 30_000 } });
