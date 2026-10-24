// The two top-bar islands: product and file on the left; share, present and account on the right.
// Positions measured from the reference captures (8px from the window edges, 42px tall).
import { ChevronDown, Folder, Gift, Globe, LayoutGrid, Play, Share } from "lucide-react";
import { PRODUCT } from "../../product.js";
import logoUrl from "../../../assets/logo.svg?url";
import { Divider, ICON, IconButton, Island, Tip } from "../ui/kit.js";

export function TopBar({ fileName, saveState, initial }: { fileName: string; saveState: string; initial: string }) {
  return (
    <>
      <Island className="absolute left-2 top-2 flex h-[42px] items-center rounded-full pr-4 pl-3">
        <div className="flex items-center gap-[5px] pr-3">
          <img src={logoUrl} alt="" className="h-4 w-4" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#f4f4f5]">{PRODUCT.name}</span>
        </div>
        <Tip label="Dashboard" keys="Ctrl N">
          <IconButton icon={LayoutGrid} aria-label="Dashboard" />
        </Tip>
        <Divider className="mx-2" />
        <div className="flex items-center gap-2 pl-1">
          <Folder {...ICON} className="text-foreground" />
          <span className="text-[14px] font-semibold text-[#e4e4e7]">{fileName}</span>
          <span className="-ml-2 text-[14px] text-muted-foreground">— {saveState}</span>
        </div>
      </Island>

      <Island className="absolute right-2 top-2 flex h-[42px] items-center gap-1 rounded-full pr-[18px] pl-[15px]">
        <button type="button" className="flex h-7 items-center gap-1.5 rounded-md pr-0 pl-[5px] text-[14px] text-foreground hover:bg-white/5">
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
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-[12px] font-semibold text-[#e4e4e7]">
          {initial}
        </span>
        <span className="ml-0.5 flex h-[23px] items-center gap-1.5 rounded-full border border-white/10 pr-2 pl-2.5 text-[13px] font-semibold text-[#e4e4e7]">
          Free <span className="h-[7px] w-[7px] rounded-full bg-amber-500" />
        </span>
        <ChevronDown size={14} strokeWidth={1.5} className="text-muted-foreground" />
      </Island>
    </>
  );
}
