/**
 * @schema 2.11
 * @input sweep: number = 40
 * @input blips: number = 7
 * @input phosphor: color = #4ADE80
 * @input background: color = #031A0B
 */
// A radar screen: range rings, a fading sweep and the contacts it has just passed.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const r = Math.min(W, H) / 2 - 2, cx = W / 2, cy = H / 2;
const c = inp.phosphor;
const box = { x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H] };
const nodes = [{ type: "ellipse", name: "Screen", x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, fill: inp.background, stroke: c + "88", strokeWidth: 2 }];
for (let i = 1; i <= 3; i++) {
  const rr = (r * i) / 4;
  nodes.push({ type: "ellipse", name: "Range ring", x: cx - rr, y: cy - rr, width: 2 * rr, height: 2 * rr, stroke: c + "40", strokeWidth: 1 });
}
nodes.push({ type: "path", name: "Cross", ...box, geometry: `M ${cx - r} ${cy} L ${cx + r} ${cy} M ${cx} ${cy - r} L ${cx} ${cy + r}`, stroke: c + "40", strokeWidth: 1 });
// The sweep: a wedge ending at the beam, faded behind it (angles counter-clockwise from the right).
const beam = inp.sweep;
nodes.push({
  type: "ellipse",
  name: "Sweep",
  x: cx - r,
  y: cy - r,
  width: 2 * r,
  height: 2 * r,
  startAngle: beam,
  sweepAngle: 70,
  fill: { type: "gradient", gradientType: "angular", rotation: -beam, colors: [{ color: c + "00", position: 0.6 }, { color: c + "88", position: 1 }] },
});
const tip = (beam * Math.PI) / 180;
nodes.push({ type: "path", name: "Beam", ...box, geometry: `M ${cx} ${cy} L ${cx + Math.cos(tip) * r} ${cy - Math.sin(tip) * r}`, stroke: c, strokeWidth: 2, strokeLinecap: "round" });
for (let i = 0; i < Math.floor(inp.blips); i++) {
  // Contacts behind the beam glow brighter the more recently it passed them.
  const behind = Math.random() * 300;
  const a = ((beam + behind) * Math.PI) / 180;
  const d = r * (0.2 + Math.random() * 0.72);
  const glow = Math.max(0.15, 1 - behind / 300);
  const size = 4 + glow * 4;
  const x = cx + Math.cos(a) * d, y = cy - Math.sin(a) * d;
  const alpha = Math.round(glow * 255).toString(16).padStart(2, "0");
  nodes.push({ type: "ellipse", name: "Contact", x: x - size, y: y - size, width: size * 2, height: size * 2, fill: c + Math.round(glow * 60).toString(16).padStart(2, "0") });
  nodes.push({ type: "ellipse", name: "Contact core", x: x - 2.5, y: y - 2.5, width: 5, height: 5, fill: c + alpha });
}
return nodes;
