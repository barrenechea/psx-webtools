import { useRef, useState } from "react";

import { MemcarduinoConnectDialog } from "@/components/memcarduino-connect-dialog";
import SaveMemoryCardDialog from "@/components/save-dialog";
import SaveSingleSaveDialog from "@/components/save-single-save-dialog";
import { UniromConnectDialog } from "@/components/unirom-connect-dialog";
import { useDeviceManager } from "@/hooks/use-device-manager";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { findLinkedSlots, findParentSlot } from "@/lib/memory-card-slots";
import PS1MemoryCard, {
  CardTypes,
  type SaveInfo,
  SingleSaveTypes,
  SlotTypes,
} from "@/lib/ps1-memory-card";

import AlphaNoticeDialog from "../alpha-notice-dialog";
import { DragDropWrapper } from "../drag-drop-wrapper";
import { CardContentHeader } from "./card-content-header";
import { CardSidebar } from "./card-sidebar";
import { GameDetailsSidebar } from "./game-details-sidebar";
import { MemoryCardToolbar } from "./memory-card-toolbar";
import { SlotList } from "./slot-list";
import type { MemoryCard } from "./types";

let lastCardId = 0;
const nextCardId = (): number => ++lastCardId;

export const MemoryCardManager: React.FC = () => {
  const [isAlphaNoticeOpen, setIsAlphaNoticeOpen] = useState(true);

  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isUniromDialogOpen, setIsUniromDialogOpen] = useState(false);
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
    connectionError,
    connectedDevice,
    firmwareVersion,
    connectMemcarduino,
    connectUnirom,
    disconnectDevice,
    readCard,
    writeCard,
  } = useDeviceManager();

  const handleMemcarduinoConnect = async (
    deviceType: string,
    connectionMode: string,
  ) => {
    try {
      await connectMemcarduino(deviceType, connectionMode);
      setIsConnectDialogOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleUniromConnect = async (cardSlot: number) => {
    try {
      await connectUnirom(cardSlot);
      setIsUniromDialogOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectDevice();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleReadFromDevice = async () => {
    setError(null);
    try {
      const card = await readCard(fixCorrupted);
      const newMemoryCard: MemoryCard = {
        id: nextCardId(),
        name: `${connectedDevice ?? "Device"} Read`,
        type: "device",
        source: `${connectedDevice ?? "Device"} v${firmwareVersion}`,
        card,
      };
      setMemoryCards((prev) => [...prev, newMemoryCard]);
      setSelectedCard(newMemoryCard.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleWriteToDevice = async () => {
    if (selectedCard === null) return;
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (!card) return;
    setError(null);
    try {
      await writeCard(card);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSelectCard = (id: number) => {
    setSelectedSlot(null);
    setSelectedCard(id);
    setSidebarOpen(false);
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

  const selectedCardEntry = memoryCards.find((c) => c.id === selectedCard);

  return (
    <>
      <DragDropWrapper onFileDrop={(files) => void handleFilesOpen(files)}>
        <div className="flex h-full w-full items-center justify-center bg-transparent p-4">
          <div className="flex size-full max-w-7xl flex-col overflow-hidden rounded-xl shadow-xl">
            <MemoryCardToolbar
              selectedSlot={selectedSlot}
              selectedCard={selectedCard}
              hasCopiedSave={copiedSaveBytes !== null}
              isSlotEmpty={isSlotEmpty}
              onCopy={() => handleCopyMove("copy")}
              onMove={() => handleCopyMove("move")}
              onPaste={handlePaste}
              onDelete={handleDelete}
              onSave={() => void handleSaveMemoryCard()}
              onExport={handleExportSingleSave}
              onImport={handleImportSingleSave}
            />
            <div className="flex grow overflow-hidden">
              <CardSidebar
                cards={memoryCards}
                selectedCard={selectedCard}
                onSelectCard={handleSelectCard}
                fileInputRef={fileInputRef}
                onFileChange={handleFileInputChange}
                onOpenFile={handleOpenFromFileClick}
                onConnectMemcarduino={() => setIsConnectDialogOpen(true)}
                onConnectUnirom={() => setIsUniromDialogOpen(true)}
                fixCorrupted={fixCorrupted}
                onFixCorruptedChange={setFixCorrupted}
                isConnected={isConnected}
                connectedDevice={connectedDevice}
                onDisconnect={() => void handleDisconnect()}
                onRead={() => void handleReadFromDevice()}
                onWrite={() => void handleWriteToDevice()}
              />
              <div className="flex grow flex-row bg-transparent">
                {selectedCardEntry ? (
                  <>
                    <div className="flex grow flex-col">
                      <CardContentHeader
                        card={selectedCardEntry.card}
                        name={selectedCardEntry.name}
                        type={selectedCardEntry.type}
                        source={selectedCardEntry.source}
                        copiedSlots={copiedSlots}
                      />
                      <SlotList
                        card={selectedCardEntry.card}
                        selectedSlot={selectedSlot}
                        onSlotClick={handleSlotClick}
                      />
                    </div>
                    {sidebarOpen && (
                      <GameDetailsSidebar
                        gameId={selectedGameId ?? ""}
                        region={selectedRegion ?? ""}
                        onClose={() => setSidebarOpen(false)}
                      />
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
        defaultFileName={selectedCardEntry?.name ?? "memory_card"}
        defaultFormat={selectedCardEntry?.card.getCardType() ?? CardTypes.Raw}
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
