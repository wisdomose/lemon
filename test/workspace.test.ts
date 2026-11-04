// "Add from workspace" (src/main/workspace.ts): the attachable files beside the open document.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => join(tmpdir(), "lemon-workspace-test-home") } }));
const { listWorkspace, readWorkspace, workspaceFolder } = await import("../src/main/workspace.js");

function folder() {
  const dir = mkdtempSync(join(tmpdir(), "lemon-workspace-"));
  for (const [path, text] of Object.entries({
    "design.pen": "{}",
    "brief.md": "# Brief",
    "logo.png": "png",
    "notes.log": "not attachable",
    "z-assets/hero.jpg": "jpg",
    "a-docs/spec.pdf": "pdf",
    "node_modules/x/readme.md": "skipped",
    ".git/config.ini": "skipped",
  })) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("workspace", () => {
  it("lists a folder's own files before its folders', leaving out the open document", () => {
    const dir = folder();
    expect(listWorkspace(dir, join(dir, "design.pen")).map((f) => f.path)).toEqual(["brief.md", "logo.png", "a-docs/spec.pdf", "z-assets/hero.jpg"]);
  });

  it("reads chosen files for the agent, and only ones it lists", () => {
    const dir = folder();
    const read = readWorkspace(dir, ["brief.md", "z-assets/hero.jpg", "notes.log", "../outside.md"]);
    expect(read).toEqual([
      { name: "brief.md", kind: "text", mediaType: "text/plain", data: "# Brief" },
      { name: "hero.jpg", kind: "image", mediaType: "image/jpeg", data: Buffer.from("jpg").toString("base64") },
    ]);
  });

  it("names files by their path for an @ mention, and lists the open document for it", () => {
    const dir = folder();
    expect(readWorkspace(dir, ["z-assets/hero.jpg"], true)[0]!.name).toBe("z-assets/hero.jpg");
    expect(listWorkspace(dir).map((f) => f.path)).toContain("design.pen");
  });

  it("has no folder for a document never saved", () => {
    expect(workspaceFolder(null)).toBeNull();
    expect(listWorkspace(null)).toEqual([]);
  });
});
