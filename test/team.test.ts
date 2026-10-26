// Reading the plan a team agrees before building (agent/team.ts).
import { describe, expect, it } from "vitest";
import { readPlan } from "../src/agent/team.js";

describe("a team's agreed plan", () => {
  it("is read from the reply, with one part per agent at most", () => {
    const reply = `Here is the plan:
{"summary":"Warm and bold.","vars":{"bg":"#101010","display":"Anton","bad name":"x","radius":8,"nested":{"a":1}},
 "layout":"page","name":"Bakery","width":1440,
 "parts":[{"name":"Hero","brief":"Big loaf."},{"name":"Menu","brief":"Six breads."},{"name":"Visit","brief":"Map and hours."},{"name":"Extra","brief":"x"}]}`;
    const p = readPlan(reply, 3);
    expect(p.parts.map((x) => x.name)).toEqual(["Hero", "Menu", "Visit"]);
    expect(p.vars).toEqual({ bg: "#101010", display: "Anton", radius: 8 });
    expect(p).toMatchObject({ layout: "page", name: "Bakery", width: 1440, summary: "Warm and bold." });
  });

  it("falls back to sensible values and refuses a reply without parts", () => {
    expect(readPlan('{"layout":"screens","parts":[{"name":"Home","brief":"b"}],"height":844}', 2)).toMatchObject({ layout: "screens", width: 1440, height: 844, name: "Design" });
    expect(() => readPlan("no plan here", 2)).toThrow();
    expect(() => readPlan('{"parts":[]}', 2)).toThrow();
  });
});
