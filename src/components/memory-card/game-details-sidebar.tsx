import { FileIcon, InfoIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGameData } from "@/hooks/use-game-data";

interface GameDetailsSidebarProps {
  gameId: string;
  region: string;
  onClose: () => void;
}

export const GameDetailsSidebar: React.FC<GameDetailsSidebarProps> = ({
  gameId,
  region,
  onClose,
}) => {
  const {
    gameData,
    isLoading,
    error: gameDataError,
  } = useGameData("PS1", region, gameId);

  return (
    <div className="border-border bg-muted/80 flex w-80 flex-col border-l">
      <div className="flex items-center justify-between p-4">
        <div className="flex-row">
          <div className="flex flex-row items-center space-x-1">
            <p className="font-semibold">Game Details</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon">
                  <InfoIcon className="text-muted-foreground size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Game details provided by The PlayStation DataCenter</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground text-xs">{gameId}</p>
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
          <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent"></div>
        </div>
      ) : gameDataError ? (
        <div className="text-destructive text-center">{gameDataError}</div>
      ) : gameData ? (
        <ScrollArea className="grow overflow-hidden">
          <div className="space-y-6 p-4">
            <div className="bg-muted flex aspect-square items-center justify-center overflow-hidden rounded-md">
              {gameData.cover ? (
                <img
                  src={gameData.cover}
                  alt="Game cover"
                  className="size-full object-cover"
                />
              ) : (
                <div className="text-muted-foreground flex size-full items-center justify-center">
                  No cover available
                </div>
              )}
            </div>
            <div>
              <h4 className="mb-1 text-sm font-semibold">
                {gameData.officialTitle}
              </h4>
              <p className="text-muted-foreground text-xs">
                Developed by {gameData.developer}
              </p>
              <p className="text-muted-foreground text-xs">
                Published by {gameData.publisher}
              </p>
            </div>
            <Separator />
            <div className="space-y-3">
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Genre / Style
                </p>
                <p className="text-sm">{gameData.genre}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Release Date
                </p>
                <p className="text-sm">{gameData.releaseDate}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Discs
                </p>
                <p className="text-sm">{gameData.discs}</p>
              </div>
            </div>
          </div>
        </ScrollArea>
      ) : (
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center p-4 pb-16 text-center">
          <div className="bg-muted/50 mb-4 size-16 rounded-full p-4">
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
