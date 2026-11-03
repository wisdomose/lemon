/**
 * @schema 2.11
 * @input hours: number = 10
 * @input minutes: number = 9
 * @input seconds: number = 36
 * @input face: color = #FAFAF9
 * @input ink: color = #1C1917
 * @input accent: color = #EA580C
 * @input numerals: boolean = true
 */
// A wall clock showing the given time: minute marks, numerals, three hands.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const r = Math.min(W, H) / 2, cx = W / 2, cy = H / 2;
const at = (turn, dist) => [cx + Math.sin(turn) * dist, cy - Math.cos(turn) * dist];
const box = { x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H] };
const nodes = [
  { type: "ellipse", name: "Rim", x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, fill: inp.ink },
  { type: "ellipse", name: "Face", x: cx - r * 0.94, y: cy - r * 0.94, width: r * 1.88, height: r * 1.88, fill: inp.face },
];
let marks = "";
for (let i = 0; i < 60; i++) {
  const turn = (i / 60) * 2 * Math.PI;
  const [x1, y1] = at(turn, r * (i % 5 ? 0.86 : 0.8));
  const [x2, y2] = at(turn, r * 0.9);
  marks += `M ${x1} ${y1} L ${x2} ${y2} `;
}
nodes.push({ type: "path", name: "Marks", ...box, geometry: marks, stroke: inp.ink, strokeWidth: Math.max(1, r / 90), strokeLinecap: "round" });
if (inp.numerals) {
  for (let h = 1; h <= 12; h++) {
    const [x, y] = at((h / 12) * 2 * Math.PI, r * 0.66);
    const size = r * 0.16;
    nodes.push({ type: "text", name: "Numeral", x: x - size * (h > 9 ? 0.6 : 0.32), y: y - size * 0.62, content: String(h), fontSize: size, fontWeight: "500", fill: inp.ink });
  }
}
const s = inp.seconds % 60, m = (inp.minutes % 60) + s / 60, h = (inp.hours % 12) + m / 60;
const hand = (name, turn, length, tail, width, color) => {
  const [x1, y1] = at(turn + Math.PI, r * tail);
  const [x2, y2] = at(turn, r * length);
  nodes.push({ type: "path", name, ...box, geometry: `M ${x1} ${y1} L ${x2} ${y2}`, stroke: color, strokeWidth: width, strokeLinecap: "round" });
};
hand("Hour hand", (h / 12) * 2 * Math.PI, 0.48, 0.08, r * 0.06, inp.ink);
hand("Minute hand", (m / 60) * 2 * Math.PI, 0.74, 0.1, r * 0.04, inp.ink);
hand("Second hand", (s / 60) * 2 * Math.PI, 0.82, 0.18, Math.max(1, r * 0.015), inp.accent);
nodes.push({ type: "ellipse", name: "Pin", x: cx - r * 0.04, y: cy - r * 0.04, width: r * 0.08, height: r * 0.08, fill: inp.accent });
return nodes;
