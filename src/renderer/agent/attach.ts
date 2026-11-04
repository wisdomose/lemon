// Files attached to the prompt being written: picked ("+" → Add image or file), pasted or dropped.
// They wait in the tray above the prompt, in the order they came, until the prompt is sent.
import { ATTACHABLE, kindOf, type Attachment } from "../../agent/attachments.js";
import { store, type SentAttachment } from "../store.js";

/** What the picker offers, as Pen's ("Custom Files"). */
export const ACCEPT = ATTACHABLE.map((e) => `.${e}`).join(",");

function read(file: File): Promise<Attachment | null> {
  const type = kindOf(file.name);
  if (!type) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ name: file.name, ...type, data: type.kind === "text" ? result : result.slice(result.indexOf(",") + 1) });
    };
    reader.onerror = () => resolve(null);
    if (type.kind === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/** Adds files to the tray; ones that can't be attached are left out. */
export async function attachFiles(files: Iterable<File>): Promise<void> {
  const read_ = await Promise.all([...files].map(read));
  const added = read_.filter((a): a is Attachment => !!a).map((a) => ({ ...a, id: crypto.randomUUID() }));
  if (added.length) store.set((s) => ({ attachments: [...s.attachments, ...added] }));
}

export const detach = (id: string) => store.set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) }));

/** The system's Open dialog, for several files of the attachable types. */
export function pickFiles(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ACCEPT;
  input.onchange = () => void attachFiles(input.files ?? []);
  input.click();
}

/** A tray image's picture. */
export const dataUrl = (a: Attachment) => `data:${a.mediaType};base64,${a.data}`;

/** What the chat keeps of a sent attachment. */
export const sent = (a: Attachment): SentAttachment =>
  a.kind === "image"
    ? { name: a.name, kind: a.kind, url: dataUrl(a) }
    : a.kind === "text"
      ? { name: a.name, kind: a.kind, text: a.data }
      : { name: a.name, kind: a.kind };
