/**
 * @schema 2.11
 * @input text: string = "MADE WITH CARE · SINCE 2026 · "
 * @input size: number = 14
 * @input color: color = #111827
 * @input rings: number = 2
 * @input background: color = #FFFFFF00
 */
// Words set round a circle, repeated to fill it; more rings go inwards, each turned a little.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const cx = W / 2, cy = H / 2;
const text = inp.text || " ";
// About how wide each letter is, in ems, so narrow and wide letters are spaced as they'd be in a word.
const advance = (ch) => (" .,:;'!|".includes(ch) ? 0.32 : "iIl1jtf".includes(ch) ? 0.38 : "MWmw@".includes(ch) ? 0.92 : /[A-Z0-9]/.test(ch) ? 0.7 : 0.58);
const nodes = [{ type: "rectangle", name: "Background", x: 0, y: 0, width: W, height: H, fill: inp.background }];
const rings = Math.max(1, Math.floor(inp.rings));
for (let r = 0; r < rings; r++) {
  const size = inp.size * (1 - r * 0.18);
  const radius = Math.min(W, H) / 2 - inp.size - r * inp.size * 2.2;
  if (radius < size * 2) break;
  // The text repeated as often as it fits, then stretched a little to close the circle.
  const once = [...text].reduce((w, ch) => w + advance(ch) * size, 0);
  const times = Math.max(1, Math.floor((2 * Math.PI * radius) / once));
  const letters = [...text.repeat(times)];
  const stretch = (2 * Math.PI * radius) / (once * times);
  let along = 0;
  for (const ch of letters) {
    const w = advance(ch) * size * stretch;
    // Each letter's middle sits on the circle, turned so its foot faces the centre.
    const turn = (along + w / 2) / radius + r * 0.4;
    along += w;
    if (ch === " ") continue;
    const deg = (turn * 180) / Math.PI;
    const half = (advance(ch) * size) / 2;
    const x = cx + Math.sin(turn) * radius, y = cy - Math.cos(turn) * radius;
    nodes.push({
      type: "text",
      name: "Letter",
      x: x - Math.cos(turn) * half,
      y: y - Math.sin(turn) * half,
      rotation: -deg,
      content: ch,
      fontSize: size,
      fontWeight: "600",
      fill: inp.color + (r ? "AA" : ""),
    });
  }
}
return nodes;
