/**
 * @schema 2.11
 * @input lines: number = 600
 * @input length: number = 40
 * @input scale: number = 3
 * @input ink: color = #A5B4FC
 * @input background: color = #0F0B2E
 */
// Strokes that drift along an invisible current, like iron filings or wind on a map.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const count = Math.max(1, Math.floor(inp.lines)), steps = Math.max(2, Math.floor(inp.length));
const k = inp.scale / Math.max(W, H);
// The current's direction at a point: a few waves added together, smooth everywhere.
const angle = (x, y) => Math.sin(x * k * 2.1) * 1.7 + Math.cos(y * k * 2.7) * 1.3 + Math.sin((x + y) * k * 1.3) * 0.9;
const nodes = [{ type: "rectangle", name: "Background", x: 0, y: 0, width: W, height: H, fill: inp.background }];
let ink = "";
let glow = "";
for (let i = 0; i < count; i++) {
  let x = Math.random() * W, y = Math.random() * H;
  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
  for (let s = 0; s < steps; s++) {
    const a = angle(x, y);
    x += Math.cos(a) * 2;
    y += Math.sin(a) * 2;
    if (x < 0 || y < 0 || x > W || y > H) break;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  if (i % 7 === 0) glow += d + " ";
  else ink += d + " ";
}
const box = { x: 0, y: 0, width: W, height: H, viewBox: [0, 0, W, H] };
nodes.push({ type: "path", name: "Strokes", ...box, geometry: ink, stroke: inp.ink + "70", strokeWidth: 0.8, strokeLinecap: "round" });
nodes.push({ type: "path", name: "Bright strokes", ...box, geometry: glow, stroke: "#FFFFFF", strokeWidth: 1, strokeLinecap: "round" });
return nodes;
