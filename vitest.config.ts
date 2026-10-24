// Tests run from the project root (vite.config.ts is rooted at the window's folder).
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { root: ".", include: ["test/**/*.test.ts"], testTimeout: 30_000 } });
