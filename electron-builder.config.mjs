// Packaging. Names and ids come from product.json, the one place the product's identity lives.
import { readFileSync } from "node:fs";

const product = JSON.parse(readFileSync(new URL("./product.json", import.meta.url), "utf8"));

/** @type {import("electron-builder").Configuration} */
export default {
  appId: product.appId,
  productName: product.name,
  executableName: product.slug,
  directories: { output: "dist" },
  files: ["out/**", "product.json", "package.json", "!**/*.map"],
  // Packages with native binaries or WebAssembly must stay outside the app archive to be loadable.
  asarUnpack: ["node_modules/@anthropic-ai/**", "node_modules/canvaskit-wasm/**", "node_modules/quickjs-emscripten*/**", "node_modules/@jitl/**"],
  artifactName: `${product.slug}-\${version}-\${os}-\${arch}.\${ext}`,
  win: { target: [{ target: "nsis", arch: ["x64"] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: { target: [{ target: "AppImage", arch: ["x64"] }], category: "Graphics" },
  publish: null,
};
