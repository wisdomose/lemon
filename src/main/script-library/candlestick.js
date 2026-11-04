/**
 * @schema 2.11
 * @input candles: number = 48
 * @input up: color = #22C55E
 * @input down: color = #EF4444
 * @input background: color = #0B0E14
 * @input grid: color = #1F2633
 */
// A price chart: candles from a random walk, volume under them and the last price marked.
const W = pencil.width, H = pencil.height, inp = pencil.input;
const n = Math.max(5, Math.floor(inp.candles));
const volumeH = H * 0.18, chartH = H - volumeH - 16, axisW = 56;
const plotW = W - axisW;
const bars = [];
let price = 100;
for (let i = 0; i < n; i++) {
  const open = price;
  const close = open + (Math.random() - 0.48) * 4;
  const high = Math.max(open, close) + Math.random() * 2;
  const low = Math.min(open, close) - Math.random() * 2;
  bars.push({ open, close, high, low, volume: 0.3 + Math.random() * 0.7 });
  price = close;
}
const top = Math.max(...bars.map((b) => b.high)), bottom = Math.min(...bars.map((b) => b.low));
const y = (v) => 8 + ((top - v) / (top - bottom)) * (chartH - 16);
const step = plotW / n, body = Math.max(2, step * 0.6);
const nodes = [{ type: "rectangle", name: "Background", x: 0, y: 0, width: W, height: H, fill: inp.background }];
for (let g = 0; g <= 4; g++) {
  const v = bottom + ((top - bottom) * g) / 4;
  nodes.push({ type: "rectangle", name: "Grid", x: 0, y: Math.round(y(v)), width: plotW, height: 1, fill: inp.grid });
  nodes.push({ type: "text", name: "Price", x: plotW + 8, y: y(v) - 7, content: v.toFixed(2), fontSize: 10, fontFamily: "JetBrains Mono", fill: "#6B7280" });
}
bars.forEach((b, i) => {
  const color = b.close >= b.open ? inp.up : inp.down;
  const cx = i * step + step / 2;
  nodes.push({ type: "rectangle", name: "Wick", x: cx - 0.5, y: y(b.high), width: 1, height: Math.max(1, y(b.low) - y(b.high)), fill: color });
  nodes.push({ type: "rectangle", name: "Candle", x: cx - body / 2, y: y(Math.max(b.open, b.close)), width: body, height: Math.max(1, Math.abs(y(b.open) - y(b.close))), fill: color });
  const vh = b.volume * volumeH;
  nodes.push({ type: "rectangle", name: "Volume", x: cx - body / 2, y: H - vh, width: body, height: vh, fill: color + "55" });
});
const last = bars[n - 1];
const lastColor = last.close >= last.open ? inp.up : inp.down;
nodes.push({ type: "rectangle", name: "Last price line", x: 0, y: Math.round(y(last.close)), width: plotW, height: 1, fill: lastColor + "88" });
nodes.push({ type: "rectangle", name: "Last price", x: plotW + 2, y: y(last.close) - 9, width: axisW - 4, height: 18, cornerRadius: 3, fill: lastColor });
nodes.push({ type: "text", name: "Last price value", x: plotW + 7, y: y(last.close) - 7, content: last.close.toFixed(2), fontSize: 10, fontWeight: "600", fontFamily: "JetBrains Mono", fill: "#FFFFFF" });
return nodes;
