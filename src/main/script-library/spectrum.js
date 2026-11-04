/**
 * @schema 2.11
 * @input bars: number = 24
 * @input segments: number = 16
 * @input quiet: color = #22C55E
 * @input middle: color = #F59E0B
 * @input loud: color = #EF4444
 * @input background: color = #09090B
 */
// A music meter: bars of lit segments, green when quiet, amber in the middle, red at the top, with peak marks.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const n = Math.max(2, Math.floor(inp.bars)), segs = Math.max(2, Math.floor(inp.segments));
const pad = 10, gap = 3;
const bw = (W - pad * 2 - gap * (n - 1)) / n, sh = (H - pad * 2 - 2 * (segs - 1)) / segs;
const colour = (t) => (t < 0.6 ? inp.quiet : t < 0.8 ? inp.middle : inp.loud);
const nodes = [{ type: "rectangle", name: "Background", x: 0, y: 0, width: W, height: H, cornerRadius: 8, fill: inp.background }];
for (let b = 0; b < n; b++) {
  // Louder in the low end, as music usually is, with some life in it.
  const level = Math.min(1, Math.max(0.1, 0.85 - (b / n) * 0.45 + (Math.random() - 0.5) * 0.45));
  const lit = Math.round(level * segs);
  const x = pad + b * (bw + gap);
  for (let s = 0; s < segs; s++) {
    const y = H - pad - (s + 1) * sh - s * 2;
    const t = s / (segs - 1);
    nodes.push({ type: "rectangle", name: "Segment", x, y, width: bw, height: sh, cornerRadius: 1, fill: s < lit ? colour(t) : colour(t) + "1F" });
  }
  const peak = Math.min(segs - 1, lit + 1 + Math.floor(Math.random() * 2));
  nodes.push({ type: "rectangle", name: "Peak", x, y: H - pad - (peak + 1) * sh - peak * 2, width: bw, height: Math.max(2, sh * 0.35), fill: "#FAFAFA" });
}
return nodes;
