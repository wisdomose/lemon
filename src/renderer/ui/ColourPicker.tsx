// The colour picker: solid colours (saturation/brightness square, hue and transparency bars, channel
// fields) and linear gradients (stops). Layout measured from the reference captures 13 and 16.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Blinds, ChevronDown, Droplet, Image as ImageIcon, Minus, Pipette, Plus, SquareActivity, SquareSquare } from "lucide-react";
import type { LinearGradient, Paint } from "../../doc/schema.js";
import { parseColor } from "../../doc/values.js";
import { cx } from "./kit.js";

// ---- Colour maths ---------------------------------------------------------------------------------
type HSVA = { h: number; s: number; v: number; a: number };

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}
const to255 = (x: number) => Math.round(x * 255);
const hex2 = (x: number) => to255(x).toString(16).padStart(2, "0");

export function toHsva(colour: string): HSVA {
  try {
    const [r, g, b, a] = parseColor(colour);
    const [h, s, v] = rgbToHsv(r, g, b);
    return { h, s, v, a };
  } catch {
    return { h: 0, s: 0, v: 0, a: 1 };
  }
}
export function toHex({ h, s, v, a }: HSVA): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a) : ""}`.toUpperCase();
}

// ---- Pieces ---------------------------------------------------------------------------------------
const FIELD = "flex h-6 min-w-0 items-center rounded-md bg-field px-2 text-[11px] text-foreground";

function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return {
    ref,
    onPointerDown: (e: RPointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handle(e);
    },
    onPointerMove: (e: RPointerEvent) => e.buttons === 1 && handle(e),
  };
}

/** Chromium's built-in screen colour picker (available in Electron). */
const eyeDropper = (globalThis as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;

const CHECKER = "repeating-conic-gradient(#808080 0 25%, #c0c0c0 0 50%) 0 0 / 8px 8px";

function Solid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [hsva, setHsva] = useState(() => toHsva(value));
  useEffect(() => {
    if (toHex(hsva) !== value.toUpperCase()) setHsva(toHsva(value));
  }, [value]);
  const update = (p: Partial<HSVA>) => {
    const next = { ...hsva, ...p };
    setHsva(next);
    onChange(toHex(next));
  };
  const sv = useDrag((x, y) => update({ s: x, v: 1 - y }));
  const hue = useDrag((x) => update({ h: x * 360 }));
  const alpha = useDrag((x) => update({ a: Math.round(x * 100) / 100 }));
  const [r, g, b] = hsvToRgb(hsva.h, hsva.s, hsva.v).map(to255) as [number, number, number];
  const pure = `hsl(${hsva.h} 100% 50%)`;
  const opaque = toHex({ ...hsva, a: 1 });
  return (
    <div className="px-3 pt-3 pb-3">
      <div
        {...sv}
        className="relative h-[194px] cursor-crosshair rounded-[4px]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: opaque }}
        />
      </div>
      <div {...hue} className="relative mt-[6px] h-4 rounded-full" style={{ background: "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)" }}>
        <Knob at={hsva.h / 360} colour={pure} />
      </div>
      <div {...alpha} className="relative mt-[6px] h-4 rounded-full" style={{ background: `linear-gradient(to right, transparent, ${opaque}), ${CHECKER}` }}>
        <Knob at={hsva.a} colour={opaque} />
      </div>
      <div className="mt-[11px] flex items-center gap-[6px]">
        <button
          type="button"
          aria-label="Pick a colour from the screen"
          disabled={!eyeDropper}
          onClick={async () => {
            const r = await new eyeDropper!().open().catch(() => undefined);
            if (r) onChange(r.sRGBHex.toUpperCase());
          }}
          className={cx(FIELD, "w-6 justify-center px-0 disabled:opacity-40")}
        >
          <Pipette size={12} strokeWidth={1.5} />
        </button>
        <div className={cx(FIELD, "w-[60px] gap-1")}>
          RGBA <ChevronDown size={12} strokeWidth={1.5} className="ml-auto" />
        </div>
      </div>
      <div className="mt-[11px] grid grid-cols-4 gap-[6px]">
        {[r, g, b].map((n, i) => (
          <Channel key={i} value={n} max={255} onCommit={(x) => {
            const rgb = [r, g, b];
            rgb[i] = x;
            const [h, s, v] = rgbToHsv(rgb[0]! / 255, rgb[1]! / 255, rgb[2]! / 255);
            update({ h, s, v });
          }} />
        ))}
        <Channel value={hsva.a} max={1} step onCommit={(x) => update({ a: x })} />
      </div>
    </div>
  );
}

function Knob({ at, colour }: { at: number; colour: string }) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
      style={{ left: `${at * 100}%`, background: colour }}
    />
  );
}

function Channel({ value, max, step, suffix = "", onCommit }: { value: number; max: number; step?: boolean; suffix?: string; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value) + suffix);
  useEffect(() => setText(String(value) + suffix), [value, suffix]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseFloat(text);
        if (Number.isFinite(n)) onCommit(Math.max(0, Math.min(max, step ? n : Math.round(n))));
        else setText(String(value) + suffix);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className={cx(FIELD, "w-full outline-none")}
    />
  );
}

function Gradient({ value, onChange }: { value: LinearGradient; onChange: (g: LinearGradient) => void }) {
  const stops = [...value.stops].sort((a, b) => a.at - b.at);
  const css = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${s.at * 100}%`).join(", ")})`;
  const setStop = (i: number, patch: Partial<{ color: string; at: number }>) =>
    onChange({ ...value, stops: stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="px-3 pt-3 pb-3">
      <div className={cx(FIELD, "w-full gap-1")}>
        Linear <ChevronDown size={12} strokeWidth={1.5} className="ml-auto" />
      </div>
      <div className="relative mt-4 h-6 rounded-[4px]" style={{ background: `${css}, ${CHECKER}` }}>
        {stops.map((s, i) => (
          <span
            key={i}
            className="absolute top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-white shadow"
            style={{ left: `${s.at * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="mt-3 flex h-5 items-center text-[11px] font-semibold text-foreground">
        Stops
        <button
          type="button"
          aria-label="Add stop"
          className="ml-auto text-muted-foreground"
          onClick={() => onChange({ ...value, stops: [...stops, { color: "#808080", at: 0.5 }] })}
        >
          <Plus size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-[6px] space-y-[6px]">
        {stops.map((s, i) => {
          const hsva = toHsva(s.color);
          return (
            <div key={i} className="flex items-center gap-[6px]">
              <Channel value={Math.round(s.at * 100)} max={100} suffix="%" onCommit={(n) => setStop(i, { at: n / 100 })} />
              <div className={cx(FIELD, "w-[96px] shrink-0 gap-1.5 px-1")}>
                <span className="h-4 w-4 shrink-0 rounded-[3px] border border-input" style={{ background: s.color }} />
                {toHex({ ...hsva, a: 1 }).slice(1)}
              </div>
              <div className={cx(FIELD, "w-[56px] shrink-0 justify-between")}>
                {Math.round(hsva.a * 100)} <span className="text-muted-foreground">%</span>
              </div>
              <button
                type="button"
                aria-label="Remove stop"
                disabled={stops.length <= 2}
                className="text-muted-foreground"
                onClick={() => onChange({ ...value, stops: stops.filter((_, j) => j !== i) })}
              >
                <Minus size={16} strokeWidth={1.5} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The picker's body for a fill: tabs (solid, gradient, image, shader), blend icon, then the editor. */
export function ColourPicker({ value, onChange, allowGradient = true }: { value: Paint; onChange: (p: Paint) => void; allowGradient?: boolean }) {
  const isGradient = typeof value !== "string";
  const tabs = [
    { icon: SquareSquare, label: "Solid", on: !isGradient, enabled: true, pick: () => isGradient && onChange(value.stops[0]?.color ?? "#000000") },
    {
      icon: Blinds,
      label: "Gradient",
      on: isGradient,
      enabled: allowGradient,
      pick: () => !isGradient && onChange({ type: "linear", angle: 90, stops: [{ color: "#000000", at: 0 }, { color: "#FFFFFF", at: 1 }] }),
    },
    { icon: ImageIcon, label: "Image (not available yet)", on: false, enabled: false, pick: () => {} },
    { icon: SquareActivity, label: "Shader (not available yet)", on: false, enabled: false, pick: () => {} },
  ];
  return (
    <div className="w-[262px]">
      <div className="flex items-center gap-2 border-b border-line px-3 pt-3 pb-3">
        <div className="flex h-6 flex-1 rounded-md bg-field p-px">
          {tabs.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.label}
              aria-label={t.label}
              disabled={!t.enabled}
              onClick={t.pick}
              className={cx("flex flex-1 items-center justify-center rounded-[5px] text-foreground disabled:opacity-40", t.on && "bg-seg-active")}
            >
              <t.icon size={13} strokeWidth={1.5} />
            </button>
          ))}
        </div>
        <Droplet size={14} strokeWidth={1.5} className="text-muted-foreground" aria-label="Blend mode" />
      </div>
      {isGradient ? <Gradient value={value} onChange={onChange} /> : <Solid value={value} onChange={onChange} />}
    </div>
  );
}
