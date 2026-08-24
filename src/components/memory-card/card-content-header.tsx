import PS1BlockIcon from "@/components/ui/ps1-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  IconPalette,
  SaveInfo,
  SlotIconData,
} from "@/lib/ps1-memory-card";

interface CardContentHeaderProps {
  name: string;
  type: string;
  source: string;
  checksum: string;
  copiedSlots: SaveInfo[];
  copiedIcon: {
    data: SlotIconData;
    palette: IconPalette;
    frameCount: number;
  } | null;
}

export const CardContentHeader: React.FC<CardContentHeaderProps> = ({
  name,
  type,
  source,
  checksum,
  copiedSlots,
  copiedIcon,
}) => (
  <div className="border-border bg-muted/80 flex items-center justify-between border-b p-4 px-6">
    <div>
      <h2 className="mb-1 text-lg font-semibold">{name}</h2>
      <p className="text-muted-foreground text-sm">
        {type === "new" ? "New card" : `Opened via ${type} "${source}"`}
      </p>
      <Tooltip>
        <TooltipTrigger className="text-muted-foreground mt-1 font-mono text-xs tracking-wider">
          CRC-32 {checksum}
        </TooltipTrigger>
        <TooltipContent>
          <p>GME comments are not included.</p>
        </TooltipContent>
      </Tooltip>
    </div>
    <Tooltip>
      <TooltipTrigger>
        <div className="flex items-center">
          {copiedSlots.length > 0 && copiedIcon ? (
            <div className="group relative">
              <div className="animate-tilt absolute -inset-0.5 rounded-lg bg-linear-to-r from-pink-600 to-purple-600 opacity-75 blur-sm transition duration-1000 group-hover:opacity-100 group-hover:duration-200" />
              <div className="relative size-8">
                <PS1BlockIcon
                  iconData={copiedIcon.data}
                  iconPalette={copiedIcon.palette}
                  iconFrameCount={copiedIcon.frameCount}
                />
                {copiedSlots.length > 1 && (
                  <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full text-[10px]">
                    {copiedSlots.length}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="border-muted-foreground size-8 rounded-sm border-2 border-dashed" />
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>Temporary Buffer</p>
      </TooltipContent>
    </Tooltip>
  </div>
);
