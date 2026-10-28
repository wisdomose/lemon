// The two top-bar islands, as in Pen. Left: the product, Home, the open files as tabs and "+" for a new
// file. Right: share, goodies, present and the browser on a file tab, then the account. Home shows the
// same bar without the file buttons. Positions measured from the reference captures (8px from the
// window edges, 42px tall).
import { useEffect, useState } from "react";
import { ChevronDown, Folder, Gift, Globe, House, Play, Plus, Share, X } from "lucide-react";
import { PRODUCT } from "../../product.js";
import logoUrl from "../../../assets/logo.svg?url";
import type { TabInfo, Tabs } from "../../main/shell.js";
import { Divider, ICON, IconButton, Island, Tip, cx } from "../ui/kit.js";
import type { Bridge } from "../bridge.js";

/** The window's tabs, kept current. */
function useTabs(bridge: Bridge): Tabs {
  const [tabs, setTabs] = useState<Tabs>({ tabs: [], active: "home" });
  useEffect(() => {
    void bridge.tabs.get().then(setTabs);
    bridge.tabs.onChange(setTabs);
  }, [bridge]);
  return tabs;
}

export function TopBar({ bridge, initial }: { bridge: Bridge; initial: string }) {
  const { tabs, active } = useTabs(bridge);
  const home = active === "home";
  return (
    <>
      <Island data-topbar className="absolute left-2 top-2 flex h-[42px] items-center rounded-full pr-2 pl-3">
        <div className="flex items-center gap-[5px] pr-3">
          <img src={logoUrl} alt="" className="h-4 w-4" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{PRODUCT.name}</span>
        </div>
        {/* Pen's top bar has plain (native) tooltips, not the rail's pills. */}
        <IconButton icon={House} round active={home} title="Home" aria-label="Home" onClick={() => void bridge.tabs.show("home")} />
        {tabs.map((t, i) => (
          <div key={t.id} className="flex items-center">
            {/* A line between neighbours, hidden next to the tab shown. */}
            <Divider className={cx("mx-1", (t.id === active || tabs[i - 1]?.id === active || (i === 0 && home)) && "invisible")} />
            <FileTab tab={t} shown={t.id === active} bridge={bridge} />
          </div>
        ))}
        <IconButton icon={Plus} round title="New File (Ctrl⇧N)" aria-label="New File" className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => void bridge.tabs.newFile()} />
      </Island>

      <Island className="absolute right-2 top-2 flex h-[42px] items-center gap-1 rounded-full pr-[18px] pl-[15px]">
        {!home && (
          <>
            <button type="button" className="flex h-7 items-center gap-1.5 rounded-md pr-0 pl-[5px] text-[14px] text-foreground hover:bg-foreground/5">
              <Share {...ICON} /> Share
            </button>
            <Tip label="Goodies">
              <IconButton icon={Gift} aria-label="Goodies" />
            </Tip>
            <Tip label="Present" keys="Ctrl ↵">
              <IconButton icon={Play} aria-label="Present" />
            </Tip>
            <Tip label="Open a webpage and reproduce it on the canvas">
              <IconButton icon={Globe} aria-label="Browser" />
            </Tip>
            <Divider className="ml-1 mr-2" />
          </>
        )}
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-input text-[12px] font-semibold text-foreground">{initial}</span>
        <span className="ml-0.5 flex h-[23px] items-center gap-1.5 rounded-full border border-input pr-2 pl-2.5 text-[13px] font-semibold text-foreground">
          Free <span className="h-[7px] w-[7px] rounded-full bg-amber-500" />
        </span>
        <ChevronDown size={14} strokeWidth={1.5} className="text-muted-foreground" />
      </Island>
    </>
  );
}

/**
 * An open file: a folder and its name, the one shown on a lighter pill in bold. A dot says it has
 * changes not written yet; pointing at the tab turns the dot into the close button.
 */
function FileTab({ tab, shown, bridge }: { tab: TabInfo; shown: boolean; bridge: Bridge }) {
  const title = [tab.name, tab.edited && "Edited", tab.path].filter(Boolean).join("\n");
  return (
    <div
      role="tab"
      aria-selected={shown}
      title={title}
      onClick={() => void bridge.tabs.show(tab.id)}
      onAuxClick={(e) => e.button === 1 && void bridge.tabs.close(tab.id)}
      className={cx(
        "group flex h-7 cursor-default items-center gap-2 rounded-[8px] pr-2 pl-3 text-[13px]",
        shown ? "bg-tab-active font-semibold text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Folder size={14} strokeWidth={1.5} className="shrink-0" />
      <span className="max-w-[160px] truncate">{tab.name}</span>
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        {tab.edited && <span className="h-[6px] w-[6px] rounded-full bg-foreground/60 group-hover:hidden" />}
        <button
          type="button"
          aria-label={`Close ${tab.name}`}
          title=""
          onClick={(e) => (e.stopPropagation(), void bridge.tabs.close(tab.id))}
          className="absolute inset-0 hidden items-center justify-center rounded-full text-muted-foreground group-hover:flex hover:bg-foreground/10 hover:text-foreground"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </span>
    </div>
  );
}
