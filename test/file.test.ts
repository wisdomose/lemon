// The .lemon file (src/doc/file.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { FILE_VERSION, FileError, fileText, readFile, toFile } from "../src/doc/file.js";
import { getVars, toTree } from "../src/doc/store.js";

const sample = () => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, readFileSync(join(import.meta.dirname, "fixtures", "sample.yjs")));
  return doc;
};

describe("a .lemon file", () => {
  it("round-trips a whole design: same tree, same properties, same variables", () => {
    const doc = sample();
    const again = new Y.Doc();
    readFile(fileText(doc), again);
    expect(toTree(again)).toEqual(toTree(doc));
    expect(getVars(again)).toEqual(getVars(doc));
  });
  it("lists nodes in tree order, parents before children, each with its id, type, parent and order", () => {
    const f = toFile(sample());
    expect(f.lemon).toBe(FILE_VERSION);
    const seen = new Set(["root"]);
    for (const n of f.nodes) {
      expect(seen.has(n.parent)).toBe(true);
      expect(typeof n.order).toBe("string");
      seen.add(n.id);
    }
  });
  it("refuses what isn't a Lemon file, and files from a newer version", () => {
    const into = new Y.Doc();
    expect(() => readFile("not json", into)).toThrow(FileError);
    expect(() => readFile('{"hello": 1}', into)).toThrow(/isn't a Lemon file/);
    expect(() => readFile('{"lemon": 99, "nodes": []}', into)).toThrow(/newer version/);
    expect(() => readFile('{"lemon": 1, "nodes": [{"id": "a", "type": "blob", "parent": "root", "order": "a0"}]}', into)).toThrow(/unknown type "blob"/);
    expect(() => readFile('{"lemon": 1, "nodes": [{"id": "a", "type": "rect", "parent": "root", "order": "a0"}, {"id": "a", "type": "rect", "parent": "root", "order": "a1"}]}', into)).toThrow(/repeats/);
  });
});
