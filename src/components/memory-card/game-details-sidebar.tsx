import { FileIcon, InfoIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import PS1BlockIcon from "@/components/ui/ps1-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGameData } from "@/hooks/use-game-data";
import type { IconPalette, SlotIconData } from "@/lib/ps1-memory-card";
import type { GameData, GamePlatform } from "@/lib/query";
import { cn } from "@/lib/utils";

interface GameDetailsSidebarProps {
  gameId: string;
  region: string;
  saveName?: string;
  icon?: {
    data: SlotIconData;
    palette: IconPalette;
    frameCount: number;
  } | null;
  onClose: () => void;
}

export const GameDetailsFields: React.FC<{
  gameData: GameData;
  platform?: GamePlatform;
  coverFallback?: ReactNode;
}> = ({ gameData, platform = "ps1", coverFallback }) => {
  const title = gameData.officialTitle || gameData.title;
  const hasFacts =
    Boolean(gameData.genre) ||
    Boolean(gameData.releaseDate) ||
    gameData.discs != null;
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const showCover = Boolean(gameData.cover) && failedCover !== gameData.cover;
  const useDvdCover = platform === "ps2" && showCover;

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-md bg-muted",
          useDvdCover ? "aspect-[1/1.49]" : "aspect-square",
        )}
      >
        {showCover && gameData.cover ? (
          <img
            src={gameData.cover}
            alt="Game cover"
            className="size-full object-cover"
            onError={() => {
              if (gameData.cover) setFailedCover(gameData.cover);
            }}
          />
        ) : coverFallback ? (
          coverFallback
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            No cover available
          </div>
        )}
      </div>
      <div>
        {title ? <h4 className="mb-1 text-sm font-semibold">{title}</h4> : null}
        {gameData.developer ? (
          <p className="text-xs text-muted-foreground">
            Developed by {gameData.developer}
          </p>
        ) : null}
        {gameData.publisher ? (
          <p className="text-xs text-muted-foreground">
            Published by {gameData.publisher}
          </p>
        ) : null}
      </div>
      {hasFacts ? (
        <>
          <Separator />
          <div className="space-y-3">
            {gameData.genre ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Genre / Style
                </p>
                <p className="text-sm">{gameData.genre}</p>
              </div>
            ) : null}
            {gameData.releaseDate ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Release Date
                </p>
                <p className="text-sm">{gameData.releaseDate}</p>
              </div>
            ) : null}
            {gameData.discs != null ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Discs
                </p>
                <p className="text-sm">{gameData.discs}</p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
};

export const GameDetailsSidebar: React.FC<GameDetailsSidebarProps> = ({
  gameId,
  region,
  saveName,
  icon,
  onClose,
}) => {
  const { gameData, isLoading } = useGameData("ps1", region, gameId);

  // Icon shown when the cover image is unavailable (lookup failed, or the game
  // was found without a cover).
  const coverFallback = icon ? (
    <PS1BlockIcon
      iconData={icon.data}
      iconPalette={icon.palette}
      iconFrameCount={icon.frameCount}
      className="mr-0 size-32"
    />
  ) : null;

  // What is known about the slot without the DataCenter lookup (the on-card
  // save name). GameDetailsFields skips the fields we don't have.
  const fallbackData: GameData = {
    id: gameId,
    title: saveName || gameId,
    cover: null,
  };

  return (
    <div className="flex w-80 flex-col border-l border-border bg-muted/80">
      <div className="flex items-center justify-between p-4">
        <div className="flex-row">
          <div className="flex flex-row items-center space-x-1">
            <p className="font-semibold">Game Details</p>
            <Tooltip>
              <TooltipTrigger
                render={(props) => (
                  <Button {...props} variant="ghost" size="icon">
                    <InfoIcon className="size-3 text-muted-foreground" />
                  </Button>
                )}
              />
              <TooltipContent>
                <p>Game details provided by The PlayStation DataCenter</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-xs text-muted-foreground">{gameId}</p>
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
      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        </div>
      ) : gameData ? (
        <ScrollArea className="grow overflow-hidden">
          <div className="p-4">
            <GameDetailsFields
              gameData={gameData}
              platform="ps1"
              coverFallback={coverFallback}
            />
          </div>
        </ScrollArea>
      ) : gameId ? (
        <ScrollArea className="grow overflow-hidden">
          <div className="p-4">
            <GameDetailsFields
              gameData={fallbackData}
              platform="ps1"
              coverFallback={coverFallback}
            />
          </div>
        </ScrollArea>
      ) : (
        <div className="flex h-full flex-col items-center justify-center p-4 pb-16 text-center text-muted-foreground">
          <div className="mb-4 size-16 rounded-full bg-muted/50 p-4">
            <FileIcon className="size-8" />
          </div>
          <p className="text-lg font-semibold">Empty Slot Selected</p>
          <p className="mt-2 text-sm">
            Select a save slot to view game details
          </p>
        </div>
      )}
    </div>
  );
};
