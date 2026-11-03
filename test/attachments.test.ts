// Files attached to a prompt (src/agent/attachments.ts). The expected shapes are what Pen gave its
// agent for the same attachments (its session log, 3 Nov 2026).
import { describe, expect, it } from "vitest";
import { chatContent, claudeContent, codexInput, kindOf, type Attachment } from "../src/agent/attachments.js";

describe("attachments", () => {
  it("sends png, jpg and gif as pictures, pdf as a document, and text-like files as text", () => {
    expect(kindOf("red.png")).toEqual({ kind: "image", mediaType: "image/png" });
    expect(kindOf("Photo.JPG")).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(kindOf("blue.gif")).toEqual({ kind: "image", mediaType: "image/gif" });
    expect(kindOf("doc.pdf")).toEqual({ kind: "pdf", mediaType: "application/pdf" });
    for (const name of ["shape.svg", "notes.txt", "a.pen", "x.tsx", ".env"]) expect(kindOf(name)?.kind).toBe("text");
  });

  it("leaves out what Pen's picker doesn't offer", () => {
    for (const name of ["a.webp", "a.bmp", "a.ico", "a.avif", "a.heic", "a.tif", "a.zip", "a.docx", "a.log"]) expect(kindOf(name)).toBeNull();
  });

  const files: Attachment[] = [
    { name: "blue.gif", kind: "image", mediaType: "image/gif", data: "R0lG" },
    { name: "shape.svg", kind: "text", mediaType: "text/plain", data: "<svg/>" },
    { name: "doc.pdf", kind: "pdf", mediaType: "application/pdf", data: "JVBE" },
  ];

  it("gives Claude each attachment before the prompt, in order", () => {
    expect(claudeContent(files, "Make it")).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/gif", data: "R0lG" } },
      { type: "text", text: "<name>shape.svg</name>\n<content><svg/></content>" },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBE" }, title: "doc.pdf" },
      { type: "text", text: "Make it" },
    ]);
  });

  it("gives an OpenAI-type provider pictures only when its model reads them", () => {
    expect(chatContent(files, "Make it", true)).toEqual([
      { type: "image_url", image_url: { url: "data:image/gif;base64,R0lG" } },
      { type: "text", text: "<name>shape.svg</name>\n<content><svg/></content>" },
      { type: "text", text: "<name>doc.pdf</name>\n<content>(A PDF; this model can't read PDFs.)</content>" },
      { type: "text", text: "Make it" },
    ]);
    expect(chatContent(files, "Make it", false)[0]).toEqual({ type: "text", text: "<name>blue.gif</name>\n<content>(A picture; this model can't read pictures.)</content>" });
  });

  it("gives Codex pictures as data URLs and names a PDF it can't read", () => {
    const input = codexInput(files, "Make it");
    expect(input[0]).toEqual({ type: "image", url: "data:image/gif;base64,R0lG" });
    expect(input[1]).toEqual({ type: "text", text: "<name>shape.svg</name>\n<content><svg/></content>", text_elements: [] });
    expect(input[2]).toMatchObject({ type: "text" });
    expect((input[2] as { text: string }).text).toContain("<name>doc.pdf</name>");
    expect(input[3]).toEqual({ type: "text", text: "Make it", text_elements: [] });
  });
});
