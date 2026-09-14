import { useRef, useState } from "react";

import { MemoryCardDeviceDialogs } from "@/components/memory-card/memory-card-device-dialogs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  gameDataTargetsFromCards,
  usePrefetchGameData,
} from "@/hooks/use-game-data";
import { useMemoryCardDeviceOps } from "@/hooks/use-memory-card-device-ops";
import {
  isPs2Entry,
  useMemoryCardWorkspace,
} from "@/hooks/use-memory-card-workspace";
import { usePersistentState } from "@/hooks/use-persistent-state";

import { DragDropWrapper } from "../drag-drop-wrapper";
import { CardSidebar } from "./card-sidebar";
import { CompareSaveDialog, type CompareSaveData } from "./compare-save-dialog";
import { MemoryCardToolbar } from "./memory-card-toolbar";
import { Ps1CardPane } from "./ps1-card-pane";
import { Ps2CardPane } from "./ps2-card-pane";
import { Ps2NewCardDialog } from "./ps2-new-card-dialog";
import {
  EMPTY_FAMILY_CAPS,
  NOOP_FAMILY_HANDLERS,
  type FamilyToolbarCaps,
  type FamilyToolbarHandlers,
  type MemoryCardToolbarCaps,
} from "./types";

export const MemoryCardManager: React.FC = () => {
  const {
    memoryCards,
    selectedCard,
    tempBuffer,
    historyLabels,
    selectedEntry,
    selectedStatus,
    selectCard,
    setTempBuffer,
    commit,
    commitAsync,
    bump,
    addNewPs1Card,
    addNewPs2Card,
    addCard,
    removeCard,
    jumpToHistory,
    undo,
    redo,
    openFiles,
  } = useMemoryCardWorkspace();

  const [error, setError] = useState<string | null>(null);
  const [isPs2NewCardDialogOpen, setIsPs2NewCardDialogOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<number | null>(null);
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<CompareSaveData | null>(null);
  const [familyCaps, setFamilyCaps] =
    useState<FamilyToolbarCaps>(EMPTY_FAMILY_CAPS);
  const [fixCorrupted, setFixCorrupted] = usePersistentState(
    "psx-webtools.fixCorruptedCards",
    false,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const familyHandlersRef = useRef<FamilyToolbarHandlers>(NOOP_FAMILY_HANDLERS);

  const device = useMemoryCardDeviceOps({
    addCard,
    selectCard,
    selectedEntry,
    fixCorrupted,
    setError,
  });

  usePrefetchGameData(gameDataTargetsFromCards(memoryCards));

  const handleFilesOpen = async (files: File[]) => {
    setError(await openFiles(files, fixCorrupted));
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

  const handleCloseCard = (id: number) => {
    const card = memoryCards.find((c) => c.id === id);
    if (!card) return;
    if (card.view.changed) {
      setPendingClose(id);
      setCloseConfirmOpen(true);
    } else {
      removeCard(id);
    }
  };

  const handleConfirmClose = () => {
    if (pendingClose !== null) removeCard(pendingClose);
    setPendingClose(null);
    setCloseConfirmOpen(false);
  };

  const handleCompare = (data: CompareSaveData) => {
    setCompareData(data);
    setIsCompareDialogOpen(true);
  };

  const cardHistory = selectedEntry
    ? (historyLabels[selectedEntry.id] ?? [selectedEntry.name])
    : [];
  const undoCount = selectedEntry?.view.undoCount ?? 0;
  const redoCount = selectedEntry?.view.redoCount ?? 0;

  const toolbarCaps: MemoryCardToolbarCaps = {
    ...familyCaps,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    canHistory: selectedCard !== null,
    history: cardHistory,
    historyIndex: undoCount,
  };

  return (
    <>
      <DragDropWrapper onFileDrop={(files) => void handleFilesOpen(files)}>
        <div className="flex h-full w-full items-center justify-center bg-transparent p-4">
          <div className="flex size-full max-w-7xl flex-col overflow-hidden rounded-xl shadow-xl">
            <MemoryCardToolbar
              caps={toolbarCaps}
              familyRef={familyHandlersRef}
              onUndo={undo}
              onRedo={redo}
              onJumpToHistory={jumpToHistory}
            />
            <div className="flex grow overflow-hidden">
              <CardSidebar
                cards={memoryCards}
                selectedCard={selectedCard}
                onSelectCard={selectCard}
                onNewCard={addNewPs1Card}
                onNewPs2Card={() => setIsPs2NewCardDialogOpen(true)}
                onCloseCard={handleCloseCard}
                fileInputRef={fileInputRef}
                onFileChange={handleFileInputChange}
                onOpenFile={handleOpenFromFileClick}
                onConnectDexDrive={device.onConnectDexDrive}
                onConnectMemcarduino={device.onConnectMemcarduino}
                onConnectPS1CardLink={device.onConnectPS1CardLink}
                onConnectPS3MCA={device.onConnectPS3MCA}
                onConnectUnirom={device.onConnectUnirom}
                onPocketStation={device.onPocketStation}
                fixCorrupted={fixCorrupted}
                onFixCorruptedChange={setFixCorrupted}
                isConnected={device.isConnected}
                connectedDevice={device.connectedDevice}
                canPocketStation={device.canPocketStation}
                onDisconnect={device.onDisconnect}
                onRead={device.onRead}
                onWrite={device.onWrite}
                onFormat={device.onFormat}
              />
              <div className="flex grow flex-row bg-transparent">
                {selectedEntry === undefined ? (
                  <div className="flex grow flex-col items-center justify-center bg-card/80 p-4 text-muted-foreground">
                    <p className="mb-4 text-lg">No memory card selected</p>
                    <p className="text-sm">
                      Open a memory card file or connect a device to get started
                    </p>
                  </div>
                ) : isPs2Entry(selectedEntry) ? (
                  <Ps2CardPane
                    key={selectedEntry.id}
                    card={selectedEntry.card}
                    view={selectedEntry.view}
                    cardId={selectedEntry.id}
                    cardName={selectedEntry.name}
                    cardType={selectedEntry.type}
                    cardSource={selectedEntry.source}
                    tempBuffer={tempBuffer}
                    familyHandlersRef={familyHandlersRef}
                    onFamilyCapsChange={setFamilyCaps}
                    onTempBufferChange={setTempBuffer}
                    onCompare={handleCompare}
                    onError={setError}
                    commit={commit}
                    bump={bump}
                  />
                ) : (
                  <Ps1CardPane
                    key={selectedEntry.id}
                    card={selectedEntry.card}
                    view={selectedEntry.view}
                    cardId={selectedEntry.id}
                    cardName={selectedEntry.name}
                    cardType={selectedEntry.type}
                    cardSource={selectedEntry.source}
                    tempBuffer={tempBuffer}
                    familyHandlersRef={familyHandlersRef}
                    onFamilyCapsChange={setFamilyCaps}
                    onTempBufferChange={setTempBuffer}
                    onCompare={handleCompare}
                    onError={setError}
                    commit={commit}
                    bump={bump}
                    onOpenFiles={(files) => void handleFilesOpen(files)}
                    commitAsync={commitAsync}
                    fixCorrupted={fixCorrupted}
                  />
                )}
              </div>
            </div>
            <div className="border-t border-border bg-muted/80 px-4 py-2 text-sm text-muted-foreground">
              {error ?? device.connectionError ?? selectedStatus}
            </div>
          </div>
        </div>
      </DragDropWrapper>
      <MemoryCardDeviceDialogs {...device.dialogs} />
      {compareData && (
        <CompareSaveDialog
          isOpen={isCompareDialogOpen}
          onOpenChange={setIsCompareDialogOpen}
          save1Name={compareData.save1Name}
          save2Name={compareData.save2Name}
          save1Bytes={compareData.save1Bytes}
          save2Bytes={compareData.save2Bytes}
        />
      )}
      <Ps2NewCardDialog
        isOpen={isPs2NewCardDialogOpen}
        onOpenChange={setIsPs2NewCardDialogOpen}
        onConfirm={addNewPs2Card}
      />
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              This card has unsaved changes. Closing it will discard those
              changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose}>
              Close anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
