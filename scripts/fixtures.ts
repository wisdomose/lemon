// Writes the documents used by tests and visual checks into test/fixtures/.
import { writeFileSync } from "node:fs";
import * as Y from "yjs";
import { insert, newFile, toTree } from "../src/doc/store.js";

const doc = new Y.Doc();
newFile(doc);
writeFileSync("test/fixtures/new-file.yjs", Y.encodeStateAsUpdate(doc));

// The new file with a gradient rectangle inside its frame.
const frame = toTree(doc).children[0]!.id;
insert(doc, frame, {
  type: "rect", x: 307, y: 227, width: 251, height: 199,
  fill: { type: "linear", angle: 0, stops: [{ color: "#000000", at: 0 }, { color: "#ffffff", at: 1 }] },
});
writeFileSync("test/fixtures/frame-with-rect.yjs", Y.encodeStateAsUpdate(doc));
console.log("wrote test/fixtures/new-file.yjs, frame-with-rect.yjs");
