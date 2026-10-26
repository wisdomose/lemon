// Splitting a script into statements while it is being written (src/agent/statements.ts).
import { describe, expect, it } from "vitest";
import { statements } from "../src/agent/statements.js";

const SCRIPT = `section = doc.insert(page, { type: "frame", name: "Picks", width: "fill", padding: [96, 120], gap: 32 });
const label = doc.insert(section, { type: "text", text: "Staff picks; October", size: 12 })
doc.insert(section, { type: "text", text: \`Handpicked by \${"people"} who stayed up\`, size: 48 });
if (label) { log("ok"); } else { log("no"); }
const books = [{ t: "The Salt Orchard" }, { t: "Small Hours" }];
for (const b of books) {
  const card = doc.insert(section, { type: "frame", name: b.t });
  doc.insert(card, { type: "text", text: b.t });
}
function helper(x) { return x * 2; }
var count = helper(2)
return doc.get(section, 1);`;

describe("statements of a script being written", () => {
  const whole = statements(SCRIPT, 0, true).map((p) => SCRIPT.slice(p.start, p.end));

  it("finds every top-level statement of the finished script", () => {
    expect(whole).toHaveLength(9);
    expect(whole[3]).toBe(`if (label) { log("ok"); } else { log("no"); }`);
  });

  it("at every point while it is written, gives only whole statements, in order", () => {
    let consumed = 0;
    const seen: string[] = [];
    for (let n = 0; n <= SCRIPT.length; n++) {
      const text = SCRIPT.slice(0, n);
      for (const p of statements(text, consumed, false)) {
        seen.push(text.slice(p.start, p.end));
        consumed = p.end;
      }
    }
    for (const p of statements(SCRIPT, consumed, true)) seen.push(SCRIPT.slice(p.start, p.end));
    expect(seen).toEqual(whole);
  });

  it("knows a statement without a semicolon is done only once the next one begins", () => {
    const text = `const a = doc.insert(page, { type: "text" })`;
    expect(statements(text, 0, false)).toEqual([]);
    expect(statements(text + "\n.length", 0, false)).toEqual([]);
    expect(statements(text + "\ndoc", 0, false)).toHaveLength(1);
  });

  it("marks returns, the names a script declares, and line numbers", () => {
    const pieces = statements(SCRIPT, 0, true);
    expect(pieces.at(-1)).toMatchObject({ returns: true, line: 12 });
    expect(pieces[3]!.returns).toBe(false);
    expect(pieces.flatMap((p) => p.declares)).toEqual(["helper", "count"]);
  });

  it("reports a syntax error in the finished script with its line", () => {
    expect(() => statements(`doc.insert(page, {});\ndoc.insert(page, { type: "text" );`, 0, true)).toThrow(
      expect.objectContaining({ name: "SyntaxError", line: 2 }),
    );
  });
});
