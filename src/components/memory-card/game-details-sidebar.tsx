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

interface SidebarShellProps {
  title: string;
  id: string;
  onClose: () => void;
  children: ReactNode;
}

// Frame for the PS1/PS2 info sidebars: header with the title, DataCenter
// credit and product code, plus the close button, around the body.
export const SidebarShell: React.FC<SidebarShellProps> = ({
  title,
  id,
  onClose,
  children,
}) => (
  <div className="flex w-80 flex-col border-l border-border bg-muted/80">
    <div className="flex items-center justify-between p-4">
      <div className="flex-row">
        <div className="flex flex-row items-center space-x-1">
          <p className="font-semibold">{title}</p>
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
        <p className="text-xs text-muted-foreground">{id}</p>
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
    {children}
  </div>
);

// Facts shown for a game, derived from the DataCenter response or the
// save's on-card data. Fields we don't have are left absent and skipped.
export interface GameDetails {
  title?: string;
  cover: string | null;
  developer?: string;
  publisher?: string;
  genre?: string;
  releaseDate?: string;
  discs?: number;
}

export function gameDetailsFromData(data: GameData): GameDetails {
  return {
    title: data.officialTitle || data.title,
    cover: data.cover,
    developer: data.developer,
    publisher: data.publisher,
    genre: data.genre,
    releaseDate: data.releaseDate,
    discs: data.discs,
  };
}

export const GameDetailsFields: React.FC<{
  details: GameDetails;
  platform?: GamePlatform;
  coverFallback?: ReactNode;
}> = ({ details, platform = "ps1", coverFallback }) => {
  const hasFacts =
    Boolean(details.genre) ||
    Boolean(details.releaseDate) ||
    details.discs != null;
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const showCover = Boolean(details.cover) && failedCover !== details.cover;
  const useDvdCover = platform === "ps2" && showCover;

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-md bg-muted",
          useDvdCover ? "aspect-[1/1.49]" : "aspect-square",
        )}
      >
        {showCover && details.cover ? (
          <img
            src={details.cover}
            alt="Game cover"
            className="size-full object-cover"
            onError={() => {
              if (details.cover) setFailedCover(details.cover);
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
        {details.title ? (
          <h4 className="mb-1 text-sm font-semibold">{details.title}</h4>
        ) : null}
        {details.developer ? (
          <p className="text-xs text-muted-foreground">
            Developed by {details.developer}
          </p>
        ) : null}
        {details.publisher ? (
          <p className="text-xs text-muted-foreground">
            Published by {details.publisher}
          </p>
        ) : null}
      </div>
      {hasFacts ? (
        <>
          <Separator />
          <div className="space-y-3">
            {details.genre ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Genre / Style
                </p>
                <p className="text-sm">{details.genre}</p>
              </div>
            ) : null}
            {details.releaseDate ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Release Date
                </p>
                <p className="text-sm">{details.releaseDate}</p>
              </div>
            ) : null}
            {details.discs != null ? (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
                  Discs
                </p>
                <p className="text-sm">{details.discs}</p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
};

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

export const GameDetailsSidebar: React.FC<GameDetailsSidebarProps> = ({
  gameId,
  region,
  saveName,
  icon,
  onClose,
}) => {
  const { gameData, isLoading } = useGameData("ps1", region, gameId);

  // Icon shown when the cover image is unavailable (lookup failed, or the
  // game was found without a cover).
  const coverFallback = icon ? (
    <PS1BlockIcon
      iconData={icon.data}
      iconPalette={icon.palette}
      iconFrameCount={icon.frameCount}
      className="mr-0 size-32"
    />
  ) : null;

  // The DataCenter facts, or the known on-card data (the save name) when the
  // lookup fails. Neither for an empty slot.
  const details: GameDetails | null = gameData
    ? gameDetailsFromData(gameData)
    : gameId
      ? { title: saveName || gameId, cover: null }
      : null;

  return (
    <SidebarShell title="Game Details" id={gameId} onClose={onClose}>
      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
        </div>
      ) : details ? (
        <ScrollArea className="grow overflow-hidden">
          <div className="p-4">
            <GameDetailsFields
              details={details}
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
    </SidebarShell>
  );
};
