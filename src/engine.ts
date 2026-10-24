// The drawing and measuring engine: CanvasKit, the fonts it knows, and text shaping. One per process
// (Node) or window (browser).
import CanvasKitModule, { type CanvasKit } from "canvaskit-wasm";

// canvaskit-wasm is a CommonJS package whose types declare an ES default export; at run time the
// default import is the init function itself (Node and bundlers alike).
const CanvasKitInit = ((CanvasKitModule as unknown as { default?: unknown }).default ?? CanvasKitModule) as unknown as (
  opts?: { locateFile: (file: string) => string },
) => Promise<CanvasKit>;
import { FontLibrary, type FontSource } from "./text/fonts.js";
import { TextEngine } from "./text/paragraph.js";

export interface Engine {
  ck: CanvasKit;
  fonts: FontLibrary;
  text: TextEngine;
}

/** `locateFile` points CanvasKit at its .wasm file in a browser; Node finds it on its own. */
export async function createEngine(source: FontSource, locateFile?: (file: string) => string): Promise<Engine> {
  const ck = await CanvasKitInit(locateFile ? { locateFile } : undefined);
  const fonts = new FontLibrary(ck, source);
  await fonts.ensure([]); // the default font, used for fallbacks and placeholders
  return { ck, fonts, text: new TextEngine(ck, fonts) };
}
