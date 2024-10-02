import {
  ArrowRightIcon,
  CopyIcon,
  CpuIcon,
  FileIcon,
  InfoIcon,
  MemoryStickIcon,
  SaveIcon,
  TrashIcon,
  UsbIcon,
  XIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import FlagEU from "@/assets/flag-eu.svg?react";
import FlagJA from "@/assets/flag-ja.svg?react";
import FlagUS from "@/assets/flag-us.svg?react";
import { MemcarduinoConnectDialog } from "@/components/memcarduino-connect-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PS1BlockIcon from "@/components/ui/ps1-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import { useGameData } from "@/hooks/use-game-data";
import { useMemcarduino } from "@/hooks/use-memcarduino";
import PS1MemoryCard, {
  CardTypes,
  SaveInfo,
  SlotTypes,
} from "@/lib/ps1-memory-card";

import { DragDropWrapper } from "./drag-drop-wrapper";

interface MemoryCard {
  id: number;
  name: string;
  type: "file" | "device";
  source: string;
  card: PS1MemoryCard;
}

interface MemoryCardSlotProps {
  slot: SaveInfo;
  index: number;
  isSelected: boolean;
  onClick: (index: number) => void;
  iconData: number[];
  iconPalette: [number, number, number, number][];
}

const getRegionFlag = (region: string): JSX.Element => {
  switch (region) {
    case "America":
      return <FlagUS className="size-8" />;
    case "Europe":
      return <FlagEU className="size-8" />;
    case "Japan":
      return <FlagJA className="size-8" />;
    default:
      return (
        <div className="size-8 content-center rounded-full bg-muted/60 text-center">
          ?
        </div>
      );
  }
};

const MemoryCardSlot: React.FC<MemoryCardSlotProps> = ({
  slot,
  index,
  isSelected,
  onClick,
  iconData,
  iconPalette,
}) => {
  const isLink =
    slot.slotType === SlotTypes.MiddleLink ||
    slot.slotType === SlotTypes.DeletedMiddleLink ||
    slot.slotType === SlotTypes.EndLink ||
    slot.slotType === SlotTypes.DeletedEndLink;
  const isFormatted = slot.slotType === SlotTypes.Formatted;

  return (
    <Card
      className={`mb-2 cursor-pointer border-none ${
        isSelected ? "bg-card" : "bg-card/40 hover:bg-card/80"
      } ${isLink ? "ml-4" : ""}`}
      onClick={() => onClick(index)}
    >
      <CardContent className="flex items-center p-3">
        <div className="mr-2 w-6 text-xs text-muted-foreground">
          {(index + 1).toString().padStart(2, "0")}
        </div>
        {!isFormatted ? (
          <>
            {!isLink && (
              <PS1BlockIcon iconData={iconData} iconPalette={iconPalette} />
            )}
            <div className="min-w-0 grow">
              <h3 className="truncate text-sm font-medium text-foreground">
                {isLink ? "Linked Save Data" : slot.name}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                {isLink ? "Part of a multi-block save" : slot.productCode}
              </p>
            </div>
            {!isLink && (
              <>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {slot.identifier}
                </span>
                <span className="ml-4 shrink-0 text-sm">
                  {getRegionFlag(slot.region)}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Empty Slot</span>
        )}
      </CardContent>
    </Card>
  );
};

export const MemoryCardManager: React.FC = () => {
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const { showDialog, updateDialog, hideDialog } = useLoadingDialog();
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);

  const {
    isConnected,
    error: connectionError,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
    firmwareVersion,
  } = useMemcarduino();

  useEffect(() => {
    if (connectionError) {
      setError(connectionError);
    }
  }, [connectionError]);

  const {
    gameData,
    isLoading,
    error: gameDataError,
  } = useGameData("PS1", selectedRegion ?? "", selectedGameId ?? "");

  const handleConnect = useCallback(
    async (deviceType: string, connectionMode: string) => {
      showDialog("Connecting to MemCARDuino", "Initializing connection...");

      try {
        const baudRate = connectionMode === "fast" ? 115200 : 38400;
        const signalsConfig = getSignalsConfig(deviceType);

        await connect(deviceType, baudRate, signalsConfig, (status) => {
          updateDialog(status);
        });

        setTimeout(hideDialog, 1000);
        setIsConnectDialogOpen(false);
      } catch (err) {
        setError((err as Error).message);
        hideDialog();
      }
    },
    [
      showDialog,
      connect,
      updateDialog,
      hideDialog,
      setError,
      setIsConnectDialogOpen,
    ]
  );

  const getSignalsConfig = (deviceType: string): SerialOutputSignals[] => {
    switch (deviceType) {
      case "esp8266_esp32":
        return [];
      case "rpi_pico":
        return [];
      case "arduino_nano":
        return [{ dataTerminalReady: true }, { dataTerminalReady: false }];
      case "arduino_leonardo_micro":
        return [];
      default:
        return [];
    }
  };

  const handleDisconnect = useCallback(async () => {
    showDialog(
      "Disconnecting from MemCARDuino",
      "Initializing disconnection..."
    );

    try {
      await disconnect((status) => {
        updateDialog(status);
      });

      updateDialog("Disconnected successfully!");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      setError((err as Error).message);
      hideDialog();
    }
  }, [showDialog, disconnect, updateDialog, hideDialog, setError]);

  const handleReadFromDevice = useCallback(async () => {
    showDialog("Reading Memory Card", "Reading memory card data...");
    setError(null);

    try {
      const card = await readMemoryCard((progress) => {
        updateDialog(
          `Reading memory card... ${Math.round(progress * 100)}%`,
          undefined,
          progress
        );
      });

      if (card) {
        const newMemoryCard: MemoryCard = {
          id: Date.now(),
          name: "MemCARDuino Read",
          type: "device",
          source: `MemCARDuino v${firmwareVersion}`,
          card: card,
        };

        setMemoryCards((prev) => [...prev, newMemoryCard]);
        setSelectedCard(newMemoryCard.id);
        updateDialog("Memory card read successfully!");
        setTimeout(hideDialog, 1000);
      } else {
        throw new Error("Failed to read memory card");
      }
    } catch (err) {
      setError((err as Error).message);
      hideDialog();
    }
  }, [
    showDialog,
    readMemoryCard,
    updateDialog,
    hideDialog,
    setError,
    setMemoryCards,
    setSelectedCard,
    firmwareVersion,
  ]);

  const handleWriteToDevice = useCallback(async () => {
    if (selectedCard !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        showDialog("Writing to Memory Card", "Preparing to write data...");
        setError(null);

        try {
          const success = await writeMemoryCard(card, (progress) => {
            updateDialog(
              `Writing to memory card... ${Math.round(progress * 100)}%`,
              undefined,
              progress
            );
          });

          if (success) {
            updateDialog("Memory card write successful!");
            setTimeout(hideDialog, 1000);
          } else {
            throw new Error("Failed to write memory card to device");
          }
        } catch (err) {
          setError((err as Error).message);
          hideDialog();
        }
      }
    }
  }, [
    selectedCard,
    memoryCards,
    showDialog,
    writeMemoryCard,
    updateDialog,
    hideDialog,
    setError,
  ]);

  const handleFileOpen = useCallback(
    async (file?: File) => {
      try {
        const selectedFile = file ?? (await selectFile());
        if (selectedFile) {
          const card = new PS1MemoryCard();
          await card.loadFromFile(selectedFile);

          const newCard: MemoryCard = {
            id: Date.now(),
            name: selectedFile.name,
            type: "file",
            source: selectedFile.name,
            card: card,
          };

          setMemoryCards((prevCards) => [...prevCards, newCard]);
          setSelectedCard(newCard.id);
          setError(null);
        }
      } catch (err) {
        setError(`Error opening file: ${(err as Error).message}`);
      }
    },
    [setMemoryCards, setSelectedCard, setError]
  );

  const handleFileDrop = useCallback(
    async (file: File) => {
      await handleFileOpen(file);
    },
    [handleFileOpen]
  );

  const selectFile = (): Promise<File | undefined> => {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        ".mcr,.mcd,.gme,.vgs,.vmp,.psm,.ps1,.bin,.mem,.psx,.pda,.mc,.ddf,.mc1,.mc2,.srm";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        resolve(file);
      };
      input.click();
    });
  };

  const handleDelete = useCallback(() => {
    if (selectedCard !== null && selectedSlot !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        card.toggleDeleteSave(selectedSlot);
        setMemoryCards([...memoryCards]);
      }
    }
  }, [selectedCard, selectedSlot, memoryCards, setMemoryCards]);

  const handleCopyMove = useCallback(
    (action: "copy" | "move") => {
      setError(
        `${action.charAt(0).toUpperCase() + action.slice(1)} functionality is not implemented yet.`
      );
    },
    [setError]
  );

  const handleSaveMemoryCard = useCallback(async () => {
    if (selectedCard !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        const success = await card.saveMemoryCard(
          `memory_card_${Date.now()}.mcr`,
          CardTypes.Raw
        );
        if (success) {
          setError(null);
        } else {
          setError("Failed to save memory card");
        }
      }
    }
  }, [selectedCard, memoryCards, setError]);

  const findLinkedSlots = useCallback(
    (card: PS1MemoryCard, startIndex: number) => {
      const linkedSlots = [startIndex];
      const saves = card.getSaves();
      let currentSlot = startIndex;

      while (true) {
        const nextSlot = saves[currentSlot].slotNumber + 1;
        if (nextSlot >= saves.length) break;

        const nextSave = saves[nextSlot];
        if (
          nextSave.slotType !== SlotTypes.MiddleLink &&
          nextSave.slotType !== SlotTypes.EndLink &&
          nextSave.slotType !== SlotTypes.DeletedMiddleLink &&
          nextSave.slotType !== SlotTypes.DeletedEndLink
        )
          break;

        linkedSlots.push(nextSlot);
        currentSlot = nextSlot;
      }

      return linkedSlots;
    },
    []
  );

  const findParentSlot = useCallback(
    (card: PS1MemoryCard, slotIndex: number) => {
      const saves = card.getSaves();
      let currentSlot = slotIndex;

      if (
        saves[currentSlot].slotType === SlotTypes.Initial ||
        saves[currentSlot].slotType === SlotTypes.DeletedInitial ||
        saves[currentSlot].slotType === SlotTypes.Formatted
      )
        return slotIndex;

      while (currentSlot > 0) {
        const prevSave = saves[currentSlot - 1];
        if (
          prevSave.slotType === SlotTypes.Initial ||
          prevSave.slotType === SlotTypes.DeletedInitial
        )
          return currentSlot - 1;
        if (
          prevSave.slotType !== SlotTypes.MiddleLink &&
          prevSave.slotType !== SlotTypes.EndLink &&
          prevSave.slotType !== SlotTypes.DeletedMiddleLink &&
          prevSave.slotType !== SlotTypes.DeletedEndLink
        )
          break;
        currentSlot--;
      }

      return slotIndex;
    },
    []
  );

  const handleSlotClick = useCallback(
    (index: number) => {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (!card) return;

      const saves = card.getSaves();
      const parentSlot = findParentSlot(card, index);
      console.log(`parent slot game id: ${saves[parentSlot].productCode}`);
      const linkedSlots = findLinkedSlots(card, parentSlot);
      console.log(`linked slots: ${linkedSlots.join(", ")}`);

      setSelectedSlot((prev) =>
        linkedSlots.includes(prev ?? -1) ? null : parentSlot
      );
      setSidebarOpen(true);
      setSelectedGameId(saves[parentSlot].productCode);
      setSelectedRegion(saves[parentSlot].region);
    },
    [
      memoryCards,
      selectedCard,
      setSelectedSlot,
      setSidebarOpen,
      setSelectedGameId,
      setSelectedRegion,
      findParentSlot,
      findLinkedSlots,
    ]
  );

  return (
    <div className="flex h-screen w-full items-center justify-center bg-transparent p-4">
      <DragDropWrapper onFileDrop={(file) => void handleFileDrop(file)}>
        <div className="flex size-full max-w-7xl flex-col overflow-hidden rounded-xl shadow-xl">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-border bg-muted/80 p-2">
            <h1 className="pl-2 font-light text-muted-foreground">
              Memory Card Manager{" "}
              <span className="text-xs text-destructive dark:text-red-400">
                Alpha
              </span>
            </h1>
            <TooltipProvider>
              <div className="flex space-x-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopyMove("copy")}
                      disabled={selectedSlot === null}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Copy to other card
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopyMove("move")}
                      disabled={selectedSlot === null}
                    >
                      <ArrowRightIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Move to other card
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleDelete}
                      disabled={selectedSlot === null}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Delete save</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleSaveMemoryCard()}
                      disabled={selectedCard === null}
                    >
                      <SaveIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Save memory card
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
          {/* Main content */}
          <div className="flex grow overflow-hidden">
            {/* Sidebar */}
            <div className="flex w-64 flex-col border-r border-border bg-muted/80">
              <ScrollArea className="grow" type="auto">
                <div className="p-2">
                  {memoryCards.map((card) => (
                    <Button
                      key={card.id}
                      variant="ghost"
                      className={`mb-1 w-full justify-start ${
                        selectedCard === card.id
                          ? "cursor-default bg-card hover:bg-card"
                          : "border-transparent bg-card/40 hover:bg-card/80"
                      }`}
                      onClick={() => {
                        setSelectedSlot(null);
                        setSelectedCard(card.id);
                        setSidebarOpen(false);
                      }}
                    >
                      {card.type === "device" ? (
                        <MemoryStickIcon className="mr-2 size-4" />
                      ) : (
                        <FileIcon className="mr-2 size-4" />
                      )}
                      <span className="max-w-44 truncate">{card.name}</span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
              <div className="space-y-1 border-t border-border p-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start hover:bg-card/80"
                  onClick={() => void handleFileOpen()}
                >
                  <FileIcon className="mr-2 size-4" />
                  Open from file
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-start hover:bg-card/80"
                    >
                      <MemoryStickIcon className="mr-2 size-4" />
                      Connect a device
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right">
                    <DropdownMenuLabel>
                      <div className="flex items-center">
                        <UsbIcon className="mr-2 size-4" />
                        USB Devices
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuItem disabled>
                      No USB devices available
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>
                      <div className="flex items-center">
                        <CpuIcon className="mr-2 size-4" />
                        Serial Devices
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => setIsConnectDialogOpen(true)}
                    >
                      MemCARDuino
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                {isConnected && (
                  <>
                    <Button
                      variant="ghost"
                      className="w-full justify-start hover:bg-card/80"
                      onClick={() => void handleDisconnect()}
                    >
                      Disconnect MemCARDuino
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start hover:bg-card/80"
                      onClick={() => void handleReadFromDevice()}
                    >
                      Read from MemCARDuino
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start hover:bg-card/80"
                      onClick={() => void handleWriteToDevice()}
                      disabled={selectedCard === null}
                    >
                      Write to MemCARDuino
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Card content */}
            <div className="flex grow flex-row bg-transparent">
              {selectedCard ? (
                <>
                  <div className="flex grow flex-col">
                    <div className="border-b border-border bg-muted/80 p-4">
                      <h2 className="mb-1 text-lg font-semibold">
                        {
                          memoryCards.find((card) => card.id === selectedCard)
                            ?.name
                        }
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {`Opened via ${
                          memoryCards.find((card) => card.id === selectedCard)
                            ?.type
                        } "${
                          memoryCards.find((card) => card.id === selectedCard)
                            ?.source
                        }"`}
                      </p>
                    </div>
                    <ScrollArea className="grow" type="auto">
                      <div className="bg-card/60 p-4">
                        {memoryCards
                          .find((card) => card.id === selectedCard)
                          ?.card.getSaves()
                          .map((save, index) => {
                            const card = memoryCards.find(
                              (c) => c.id === selectedCard
                            )?.card;
                            if (!card) return null;

                            const parentSlot = findParentSlot(card, index);
                            const linkedSlots = findLinkedSlots(
                              card,
                              parentSlot
                            );
                            const isSelected = linkedSlots.includes(
                              selectedSlot ?? -1
                            );
                            return (
                              <MemoryCardSlot
                                key={index}
                                slot={save}
                                index={index}
                                isSelected={isSelected}
                                onClick={handleSlotClick}
                                iconData={card.getIconData(index)}
                                iconPalette={card.getIconPalette(index)}
                              />
                            );
                          })}
                      </div>
                    </ScrollArea>
                  </div>
                  {sidebarOpen && (
                    <div className="flex w-80 flex-col border-l border-border bg-muted/80">
                      <div className="flex items-center justify-between p-4">
                        <div className="flex-row">
                          <div className="flex flex-row items-center space-x-1">
                            <p className="font-semibold">Game Details</p>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <InfoIcon className="size-3 text-muted-foreground" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>
                                    Game details provided by The PlayStation
                                    DataCenter
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {selectedGameId}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSidebarOpen(false)}
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
                      ) : gameDataError ? (
                        <div className="text-center text-destructive">
                          {gameDataError}
                        </div>
                      ) : gameData ? (
                        <ScrollArea className="grow">
                          <div className="space-y-6 p-4">
                            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted">
                              {gameData.cover ? (
                                <img
                                  src={gameData.cover}
                                  alt="Game cover"
                                  className="size-full object-cover"
                                />
                              ) : (
                                <div className="flex size-full items-center justify-center text-muted-foreground">
                                  No cover available
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="mb-1 text-sm font-semibold">
                                {gameData.officialTitle}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                Developed by {gameData.developer}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Published by {gameData.publisher}
                              </p>
                            </div>
                            <Separator />
                            <div className="space-y-3">
                              <div>
                                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                                  Genre / Style
                                </p>
                                <p className="text-sm">{gameData.genre}</p>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                                  Release Date
                                </p>
                                <p className="text-sm">
                                  {gameData.releaseDate}
                                </p>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                                  Discs
                                </p>
                                <p className="text-sm">{gameData.discs}</p>
                              </div>
                            </div>
                          </div>
                        </ScrollArea>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center p-4 pb-16 text-center text-muted-foreground">
                          <div className="mb-4 size-16 rounded-full bg-muted/50 p-4">
                            <FileIcon className="size-8" />
                          </div>
                          <p className="text-lg font-semibold">
                            Empty Slot Selected
                          </p>
                          <p className="mt-2 text-sm">
                            Select a save slot to view game details
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex grow flex-col items-center justify-center bg-card/80 p-4 text-muted-foreground">
                  <p className="mb-4 text-lg">No memory card selected</p>
                  <p className="text-sm">
                    Open a memory card file or connect a device to get started
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="border-t border-border bg-muted/80 p-2 text-sm text-muted-foreground">
            {error ??
              (selectedCard
                ? `${
                    memoryCards
                      .find((card) => card.id === selectedCard)
                      ?.card.getSaves().length ?? 0
                  } items`
                : "No memory card selected")}
          </div>
        </div>
      </DragDropWrapper>
      <MemcarduinoConnectDialog
        isOpen={isConnectDialogOpen}
        onOpenChange={setIsConnectDialogOpen}
        onConnect={handleConnect}
      />
    </div>
  );
};
