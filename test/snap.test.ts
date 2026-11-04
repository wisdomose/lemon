// Snapping while moving (src/renderer/canvas/snap.ts).
import { describe, expect, it } from "vitest";
import { snapBox } from "../src/renderer/canvas/snap.js";

describe("snapping a moved box", () => {
  const frame = { x: 0, y: 0, w: 800, h: 600 };
  it("centres in its parent when close, with a guide across the parent each way (capture 35)", () => {
    const s = snapBox({ x: 306, y: 229, w: 185, h: 145 }, [frame], 5);
    expect([s.dx, s.dy]).toEqual([1.5, -1.5]);
    expect(s.guides).toEqual([
      { x1: 400, y1: 0, x2: 400, y2: 600 },
      { x1: 0, y1: 300, x2: 800, y2: 300 },
    ]);
  });
  it("lines up with a sibling's edge, and leaves a far box alone", () => {
    const sibling = { x: 100, y: 700, w: 200, h: 50 };
    const s = snapBox({ x: 103, y: 900, w: 50, h: 50 }, [sibling], 5);
    expect([s.dx, s.dy]).toEqual([-3, 0]);
    expect(s.guides).toEqual([{ x1: 100, y1: 700, x2: 100, y2: 950 }]);
    expect(snapBox({ x: 120, y: 900, w: 50, h: 50 }, [sibling], 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
