// "Choose a style" → Shaders, laid out as Pen's (3 Nov 2026): two shaders to a row, each a large card of
// its example and four of its looks. Each card is the shader itself, drawn here with WebGL. Hovering a
// card shows Pen's four actions: use its example, add it as a fill or an effect of the selection, or copy
// it as a fill.
import { useEffect, useRef, useState } from "react";
import { SHADERS, shaderEntry, shaderExample, type LibraryShader, type ShaderLook } from "../../agent/shader-library.js";
import { ShaderRunner } from "../canvas/shader-gl.js";
import { sdf } from "../canvas/shaders.js";
import { pageInView } from "../canvas/canvas.js";
import { bridge } from "../bridge.js";
import { doc, edit } from "../scene.js";
import * as docStore from "../../doc/store.js";
import { ROOT_ID, type Fill } from "../../doc/schema.js";
import { store, useEditor } from "../store.js";

const SOURCES = import.meta.glob<string>("../../main/shader-library/*.glsl", { eager: true, query: "?raw", import: "default" });
const sourceOf = (id: string) => SOURCES[`../../main/shader-library/${id}.glsl`] ?? "";

let runner: ShaderRunner | undefined;

/** What an effect works on in a card, and what glass sees behind it: a small poster. */
function samplePicture(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#fde68a");
  grad.addColorStop(0.55, "#f472b6");
  grad.addColorStop(1, "#6366f1");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#facc15";
  g.beginPath();
  g.arc(w * 0.78, h * 0.32, h * 0.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#111827";
  g.font = `900 ${Math.round(h * 0.42)}px Inter, sans-serif`;
  g.fillText("Aa", w * 0.08, h * 0.72);
  return c;
}

/** One card: the shader with one look, drawn once at the card's size. */
function ShaderPicture({ shader, look, width, height }: { shader: LibraryShader; look: ShaderLook; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const out = ref.current;
    if (!out) return;
    runner ??= new ShaderRunner();
    const scale = Math.min(2, devicePixelRatio || 1);
    const sample = samplePicture(Math.round(width * scale), Math.round(height * scale));
    // The card's shape (rounded like the card) for shaders that read their outline.
    const shape = document.createElement("canvas");
    shape.width = sample.width;
    shape.height = sample.height;
    const sg = shape.getContext("2d")!;
    sg.fillStyle = "#fff";
    sg.beginPath();
    sg.roundRect(0, 0, shape.width, shape.height, 24 * scale);
    sg.fill();
    const field = sdf({ width: shape.width, height: shape.height, data: sg.getImageData(0, 0, shape.width, shape.height).data }, { x: 0, y: 0, w: width, h: height });
    const result = runner.run(sourceOf(shader.id), { width, height, scale, time: 2, values: look.uniforms, textures: (name) => (name === "sdf" ? field : name.startsWith("pencil:") ? sample : null) });
    out.width = runner.canvas.width;
    out.height = runner.canvas.height;
    if (result.ok) out.getContext("2d")!.drawImage(runner.canvas, 0, 0);
  }, [shader, look, width, height]);
  return <canvas ref={ref} className="block h-full w-full rounded-[6px]" />;
}

/** Puts the shader's file beside this one: its url, or null (and says why). */
async function placed(shader: LibraryShader): Promise<string | null> {
  const r = await bridge.placeShader(shader.id);
  if ("error" in r) {
    window.alert(r.error);
    return null;
  }
  return r.url;
}

const listOf = <T,>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** Pen's four actions on a shader card; true when the gallery should close. */
async function act(action: "example" | "fill" | "effect" | "copy", shader: LibraryShader, look: ShaderLook): Promise<boolean> {
  if (action === "copy") {
    // The fill as the .pen file writes it, its file where "Use" or "Add" would put it.
    await navigator.clipboard.writeText(JSON.stringify(shaderEntry(`shaders/${shader.id}.glsl`, look), null, 2));
    return false;
  }
  const url = await placed(shader);
  if (!url) return false;
  const selection = store.get().selection;
  if (action === "example") {
    const v = pageInView();
    const node = shaderExample(shader, url);
    const w = Number(node.width);
    const h = Number(node.height);
    let id = "";
    edit(() => {
      id = docStore.insert(doc, ROOT_ID, { ...node, x: Math.round(v.x + v.w / 2 - w / 2), y: Math.round(v.y + v.h / 2 - h / 2) });
    });
    store.set({ selection: [id], tool: "move" });
    return true;
  }
  const entry = shaderEntry(url, look);
  edit(() => {
    for (const id of selection) {
      const p = docStore.propsOf(doc, id);
      if (action === "fill") docStore.update(doc, id, { fill: [...listOf(p.fill as Fill | Fill[] | undefined), entry] });
      else docStore.update(doc, id, { effect: [...listOf(p.effect), entry] });
    }
  });
  return true;
}

function ShaderCard({ shader, look, width, height, caption, onDone }: { shader: LibraryShader; look: ShaderLook; width: number; height: number; caption: string; onDone: () => void }) {
  const [menu, setMenu] = useState(false);
  const selected = useEditor((s) => s.selection.length > 0);
  const items: { id: "example" | "fill" | "effect" | "copy"; label: string; off?: boolean }[] = [
    { id: "example", label: "Use Shader Example" },
    { id: "fill", label: "Add Shader Fill", off: !selected },
    { id: "effect", label: "Apply Shader Effect", off: !selected },
    { id: "copy", label: "Copy Fill" },
  ];
  return (
    <div>
      <div
        className="relative overflow-hidden rounded-[7px] ring-[#3b82f6] hover:ring-2"
        style={{ aspectRatio: `${width} / ${height}` }}
        onMouseEnter={() => setMenu(true)}
        onMouseLeave={() => setMenu(false)}
        title={selected ? "Apply it to the selection, or insert its editable example" : "Insert its editable example, or select something to apply it to"}
      >
        <ShaderPicture shader={shader} look={look} width={width} height={height} />
        {menu && (
          <div className="absolute top-2 left-2 flex min-w-[150px] flex-col rounded-[6px] bg-[#18181b]/90 p-1 text-[11px] text-white">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                disabled={it.off}
                onClick={() => void act(it.id, shader, look).then((close) => close && onDone())}
                className="rounded-[4px] px-2 py-[3px] text-left enabled:hover:bg-white/15 disabled:opacity-40"
              >
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">{caption}</div>
    </div>
  );
}

/** A row of shaders for the Featured tab: each one's first look. */
export function FeaturedShaders({ onDone }: { onDone: () => void }) {
  return (
    <>
      {SHADERS.map((s) => (
        <div key={s.id} className="w-[200px] shrink-0">
          <ShaderCard shader={s} look={s.looks[0]!} width={240} height={150} caption={s.name} onDone={onDone} />
        </div>
      ))}
    </>
  );
}

export function ShaderGallery({ onDone }: { onDone: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-[56px] gap-y-[44px] px-[48px] pt-[28px] pb-16">
      {SHADERS.map((s) => (
        <section key={s.id}>
          <h3 className="mb-4 text-[26px] leading-8 font-semibold text-foreground">{s.name}</h3>
          <div className="grid grid-cols-[1.85fr_1fr_1fr] gap-x-3 gap-y-3">
            <div className="row-span-2">
              <ShaderCard shader={s} look={s.looks[0]!} width={480} height={300} caption={`In use / ${s.example}`} onDone={onDone} />
            </div>
            {s.looks.map((look, i) => (
              <ShaderCard key={i} shader={s} look={look} width={240} height={150} caption={look.label} onDone={onDone} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
