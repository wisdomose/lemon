// Decodes and shrinks pictures off the window's own thread (picture-store.ts starts a few of these),
// so the canvas keeps drawing while photos come in. Bytes arrive and pictures leave as transfers, not copies.
import { decode, type DecodeJob } from "./picture-sizes.js";

const scope = self as unknown as { onmessage: ((e: MessageEvent<DecodeJob>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = (e) => {
  void decode(e.data).then((result) => scope.postMessage(result, "made" in result ? result.made.map((m) => m.bitmap) : []));
};
