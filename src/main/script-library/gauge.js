/**
 * @schema 2.11
 * @input value: number = 72
 * @input max: number = 100
 * @input label: string = "Battery health"
 * @input unit: string = "%"
 * @input track: color = #E4E4E7
 * @input low: color = #F97316
 * @input high: color = #10B981
 */
// A half-round gauge: the filled arc shows the value, coloured from low to high.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const r = Math.min(W / 2, H * 0.8) - 4, cx = W / 2, cy = Math.min(H - 4, r + 8 + H * 0.05);
const share = Math.max(0, Math.min(1, inp.value / (inp.max || 1)));
const ring = { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, innerRadius: 0.78 };
const nodes = [
  // Arcs are measured counter-clockwise from the right: the half from the left (180°) round the top.
  { type: "ellipse", name: "Track", ...ring, startAngle: 180, sweepAngle: -180, fill: inp.track },
  {
    type: "ellipse",
    name: "Value",
    ...ring,
    startAngle: 180,
    sweepAngle: -180 * share,
    fill: { type: "gradient", gradientType: "linear", rotation: 90, colors: [{ color: inp.low, position: 0 }, { color: inp.high, position: 1 }] },
  },
];
for (let i = 0; i <= 10; i++) {
  const turn = Math.PI - (i / 10) * Math.PI;
  const x1 = cx + Math.cos(turn) * r * 0.7, y1 = cy - Math.sin(turn) * r * 0.7;
  const x2 = cx + Math.cos(turn) * r * (i % 5 ? 0.66 : 0.62), y2 = cy - Math.sin(turn) * r * (i % 5 ? 0.66 : 0.62);
  nodes.push({ type: "path", name: "Tick", x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H], geometry: `M ${x1} ${y1} L ${x2} ${y2}`, stroke: "#A1A1AA", strokeWidth: 1.5, strokeLinecap: "round" });
}
const size = r * 0.34;
const shown = `${Math.round(inp.value)}${inp.unit}`;
nodes.push({ type: "text", name: "Reading", x: cx - shown.length * size * 0.29, y: cy - size * 1.15, content: shown, fontSize: size, fontWeight: "700", fill: "#18181B" });
nodes.push({ type: "text", name: "Label", x: cx - inp.label.length * r * 0.032, y: cy - size * 0.05, content: inp.label, fontSize: r * 0.11, fill: "#71717A" });
return nodes;
