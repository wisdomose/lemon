// Finding web addresses in a message ("chat-buddy.xyz", "https://…", "localhost:3000"), for its link chips.

/** Endings that make a bare name an address ("chat-buddy.xyz"), so "e.g." or "app.tsx" stay text. */
const TLDS =
  "com|org|net|io|ai|dev|app|xyz|co|me|so|sh|gg|tv|uk|us|de|fr|nl|es|it|ca|au|in|ng|br|jp|cn|ru|ch|se|no|fi|dk|pl|be|at|ie|nz|za|info|biz|site|online|store|tech|design|studio|page|link|club|cloud|digital|agency|blog|shop|space|live|world|fun|art|edu|gov|localhost";
const ADDRESS = new RegExp(
  String.raw`\b(?:https?:\/\/[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${TLDS})(?::\d+)?(?:\/[^\s<>"']*)?|localhost:\d+(?:\/[^\s<>"']*)?)`,
  "gi",
);

/** A message's text split into plain runs and addresses. */
export function linkify(text: string): (string | { url: string })[] {
  const out: (string | { url: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(ADDRESS)) {
    // Punctuation after an address ends the sentence, not the address.
    const url = m[0].replace(/[.,;:!?)\]]+$/, "");
    const at = m.index!;
    if (at > last) out.push(text.slice(last, at));
    out.push({ url });
    last = at + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
