/**
 * @schema 2.11
 * @input points: number = 12
 * @input first: color = #6366F1
 * @input second: color = #14B8A6
 * @input background: color = #FFFFFF
 * @input labels: boolean = true
 */
// Two series as soft areas over a light grid, with month labels and a small key.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const n = Math.max(3, Math.floor(inp.points));
const left = 36, right = 12, topPad = 32, bottomPad = inp.labels ? 28 : 12;
const pw = W - left - right, ph = H - topPad - bottomPad;
const series = (base, swing) => {
  const out = [];
  let v = base;
  for (let i = 0; i < n; i++) {
    v = Math.min(0.95, Math.max(0.08, v + (Math.random() - 0.5) * swing));
    out.push(v);
  }
  return out;
};
const a = series(0.55, 0.3), b = series(0.3, 0.22);
const px = (i) => left + (pw * i) / (n - 1);
const py = (v) => topPad + ph * (1 - v);
// A smooth line through the points (Catmull-Rom as cubic Béziers).
const curve = (vals) => {
  let d = `M ${px(0)} ${py(vals[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = vals[Math.max(0, i - 1)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(n - 1, i + 2)];
    const s = (pw / (n - 1)) / 6;
    d += ` C ${px(i) + s} ${py(p1 + (p2 - p0) / 6)} ${px(i + 1) - s} ${py(p2 - (p3 - p1) / 6)} ${px(i + 1)} ${py(p2)}`;
  }
  return d;
};
const area = (vals) => `${curve(vals)} L ${px(n - 1)} ${topPad + ph} L ${px(0)} ${topPad + ph} Z`;
const box = { x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H] };
const fade = (c) => ({ type: "gradient", gradientType: "linear", colors: [{ color: c + "66", position: 0 }, { color: c + "05", position: 1 }] });
const nodes = [{ type: "rectangle", name: "Background", x: 0, y: 0, width: W, height: H, fill: inp.background }];
for (let g = 0; g <= 4; g++) {
  const gy = topPad + (ph * g) / 4;
  nodes.push({ type: "rectangle", name: "Grid", x: left, y: Math.round(gy), width: pw, height: 1, fill: "#E5E7EB" });
  nodes.push({ type: "text", name: "Value", x: 4, y: gy - 6, content: String(100 - g * 25), fontSize: 9, fill: "#9CA3AF" });
}
nodes.push({ type: "path", name: "First area", ...box, geometry: area(a), fill: fade(inp.first) });
nodes.push({ type: "path", name: "Second area", ...box, geometry: area(b), fill: fade(inp.second) });
nodes.push({ type: "path", name: "First line", ...box, geometry: curve(a), stroke: inp.first, strokeWidth: 2, strokeLinecap: "round" });
nodes.push({ type: "path", name: "Second line", ...box, geometry: curve(b), stroke: inp.second, strokeWidth: 2, strokeLinecap: "round" });
if (inp.labels) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 0; i < n; i += Math.ceil(n / 8)) nodes.push({ type: "text", name: "Label", x: px(i) - 9, y: H - 20, content: months[i % 12], fontSize: 9, fill: "#9CA3AF" });
}
[["Revenue", inp.first], ["Costs", inp.second]].forEach(([label, c], i) => {
  nodes.push({ type: "ellipse", name: "Key", x: left + i * 84, y: 11, width: 8, height: 8, fill: c });
  nodes.push({ type: "text", name: "Key label", x: left + 13 + i * 84, y: 8, content: label, fontSize: 10, fill: "#4B5563" });
});
return nodes;
