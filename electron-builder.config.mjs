// Packaging. Names and ids come from product.json, the one place the product's identity lives.
import { readFileSync } from "node:fs";

const product = JSON.parse(readFileSync(new URL("./product.json", import.meta.url), "utf8"));

/** @type {import("electron-builder").Configuration} */
export default {
  appId: product.appId,
  productName: product.name,
  executableName: product.slug,
  directories: { output: "dist" },
  files: [
    "out/**",
    "product.json",
    // Native windows load the same artwork in development and packaged apps.
    "assets/icon.png",
    "package.json",
    "!**/*.map",
    // Codex comes with the app (src/agent/codex.ts) without its voice feature and file-search tool,
    // which Lemon turns off.
    "!node_modules/@openai/**/codex-resources/voice/**",
    "!node_modules/@openai/**/codex-path/**",
    // Phosphor's icons are drawn from its TrueType fonts (src/text/icon-fonts.ts); the rest of its web package isn't needed.
    "!node_modules/@phosphor-icons/web/src/**/*.{svg,woff,woff2,css,json,js}",
  ],
  // Packages with native binaries or WebAssembly must stay outside the app archive to be loadable.
  asarUnpack: ["node_modules/@anthropic-ai/**", "node_modules/@openai/**", "node_modules/canvaskit-wasm/**", "node_modules/quickjs-emscripten*/**", "node_modules/@jitl/**"],
  // Double-clicking a design file opens it in the app.
  fileAssociations: [{ ext: product.fileExtension, name: "Pen design", role: "Editor" }],
  artifactName: `${product.slug}-\${version}-\${os}-\${arch}.\${ext}`,
  mac: { icon: "assets/icon.icns" },
  win: { icon: "assets/icon.ico", target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: { icon: "assets/icon.png", target: [{ target: "AppImage", arch: ["x64"] }], category: "Graphics" },
  publish: null,
};
