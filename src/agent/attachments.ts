// Files attached to a prompt ("Add image or file", pasted or dropped), and how each agent gets them.
// As in Pen (its agent's input, 3 Nov 2026): each attachment comes before the prompt, in the order
// they were added: images as images, PDFs as documents, anything else as its text, named.

export interface Attachment {
  name: string;
  kind: "image" | "pdf" | "text";
  /** image/png, application/pdf, text/plain, … */
  mediaType: string;
  /** Base64 for images and PDFs; the file's text otherwise. */
  data: string;
}

/** Images sent as pictures. Other image types (svg) go as their text, as in Pen. */
const IMAGES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };

/**
 * The types Pen's picker offers (its "Custom Files" filter, checked type by type): webp, bmp, ico,
 * avif, heic, tif, zip, docx and log aren't among them.
 */
export const ATTACHABLE = [
  ...Object.keys(IMAGES),
  "pdf", "pen", "svg", "txt", "md", "json", "html", "css", "js", "jsx", "ts", "tsx", "py", "xml", "yaml", "yml", "csv",
  "sql", "toml", "ini", "env", "vue", "svelte", "c", "cpp", "go", "rs", "java", "kt", "swift", "sh",
];

const extension = (name: string) => (/\.([^.\\/]+)$/.exec(name)?.[1] ?? name.replace(/^\./, "")).toLowerCase();

/** What an attached file is sent as, by its name (null: not attachable). */
export function kindOf(name: string): { kind: Attachment["kind"]; mediaType: string } | null {
  const ext = extension(name);
  if (IMAGES[ext]) return { kind: "image", mediaType: IMAGES[ext] };
  if (ext === "pdf") return { kind: "pdf", mediaType: "application/pdf" };
  return ATTACHABLE.includes(ext) ? { kind: "text", mediaType: "text/plain" } : null;
}

const named = (a: Attachment) => `<name>${a.name}</name>\n<content>${a.data}</content>`;

/** Claude's message content: the attachments, then the prompt. */
export function claudeContent(attachments: Attachment[], text: string) {
  return [
    ...attachments.map((a) =>
      a.kind === "image"
        ? { type: "image" as const, source: { type: "base64" as const, media_type: a.mediaType as "image/png", data: a.data } }
        : a.kind === "pdf"
          ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: a.data }, title: a.name }
          : { type: "text" as const, text: named(a) },
    ),
    { type: "text" as const, text },
  ];
}

/**
 * Codex's turn input: the attachments, then the prompt. Codex takes no PDFs, so a PDF is only named
 * (Pen with Codex not checked: Codex's usage limit was reached).
 */
export function codexInput(attachments: Attachment[], text: string) {
  return [
    ...attachments.map((a) =>
      a.kind === "image"
        ? { type: "image" as const, url: `data:${a.mediaType};base64,${a.data}` }
        : {
            type: "text" as const,
            text: a.kind === "pdf" ? `<name>${a.name}</name>\n<content>(A PDF; this model can't read PDFs.)</content>` : named(a),
            text_elements: [],
          },
    ),
    { type: "text" as const, text, text_elements: [] },
  ];
}
