import { describe, expect, it } from "vitest";
import { markdown } from "../src/renderer/markdown.js";

describe("chat markdown", () => {
  it("formats bold, lists and paragraphs", () => {
    expect(markdown("**The look:** serif\n\n- one\n- two\n\n1. a\n2. b")).toBe(
      "<p><strong>The look:</strong> serif</p><ul><li>one</li><li>two</li></ul><ol><li>a</li><li>b</li></ol>",
    );
  });
  it("never lets the agent's text become markup", () => {
    expect(markdown('<img src=x onerror="alert(1)"> **<b>hi</b>**')).toBe(
      "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <strong>&lt;b&gt;hi&lt;/b&gt;</strong></p>",
    );
  });
});
