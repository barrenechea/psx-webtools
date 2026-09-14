import { Badge } from "@/components/ui/badge";
import PS1BlockIcon from "@/components/ui/ps1-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TempBuffer } from "@/hooks/use-memory-card-workspace";

import { Ps2IconView } from "./ps2-icon-view";

interface CardContentHeaderProps {
  name: string;
  type: string;
  kind: "ps1" | "ps2";
  source: string;
  checksum: string;
  tempBuffer: TempBuffer;
  badBlocks?: number[];
}

export const CardContentHeader: React.FC<CardContentHeaderProps> = ({
  name,
  type,
  kind,
  source,
  checksum,
  tempBuffer,
  badBlocks = [],
}) => {
  const ps1Buffer = tempBuffer?.kind === "ps1" ? tempBuffer : null;
  const ps2Buffer = tempBuffer?.kind === "ps2" ? tempBuffer : null;
  const bufferedIcon =
    kind === "ps2"
      ? ps2Buffer && (
          <Ps2IconView save={ps2Buffer.info} className="size-8 rounded-sm" />
        )
      : ps1Buffer &&
        ps1Buffer.slots.length > 0 && (
          <>
            <PS1BlockIcon
              iconData={ps1Buffer.icon.data}
              iconPalette={ps1Buffer.icon.palette}
              iconFrameCount={ps1Buffer.icon.frameCount}
            />
            {ps1Buffer.slots.length > 1 && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                {ps1Buffer.slots.length}
              </span>
            )}
          </>
        );
  return (
    <div className="flex items-center justify-between border-b border-border bg-muted/80 p-4 px-6">
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          {name}
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
          >
            {kind === "ps2" ? "PS2" : "PS1"}
          </Badge>
          {kind === "ps2" && badBlocks.length > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={(props) => (
                  <Badge variant="outline" className="text-[10px]" {...props}>
                    {badBlocks.length} bad block
                    {badBlocks.length === 1 ? "" : "s"}
                  </Badge>
                )}
              />
              <TooltipContent>
                <p>The filesystem skips erase blocks {badBlocks.join(", ")}.</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </h2>
        <p className="text-sm text-muted-foreground">
          {type === "new" ? "New card" : `Opened via ${type} "${source}"`}
        </p>
        <Tooltip>
          <TooltipTrigger className="mt-1 font-mono text-xs tracking-wider text-muted-foreground">
            CRC-32 {checksum}
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {kind === "ps2"
                ? "ECC spares are not included."
                : "GME comments are not included."}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <div {...props} className="flex items-center">
              {bufferedIcon ? (
                <div className="group relative">
                  <div className="absolute -inset-0.5 animate-tilt rounded-lg bg-linear-to-r from-pink-600 to-purple-600 opacity-75 blur-sm transition duration-1000 group-hover:opacity-100 group-hover:duration-200 motion-reduce:animate-none motion-reduce:transition-none" />
                  <div className="relative size-8">{bufferedIcon}</div>
                </div>
              ) : (
                <div className="size-8 rounded-sm border-2 border-dashed border-muted-foreground" />
              )}
            </div>
          )}
        />
        <TooltipContent>
          <p>Temporary Buffer</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};
