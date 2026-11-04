// Web addresses in a message the person sent, shown as Pen shows them: a globe and the address as a
// link, which opens a menu — on the canvas (a browser node), in the sidebar, or in the system browser.
import { DropdownMenu as M } from "radix-ui";
import { ExternalLink, Frame, Globe, PanelRight } from "lucide-react";
import { ROOT_ID } from "../../doc/schema.js";
import * as docStore from "../../doc/store.js";
import { emptySpot } from "../../layout/space.js";
import { zoomToFit } from "../canvas/canvas.js";
import { bridge, currentScene, doc, edit } from "../scene.js";
import { store } from "../store.js";
import { MenuContent, MenuItem } from "../ui/menu.js";
import { openInSidebar } from "../chrome/BrowserSidebar.js";
import { linkify } from "./linkify.js";

/** A message's text with its addresses as link chips. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((part, i) => (typeof part === "string" ? <span key={i}>{part}</span> : <LinkChip key={i} url={part.url} />))}
    </>
  );
}

function LinkChip({ url }: { url: string }) {
  const icon = (I: typeof Globe) => <I size={14} strokeWidth={1.5} className="text-muted-foreground" />;
  return (
    <M.Root>
      <M.Trigger asChild>
        <button type="button" className="inline-flex items-center gap-[2px] text-[#4FA0FF]">
          <Globe size={12} strokeWidth={2} className="shrink-0" />
          <span className="underline decoration-[#30528A] underline-offset-[3px]">{url}</span>
        </button>
      </M.Trigger>
      <MenuContent align="start">
        <MenuItem icon={icon(Frame)} label="Open on canvas" onSelect={() => openOnCanvas(url)} />
        <MenuItem icon={icon(PanelRight)} label="Open in sidebar" onSelect={() => openInSidebar(url)} />
        <MenuItem icon={icon(ExternalLink)} label="Open in external browser" onSelect={() => void bridge.browser.sidebar("open-external", url)} />
      </MenuContent>
    </M.Root>
  );
}

/** As in Pen: a 1200 × 1200 browser node for the address beside what's there, selected and shown. */
function openOnCanvas(url: string): void {
  const s = currentScene();
  const at = s ? emptySpot(s.tree, s.boxes) : { x: 0, y: 0 };
  const name = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  let id = "";
  edit(() => {
    id = docStore.insert(doc, ROOT_ID, { type: "browser", name, url, x: at.x, y: at.y, width: 1200, height: 1200 } as never);
  });
  store.set({ selection: [id] });
  // Once the new node is laid out.
  requestAnimationFrame(() => {
    const box = currentScene()?.boxes.get(id);
    if (box) zoomToFit(true, box, 1);
  });
}
