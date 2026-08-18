import {
  ArrowRightIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CpuIcon,
  DownloadIcon,
  FileIcon,
  FolderOpenIcon,
  InfoIcon,
  MemoryStickIcon,
  SaveIcon,
  TrashIcon,
  UploadIcon,
  UsbIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { MemcarduinoConnectDialog } from "@/components/memcarduino-connect-dialog";
import SaveMemoryCardDialog from "@/components/save-dialog";
import SaveSingleSaveDialog from "@/components/save-single-save-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { UniromConnectDialog } from "@/components/unirom-connect-dialog";
import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import { useGameData } from "@/hooks/use-game-data";
import { useHardwareConnection } from "@/hooks/use-hardware";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import { Unirom } from "@/lib/ps1/hardware/unirom";
import PS1MemoryCard, {
  CardTypes,
  type IconPalette,
  type SaveInfo,
  SingleSaveTypes,
  type SlotIconData,
  SlotTypes,
} from "@/lib/ps1-memory-card";
import { cn } from "@/lib/utils";

import AlphaNoticeDialog from "./alpha-notice-dialog";
import { DragDropWrapper } from "./drag-drop-wrapper";

interface MemoryCard {
  id: number;
  name: string;
  type: "file" | "device";
  source: string;
  card: PS1MemoryCard;
}

interface CardListItemProps {
  name: string;
  type: "file" | "device";
  changed: boolean;
  isSelected: boolean;
  onClick: () => void;
}

const CardListItem: React.FC<CardListItemProps> = ({
  name,
  type,
  changed,
  isSelected,
  onClick,
}) => (
  <Button
    variant="ghost"
    className={`mb-1 w-full justify-start ${
      isSelected
        ? "bg-card hover:bg-card cursor-default"
        : "bg-card/40 hover:bg-card/80 border-transparent"
    }`}
    onClick={onClick}
  >
    {type === "device" ? (
      <MemoryStickIcon className="size-4" />
    ) : (
      <FileIcon className="size-4" />
    )}
    <span className="max-w-44 truncate">{name}</span>
    {changed && (
      <span
        title="Unsaved changes"
        aria-label="Unsaved changes"
        className="ml-auto size-2 shrink-0 rounded-full bg-amber-500"
      />
    )}
  </Button>
);

interface MemoryCardSlotProps {
  slot: SaveInfo;
  index: number;
  isSelected: boolean;
  onClick: (index: number) => void;
  iconData: SlotIconData;
  iconPalette: IconPalette;
}

const getSlotTypeBadge = (slotType: SlotTypes) => {
  switch (slotType) {
    case SlotTypes.DeletedInitial:
    case SlotTypes.DeletedMiddleLink:
    case SlotTypes.DeletedEndLink:
      return (
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger>
              <Badge variant="destructive">Deleted</Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>This save has been deleted but can be recovered</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case SlotTypes.Corrupted:
      return (
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger>
              <Badge variant="outline">Corrupted</Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>This save data is corrupted and may not be readable</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return null;
  }
};

// enable copy/move/delete functionality for testing
const alphaDisabled = false;

let lastCardId = 0;
const nextCardId = (): number => ++lastCardId;

const MemoryCardSlot: React.FC<MemoryCardSlotProps> = ({
  slot,
  index,
  isSelected,
  onClick,
  iconData,
  iconPalette,
}) => {
  const isFormatted = slot.slotType === SlotTypes.Formatted;
  const isLink =
    slot.slotType === SlotTypes.MiddleLink ||
    slot.slotType === SlotTypes.DeletedMiddleLink ||
    slot.slotType === SlotTypes.EndLink ||
    slot.slotType === SlotTypes.DeletedEndLink;

  return (
    <Card
      className={cn(
        "mb-2 cursor-pointer border-none py-0",
        isSelected ? "bg-card" : "bg-card/40 hover:bg-card/80",
        isLink && "ml-4",
      )}
      onClick={() => onClick(index)}
    >
      <CardContent className="flex-row items-center gap-0 p-3">
        <div className="text-muted-foreground mr-2 w-6 text-xs">
          {(index + 1).toString().padStart(2, "0")}
        </div>
        {!isFormatted ? (
          <>
            {!isLink && (
              <PS1BlockIcon
                iconData={iconData}
                iconPalette={iconPalette}
                iconFrameCount={slot.iconFrameCount}
              />
            )}
            <div className="min-w-0 grow">
              <h3 className="text-foreground truncate text-sm font-medium">
                {isLink ? "Linked Save Data" : slot.name}
              </h3>
              <p className="text-muted-foreground truncate text-xs">
                {isLink ? "Part of a multi-block save" : slot.productCode}
              </p>
            </div>
            <div className="ml-2 flex flex-wrap gap-1">
              {!isLink && (
                <>
                  <TooltipProvider>
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger>
                        <Badge variant="secondary">{slot.identifier}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Save identifier</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger>
                        <Badge variant="secondary">{slot.region}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Game region</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
              {getSlotTypeBadge(slot.slotType)}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">Empty Slot</span>
        )}
      </CardContent>
    </Card>
  );
};

export const MemoryCardManager: React.FC = () => {
  const [isAlphaNoticeOpen, setIsAlphaNoticeOpen] = useState(true);

  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const { showDialog, updateDialog, hideDialog } = useLoadingDialog();
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isUniromDialogOpen, setIsUniromDialogOpen] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
  const [copiedSlots, setCopiedSlots] = useState<SaveInfo[]>([]);
  const [copiedSaveBytes, setCopiedSaveBytes] = useState<Uint8Array | null>(
    null,
  );
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSingleSaveDialogOpen, setIsSingleSaveDialogOpen] = useState(false);
  const [fixCorrupted, setFixCorrupted] = usePersistentState(
    "psx-webtools.fixCorruptedCards",
    false,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const singleSaveFileInputRef = useRef<HTMLInputElement>(null);

  const {
    isConnected,
    error: connectionError,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
    firmwareVersion,
  } = useHardwareConnection();

  const {
    gameData,
    isLoading,
    error: gameDataError,
  } = useGameData("PS1", selectedRegion ?? "", selectedGameId ?? "");

  const handleMemcarduinoConnect = async (
    deviceType: string,
    connectionMode: string,
  ) => {
    showDialog("Connecting to MemCARDuino", "Initializing connection...");

    try {
      const baudRate = connectionMode === "fast" ? 115200 : 38400;
      const signalsConfig = getMemcarduinoSignalsConfig(deviceType);

      await connect(
        new MemCARDuino(),
        { deviceType, baudRate, signalsConfig },
        (status) => {
          updateDialog(status);
        },
      );

      setConnectedDevice("MemCARDuino");
      setTimeout(hideDialog, 1000);
      setIsConnectDialogOpen(false);
    } catch (err) {
      setError((err as Error).message);
      hideDialog();
    }
  };

  const handleUniromConnect = async (cardSlot: number) => {
    showDialog("Connecting to Unirom", "Initializing connection...");

    try {
      const device = new Unirom();
      device.cardSlot = cardSlot;

      await connect(
        device,
        { deviceType: "unirom", baudRate: 115200, signalsConfig: [] },
        (status) => {
          updateDialog(status);
        },
      );

      setConnectedDevice("Unirom");
      setTimeout(hideDialog, 1000);
      setIsUniromDialogOpen(false);
    } catch (err) {
      setError((err as Error).message);
      hideDialog();
    }
  };

  const getMemcarduinoSignalsConfig = (
    deviceType: string,
  ): SerialOutputSignals[] => {
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

  const handleDisconnect = async () => {
    showDialog("Disconnecting from device", "Initializing disconnection...");

    try {
      await disconnect((status) => {
        updateDialog(status);
      });

      setConnectedDevice(null);
      updateDialog("Disconnected successfully!");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      setError((err as Error).message);
      hideDialog();
    }
  };

  const handleReadFromDevice = async () => {
    showDialog("Reading Memory Card", "Reading memory card data...");
    setError(null);

    try {
      const card = await readMemoryCard((progress) => {
        updateDialog(
          `Reading memory card... ${Math.round(progress * 100)}%`,
          undefined,
          progress,
        );
      }, fixCorrupted);

      if (card) {
        const newMemoryCard: MemoryCard = {
          id: nextCardId(),
          name: `${connectedDevice ?? "Device"} Read`,
          type: "device",
          source: `${connectedDevice ?? "Device"} v${firmwareVersion}`,
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
  };

  const handleWriteToDevice = async () => {
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
              progress,
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
  };

  const handleFilesOpen = async (files: File[]) => {
    if (files.length === 0) return;

    const openedCards: MemoryCard[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const card = new PS1MemoryCard();
        await card.loadFromFile(file, fixCorrupted);
        openedCards.push({
          id: nextCardId(),
          name: file.name,
          type: "file",
          source: file.name,
          card,
        });
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      }
    }

    if (openedCards.length > 0) {
      setMemoryCards((prevCards) => [...prevCards, ...openedCards]);
      setSelectedCard(openedCards[openedCards.length - 1].id);
    }

    setError(
      errors.length > 0 ? `Error opening file: ${errors.join("; ")}` : null,
    );
  };

  const handleOpenFromFileClick = () => {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void handleFilesOpen(files);
  };

  const handleDelete = () => {
    if (selectedCard !== null && selectedSlot !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        card.toggleDeleteSave(selectedSlot);
        setMemoryCards([...memoryCards]);
      }
    }
  };

  const handleSaveMemoryCard = () => {
    if (selectedCard !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard);
      if (card) {
        setIsSaveDialogOpen(true);
      }
    }
  };

  const handleSaveConfirm = async (fileName: string, format: CardTypes) => {
    if (selectedCard !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        const success = await card.saveMemoryCard(
          fileName,
          format,
          fixCorrupted,
        );
        if (success) {
          setError(null);
        } else {
          setError("Failed to save memory card");
        }
        setIsSaveDialogOpen(false);
      }
    }
  };

  const findLinkedSlots = (card: PS1MemoryCard, startIndex: number) => {
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
  };

  const findParentSlot = (card: PS1MemoryCard, slotIndex: number) => {
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
  };

  const selectedSaveInfo =
    selectedSlot !== null
      ? memoryCards.find((c) => c.id === selectedCard)?.card.getSaves()[
          selectedSlot
        ]
      : undefined;
  const isSlotEmpty = selectedSaveInfo?.slotType === SlotTypes.Formatted;

  const handleExportSingleSave = () => {
    if (selectedCard === null || selectedSlot === null || isSlotEmpty) return;
    setIsSingleSaveDialogOpen(true);
  };

  const handleExportSingleSaveConfirm = async (
    fileName: string,
    saveType: SingleSaveTypes,
  ) => {
    if (selectedCard !== null && selectedSlot !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        const parentSlot = findParentSlot(card, selectedSlot);
        const success = await card.saveSingleSave(
          fileName,
          parentSlot,
          saveType,
        );
        setError(success ? null : "Failed to export save");
      }
    }
    setIsSingleSaveDialogOpen(false);
  };

  const handleImportSingleSave = () => {
    const input = singleSaveFileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const handleImportSingleSaveChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || selectedCard === null || selectedSlot === null) return;
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (!card) return;
    const success = await card.openSingleSave(file, selectedSlot);
    if (success) {
      setError(null);
      setMemoryCards([...memoryCards]);
    } else {
      setError("Failed to import save");
    }
  };

  const handleCopyMove = (action: "copy" | "move") => {
    if (selectedCard !== null && selectedSlot !== null) {
      const cardEntry = memoryCards.find((c) => c.id === selectedCard);
      if (cardEntry) {
        const parentSlot = findParentSlot(cardEntry.card, selectedSlot);
        const linkedSlots = findLinkedSlots(cardEntry.card, parentSlot);
        const copiedSaves = linkedSlots.map(
          (slotIndex) => cardEntry.card.getSaves()[slotIndex],
        );
        setCopiedSlots(copiedSaves);
        setCopiedSaveBytes(cardEntry.card.getSaveBytes(parentSlot));
        if (action === "move") {
          cardEntry.card.formatSave(parentSlot);
          setSelectedSlot(null);
          setMemoryCards([...memoryCards]);
        }
      }
    }
  };

  const handlePaste = () => {
    if (
      selectedCard !== null &&
      selectedSlot !== null &&
      copiedSaveBytes !== null
    ) {
      const cardEntry = memoryCards.find((c) => c.id === selectedCard);
      if (cardEntry) {
        const success = cardEntry.card.setSaveBytes(
          selectedSlot,
          copiedSaveBytes,
        );
        if (success) {
          setCopiedSlots([]);
          setCopiedSaveBytes(null);
          setMemoryCards([...memoryCards]);
        } else {
          setError("Not enough free space to paste save");
        }
      }
    }
  };

  const handleSlotClick = (index: number) => {
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (!card) return;

    const saves = card.getSaves();
    const parentSlot = findParentSlot(card, index);
    const linkedSlots = findLinkedSlots(card, parentSlot);

    setSelectedSlot((prev) =>
      linkedSlots.includes(prev ?? -1) ? null : parentSlot,
    );
    setSidebarOpen(true);
    setSelectedGameId(saves[parentSlot].productCode);
    setSelectedRegion(saves[parentSlot].region);
  };

  return (
    <>
      <DragDropWrapper onFileDrop={(files) => void handleFilesOpen(files)}>
        <div className="flex h-full w-full items-center justify-center bg-transparent p-4">
          <div className="flex size-full max-w-7xl flex-col overflow-hidden rounded-xl shadow-xl">
            {/* Toolbar */}
            <div className="border-border bg-muted/80 flex items-center justify-between border-b p-2">
              <h1 className="text-muted-foreground pl-2 font-light">
                Memory Card Manager{" "}
                <span className="text-destructive text-xs dark:text-red-400">
                  Alpha
                </span>
              </h1>
              <TooltipProvider>
                <div className="flex space-x-2">
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopyMove("copy")}
                        disabled={selectedSlot === null || alphaDisabled}
                        aria-label="Copy to buffer"
                      >
                        <CopyIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Copy to buffer
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopyMove("move")}
                        disabled={selectedSlot === null || alphaDisabled}
                        aria-label="Move to buffer"
                      >
                        <ArrowRightIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Move to buffer
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handlePaste}
                        disabled={
                          selectedSlot === null ||
                          copiedSaveBytes === null ||
                          alphaDisabled
                        }
                        aria-label="Paste from buffer"
                      >
                        <ClipboardPasteIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Paste from buffer
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleDelete}
                        disabled={selectedSlot === null || alphaDisabled}
                        aria-label="Delete save"
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Delete save</TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleSaveMemoryCard()}
                        disabled={selectedCard === null}
                        aria-label="Save memory card"
                      >
                        <SaveIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Save memory card
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleExportSingleSave}
                        disabled={selectedSlot === null || isSlotEmpty}
                        aria-label="Export save"
                      >
                        <DownloadIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Export save</TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleImportSingleSave}
                        disabled={selectedSlot === null || !isSlotEmpty}
                        aria-label="Import save"
                      >
                        <UploadIcon className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Import save</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
            {/* Main content */}
            <div className="flex grow overflow-hidden">
              {/* Sidebar */}
              <div className="border-border bg-muted/80 flex w-64 flex-col border-r">
                <ScrollArea className="grow overflow-hidden" type="auto">
                  <div className="p-2">
                    {memoryCards.map((card) => (
                      <CardListItem
                        key={card.id}
                        name={card.name}
                        type={card.type}
                        changed={card.card.changed}
                        isSelected={selectedCard === card.id}
                        onClick={() => {
                          setSelectedSlot(null);
                          setSelectedCard(card.id);
                          setSidebarOpen(false);
                        }}
                      />
                    ))}
                  </div>
                </ScrollArea>
                <div className="border-border space-y-1 border-t p-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mcr,.mcd,.gme,.vgs,.vmp,.psm,.ps1,.bin,.mem,.psx,.pda,.mc,.ddf,.mc1,.mc2,.srm"
                    className="sr-only"
                    multiple
                    onChange={handleFileInputChange}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="hover:bg-card/80 w-full justify-start"
                      >
                        <FolderOpenIcon className="mr-2 size-4" />
                        Open...
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" className="w-56">
                      <DropdownMenuItem
                        onSelect={(event) => {
                          // Keep the menu open so the native file picker can
                          // open from within this user gesture.
                          event.preventDefault();
                          handleOpenFromFileClick();
                        }}
                      >
                        <FileIcon />
                        Open from file
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <MemoryStickIcon />
                          Connect a device
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-48">
                          <DropdownMenuLabel>
                            <div className="flex items-center">
                              <UsbIcon className="mr-2 size-4" />
                              USB Devices
                            </div>
                          </DropdownMenuLabel>
                          <DropdownMenuItem disabled>
                            None yet, check back later
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
                          <DropdownMenuItem
                            onSelect={() => setIsUniromDialogOpen(true)}
                          >
                            Unirom
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={fixCorrupted}
                        onCheckedChange={(checked) => setFixCorrupted(checked)}
                        onSelect={(event) => {
                          // Keep the menu open; this is a setting, not a
                          // navigational action.
                          event.preventDefault();
                        }}
                      >
                        Try to fix corrupted cards
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {isConnected && (
                    <>
                      <Button
                        variant="ghost"
                        className="hover:bg-card/80 w-full justify-start"
                        onClick={() => void handleDisconnect()}
                      >
                        Disconnect {connectedDevice ?? "device"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="hover:bg-card/80 w-full justify-start"
                        onClick={() => void handleReadFromDevice()}
                      >
                        Read from {connectedDevice ?? "device"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="hover:bg-card/80 w-full justify-start"
                        onClick={() => void handleWriteToDevice()}
                        disabled={selectedCard === null}
                      >
                        Write to {connectedDevice ?? "device"}
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
                      <div className="border-border bg-muted/80 flex items-center justify-between border-b p-4 px-6">
                        <div>
                          <h2 className="mb-1 text-lg font-semibold">
                            {
                              memoryCards.find(
                                (card) => card.id === selectedCard,
                              )?.name
                            }
                          </h2>
                          <p className="text-muted-foreground text-sm">
                            {`Opened via ${
                              memoryCards.find(
                                (card) => card.id === selectedCard,
                              )?.type
                            } "${memoryCards.find((card) => card.id === selectedCard)?.source}"`}
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
                                        iconData={
                                          memoryCards
                                            .find((c) => c.id === selectedCard)
                                            ?.card.getIconData(
                                              copiedSlots[0].slotNumber,
                                            ) ?? []
                                        }
                                        iconPalette={
                                          memoryCards
                                            .find((c) => c.id === selectedCard)
                                            ?.card.getIconPalette(
                                              copiedSlots[0].slotNumber,
                                            ) ?? []
                                        }
                                        iconFrameCount={
                                          copiedSlots[0].iconFrameCount
                                        }
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
                      <ScrollArea
                        className="grow overflow-hidden"
                        type="always"
                      >
                        <div className="bg-card/60 p-4">
                          {memoryCards
                            .find((card) => card.id === selectedCard)
                            ?.card.getSaves()
                            .map((save, index) => {
                              const card = memoryCards.find(
                                (c) => c.id === selectedCard,
                              )?.card;
                              if (!card) return null;

                              const parentSlot = findParentSlot(card, index);
                              const linkedSlots = findLinkedSlots(
                                card,
                                parentSlot,
                              );
                              const isSelected = linkedSlots.includes(
                                selectedSlot ?? -1,
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
                      <div className="border-border bg-muted/80 flex w-80 flex-col border-l">
                        <div className="flex items-center justify-between p-4">
                          <div className="flex-row">
                            <div className="flex flex-row items-center space-x-1">
                              <p className="font-semibold">Game Details</p>
                              <TooltipProvider>
                                <Tooltip delayDuration={100}>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                      <InfoIcon className="text-muted-foreground size-3" />
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
                            <p className="text-muted-foreground text-xs">
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
                            <div className="border-primary size-8 animate-spin rounded-full border-2 border-t-transparent"></div>
                          </div>
                        ) : gameDataError ? (
                          <div className="text-destructive text-center">
                            {gameDataError}
                          </div>
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
                                  <p className="text-sm">
                                    {gameData.releaseDate}
                                  </p>
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
                  <div className="bg-card/80 text-muted-foreground flex grow flex-col items-center justify-center p-4">
                    <p className="mb-4 text-lg">No memory card selected</p>
                    <p className="text-sm">
                      Open a memory card file or connect a device to get started
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Status bar */}
            <div className="border-border bg-muted/80 text-muted-foreground border-t px-4 py-2 text-sm">
              {error ??
                connectionError ??
                (selectedCard
                  ? `${
                      memoryCards
                        .find((card) => card.id === selectedCard)
                        ?.card.getSaves().length ?? 0
                    } items`
                  : "No memory card selected")}
            </div>
          </div>
          <AlphaNoticeDialog
            isOpen={isAlphaNoticeOpen}
            onClose={() => setIsAlphaNoticeOpen(false)}
          />
        </div>
      </DragDropWrapper>
      <MemcarduinoConnectDialog
        isOpen={isConnectDialogOpen}
        onOpenChange={setIsConnectDialogOpen}
        onConnect={handleMemcarduinoConnect}
      />
      <UniromConnectDialog
        isOpen={isUniromDialogOpen}
        onOpenChange={setIsUniromDialogOpen}
        onConnect={handleUniromConnect}
      />
      <input
        ref={singleSaveFileInputRef}
        type="file"
        accept=".mcs,.ps1,.psv,.mcb,.mcx,.pda,.psx,.psm,.bin,.raw"
        className="sr-only"
        onChange={(e) => void handleImportSingleSaveChange(e)}
      />
      <SaveMemoryCardDialog
        key={selectedCard ?? "no-card"}
        isOpen={isSaveDialogOpen}
        onOpenChange={setIsSaveDialogOpen}
        defaultFileName={
          memoryCards.find((c) => c.id === selectedCard)?.name ?? "memory_card"
        }
        defaultFormat={
          memoryCards.find((c) => c.id === selectedCard)?.card.getCardType() ??
          CardTypes.Raw
        }
        onSave={handleSaveConfirm}
      />
      <SaveSingleSaveDialog
        key={`${selectedCard ?? "no-card"}-${selectedSlot ?? "no-slot"}`}
        isOpen={isSingleSaveDialogOpen}
        onOpenChange={setIsSingleSaveDialogOpen}
        defaultFileName={`${selectedSaveInfo?.regionRaw ?? ""}${selectedSaveInfo?.productCode ?? ""}${selectedSaveInfo?.identifier ?? ""}`}
        onSave={handleExportSingleSaveConfirm}
      />
    </>
  );
};
