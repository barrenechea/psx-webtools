import { InfoIcon, XIcon } from "lucide-react";

import { GameDetailsFields } from "@/components/memory-card/game-details-sidebar";
import { Ps2IconView } from "@/components/memory-card/ps2-icon-view";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGameData } from "@/hooks/use-game-data";
import type { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { ps2SaveProductCode, ps2SaveRegion } from "@/lib/ps2/ps2-dirname";
import { displayDirentName } from "@/lib/ps2/ps2-sjis";
import type { Ps2DateTime } from "@/lib/ps2/ps2-types";
import {
  type GamePlatform,
  isGameSerial,
  regionOfProductCode,
} from "@/lib/query";
import { cn } from "@/lib/utils";

interface Ps2SaveInfoSidebarProps {
  card: PS2MemoryCard;
  saveName: string;
  onClose: () => void;
}

const pad = (n: number) => n.toString().padStart(2, "0");

const formatDate = (t: Ps2DateTime): string =>
  `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.min)}:${pad(
    t.sec,
  )}`;

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;

export const Ps2SaveInfoSidebar: React.FC<Ps2SaveInfoSidebarProps> = ({
  card,
  saveName,
  onClose,
}) => {
  const save = card.getSaves().find((s) => s.name === saveName);
  const productCode = ps2SaveProductCode(saveName);
  const region = isGameSerial(productCode)
    ? (regionOfProductCode(productCode) ?? ps2SaveRegion(saveName))
    : "";
  const platform: GamePlatform = save?.ps1 ? "ps1" : "ps2";
  const { gameData, isLoading: gameDataLoading } = useGameData(
    platform,
    region,
    productCode,
  );

  return (
    <div className="border-border bg-muted/80 flex w-80 flex-col border-l">
      <div className="flex items-center justify-between p-4">
        <div className="flex-row">
          <div className="flex flex-row items-center space-x-1">
            <p className="font-semibold">Save Info</p>
            <Tooltip>
              <TooltipTrigger
                render={(props) => (
                  <Button {...props} variant="ghost" size="icon">
                    <InfoIcon className="text-muted-foreground size-3" />
                  </Button>
                )}
              />
              <TooltipContent>
                <p>Game details provided by The PlayStation DataCenter</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground text-xs">{productCode}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <Separator />
      {save ? (
        <ScrollArea className="grow overflow-hidden">
          <div className="space-y-4 p-4">
            {gameDataLoading ? (
              <div
                className={cn(
                  "bg-muted flex items-center justify-center rounded-md",
                  platform === "ps2" ? "aspect-[1/1.49]" : "aspect-square",
                )}
              >
                <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent"></div>
              </div>
            ) : gameData ? (
              <GameDetailsFields
                gameData={gameData}
                platform={platform}
                coverFallback={
                  <Ps2IconView animate save={save} className="size-full" />
                }
              />
            ) : null}
            <div className="flex items-center gap-3">
              {gameData || gameDataLoading ? null : (
                <Ps2IconView
                  animate
                  save={save}
                  className="size-12 shrink-0 rounded-md"
                />
              )}
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold">{save.title}</h4>
                <p className="text-muted-foreground truncate font-mono text-xs">
                  {displayDirentName(save.name)}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Size
                </p>
                <p className="text-sm">{formatSize(save.totalSize)}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Created
                </p>
                <p className="text-sm">{formatDate(save.created)}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Modified
                </p>
                <p className="text-sm">{formatDate(save.modified)}</p>
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                Files
              </p>
              <div className="space-y-1">
                {save.files.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-mono text-xs">
                      {file.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatSize(file.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center p-4 pb-16 text-center">
          <p className="text-lg font-semibold">Save Not Found</p>
          <p className="mt-2 text-sm">This save is no longer on the card</p>
        </div>
      )}
    </div>
  );
};
