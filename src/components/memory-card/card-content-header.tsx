import PS1BlockIcon from "@/components/ui/ps1-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type PS1MemoryCard from "@/lib/ps1-memory-card";
import type { SaveInfo } from "@/lib/ps1-memory-card";

interface CardContentHeaderProps {
  card: PS1MemoryCard;
  name: string;
  type: string;
  source: string;
  copiedSlots: SaveInfo[];
}

export const CardContentHeader: React.FC<CardContentHeaderProps> = ({
  card,
  name,
  type,
  source,
  copiedSlots,
}) => (
  <div className="border-border bg-muted/80 flex items-center justify-between border-b p-4 px-6">
    <div>
      <h2 className="mb-1 text-lg font-semibold">{name}</h2>
      <p className="text-muted-foreground text-sm">
        {`Opened via ${type} "${source}"`}
      </p>
    </div>
    <TooltipProvider>
      <Tooltip delayDuration={100}>
        <TooltipTrigger>
          <div className="flex items-center">
            {copiedSlots.length > 0 ? (
              <div className="group relative">
                <div className="animate-tilt absolute -inset-0.5 rounded-lg bg-linear-to-r from-pink-600 to-purple-600 opacity-75 blur-sm transition duration-1000 group-hover:opacity-100 group-hover:duration-200" />
                <div className="relative size-8">
                  <PS1BlockIcon
                    iconData={card.getIconData(copiedSlots[0].slotNumber)}
                    iconPalette={card.getIconPalette(copiedSlots[0].slotNumber)}
                    iconFrameCount={copiedSlots[0].iconFrameCount}
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
    </TooltipProvider>
  </div>
);
