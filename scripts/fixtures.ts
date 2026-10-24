// Writes the documents used by tests and visual checks into test/fixtures/.
import { writeFileSync } from "node:fs";
import * as Y from "yjs";
import { newFile } from "../src/doc/store.js";

const doc = new Y.Doc();
newFile(doc);
writeFileSync("test/fixtures/new-file.yjs", Y.encodeStateAsUpdate(doc));
console.log("wrote test/fixtures/new-file.yjs");
