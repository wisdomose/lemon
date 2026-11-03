// The scripts that come with Lemon ("Choose a style" → Scripts): .js files in src/main/script-library,
// each inserted on the canvas as a script node of this size. Lemon's own, written for it.
export interface LibraryScript {
  id: string;
  name: string;
  width: number;
  height: number;
}

export const SCRIPTS: LibraryScript[] = [
  { id: "candlestick", name: "Candlestick", width: 560, height: 320 },
  { id: "area-chart", name: "Area Chart", width: 560, height: 320 },
  { id: "circle-text", name: "Circle Text", width: 320, height: 320 },
  { id: "clock", name: "Clock", width: 320, height: 320 },
  { id: "gauge", name: "Gauge", width: 360, height: 240 },
  { id: "spectrum", name: "Spectrum", width: 560, height: 320 },
  { id: "flow-field", name: "Flow Field", width: 560, height: 320 },
  { id: "radar", name: "Radar", width: 320, height: 320 },
];
