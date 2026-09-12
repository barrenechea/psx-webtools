import {
  GameDetailsFields,
  SidebarShell,
  gameDetailsFromData,
} from "@/components/memory-card/game-details-sidebar";
import { Ps2IconView } from "@/components/memory-card/ps2-icon-view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
    <SidebarShell title="Save Info" id={productCode} onClose={onClose}>
      {save ? (
        <ScrollArea className="grow overflow-hidden">
          <div className="space-y-4 p-4">
            {gameDataLoading ? (
              <div
                className={cn(
                  "flex items-center justify-center rounded-md bg-muted",
                  platform === "ps2" ? "aspect-[1/1.49]" : "aspect-square",
                )}
              >
                <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              </div>
            ) : gameData ? (
              <GameDetailsFields
                details={gameDetailsFromData(gameData)}
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
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {displayDirentName(save.name)}
                </p>
              </div>
            </div>
            {(save.deleted || save.corrupted) && (
              <p className="text-sm text-muted-foreground">
                {save.corrupted
                  ? "This save data is corrupted and may not be readable."
                  : "This save has been deleted but can be recovered."}
              </p>
            )}
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Size
                </p>
                <p className="text-sm">{formatSize(save.totalSize)}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Created
                </p>
                <p className="text-sm">{formatDate(save.created)}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Modified
                </p>
                <p className="text-sm">{formatDate(save.modified)}</p>
              </div>
            </div>
            <Separator />
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">
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
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatSize(file.size)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <div className="flex h-full flex-col items-center justify-center p-4 pb-16 text-center text-muted-foreground">
          <p className="text-lg font-semibold">Save Not Found</p>
          <p className="mt-2 text-sm">This save is no longer on the card</p>
        </div>
      )}
    </SidebarShell>
  );
};
