// Addresses in a message become link chips (as in Pen); names that only look like files stay text.
import { describe, expect, it } from "vitest";
import { linkify } from "../src/renderer/agent/linkify.js";

describe("linkify", () => {
  it("finds a bare domain, as in the person's prompt", () => {
    expect(linkify("i want to create a landing page for chat-buddy.xyz")).toEqual(["i want to create a landing page for ", { url: "chat-buddy.xyz" }]);
  });

  it("keeps sentence punctuation out of the address", () => {
    expect(linkify("See https://example.com/a?b=1. Then go.")).toEqual(["See ", { url: "https://example.com/a?b=1" }, ". Then go."]);
  });

  it("finds local dev servers", () => {
    expect(linkify("check localhost:3000/app")).toEqual(["check ", { url: "localhost:3000/app" }]);
  });

  it("leaves file names and abbreviations alone", () => {
    expect(linkify("edit app.tsx, e.g. the header")).toEqual(["edit app.tsx, e.g. the header"]);
  });
});
