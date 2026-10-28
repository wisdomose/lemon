// The Dashboard's file pictures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readFile } from "../src/doc/file.js";
import { THUMB, thumbnail } from "../src/render/thumbnail.js";
import { setup } from "./helpers.js";

const size = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};

describe("file pictures", () => {
  it("draw the whole page at the card's size", async () => {
    const { engine } = await setup();
    const doc = new Y.Doc();
    readFile(readFileSync(join(import.meta.dirname, "fixtures", "sample.pen"), "utf8"), doc);
    const png = await thumbnail(engine, doc);
    expect(png).toBeDefined();
    expect(size(png!)).toEqual({ width: THUMB.width, height: THUMB.height });
  });

  it("are left out for an empty page", async () => {
    const { engine } = await setup();
    expect(await thumbnail(engine, new Y.Doc())).toBeUndefined();
  });
});
