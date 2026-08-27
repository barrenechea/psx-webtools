import { useRef, useState } from "react";

import { MemcarduinoConnectDialog } from "@/components/memcarduino-connect-dialog";
import { PS1CardLinkConnectDialog } from "@/components/ps1cardlink-connect-dialog";
import SaveMemoryCardDialog from "@/components/save-dialog";
import SaveSingleSaveDialog from "@/components/save-single-save-dialog";
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
import { UniromConnectDialog } from "@/components/unirom-connect-dialog";
import { useDeviceManager } from "@/hooks/use-device-manager";
import { usePrefetchGameData } from "@/hooks/use-game-data";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { SaveFormatOption } from "@/hooks/use-save-file-form";
import PS1MemoryCard, {
  CardExtensions,
  CardTypes,
  DataTypes,
  type IconPalette,
  IconTypes,
  RAW_EXTENSIONS,
  type SaveInfo,
  SingleSaveExtensions,
  SingleSaveTypes,
  type SlotIconData,
  SlotTypes,
} from "@/lib/ps1-memory-card";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import {
  PS2_RAW_EXTENSIONS,
  PS2_SINGLE_SAVE_EXTENSIONS,
  Ps2CardFormats,
  Ps2SingleSaveTypes,
} from "@/lib/ps2/ps2-types";

import { DragDropWrapper } from "../drag-drop-wrapper";
import { CardContentHeader } from "./card-content-header";
import { CardSidebar } from "./card-sidebar";
import { CompareSaveDialog } from "./compare-save-dialog";
import { EditCommentDialog } from "./edit-comment-dialog";
import { EditHeaderDialog } from "./edit-header-dialog";
import { FormatCardDialog } from "./format-card-dialog";
import { GameDetailsSidebar } from "./game-details-sidebar";
import type { SlotAction } from "./memory-card-slot";
import { MemoryCardToolbar } from "./memory-card-toolbar";
import { PocketStationDialog } from "./pocketstation-dialog";
import { Ps2ImportSaveDialog } from "./ps2-import-save-dialog";
import { Ps2NewCardDialog } from "./ps2-new-card-dialog";
import { Ps2SaveInfoSidebar } from "./ps2-save-info-sidebar";
import { Ps2SaveList } from "./ps2-save-list";
import { SaveInfoDialog } from "./save-info-dialog";
import { SlotList } from "./slot-list";
import { isPs2Card, type MemoryCard } from "./types";
import { WriteCardDialog } from "./write-card-dialog";

let lastCardId = 0;
const nextCardId = (): number => ++lastCardId;

// Save-dialog format lists. PS1 entries derive from the PS1 extension maps so
// the generalized dialogs keep their exact previous options; PS2 is a single
// raw-image format plus the .sdt single-save format.
const PS1_CARD_FORMATS: readonly SaveFormatOption<CardTypes>[] = [
  {
    value: CardTypes.Raw,
    label: "Raw Memory Card",
    extensions: RAW_EXTENSIONS,
  },
  {
    value: CardTypes.Mcx,
    label: "MCX Format (.mcx)",
    extensions: [CardExtensions[CardTypes.Mcx]],
  },
  {
    value: CardTypes.Vmp,
    label: "VMP Format (.vmp)",
    extensions: [CardExtensions[CardTypes.Vmp]],
  },
  {
    value: CardTypes.Vgs,
    label: "VGS Format (.vgs)",
    extensions: [CardExtensions[CardTypes.Vgs]],
  },
  {
    value: CardTypes.Gme,
    label: "GME Format (.gme)",
    extensions: [CardExtensions[CardTypes.Gme]],
  },
];

const PS1_SINGLE_SAVE_FORMATS: readonly SaveFormatOption<SingleSaveTypes>[] = [
  {
    value: SingleSaveTypes.Mcs,
    label: "MCS single save (.mcs)",
    extensions: [SingleSaveExtensions[SingleSaveTypes.Mcs]],
  },
  {
    value: SingleSaveTypes.Psv,
    label: "PS3 single save (.psv)",
    extensions: [SingleSaveExtensions[SingleSaveTypes.Psv]],
  },
  {
    value: SingleSaveTypes.Psx,
    label: "Action Replay (.mcb)",
    extensions: [SingleSaveExtensions[SingleSaveTypes.Psx]],
  },
  {
    value: SingleSaveTypes.Raw,
    label: "RAW single save",
    extensions: [SingleSaveExtensions[SingleSaveTypes.Raw]],
  },
];

const PS2_CARD_FORMATS: readonly SaveFormatOption<Ps2CardFormats>[] = [
  {
    value: Ps2CardFormats.Raw,
    label: "Raw Memory Card",
    extensions: PS2_RAW_EXTENSIONS,
  },
];

const PS2_SINGLE_SAVE_FORMATS: readonly SaveFormatOption<Ps2SingleSaveTypes>[] =
  [
    {
      value: Ps2SingleSaveTypes.Sdt,
      label: "Single save (.sdt)",
      extensions: PS2_SINGLE_SAVE_EXTENSIONS,
    },
  ];

// PS2 copy naming: keep the prefix and increment the trailing 4-digit index
// (BASLUS-21590GTA40001 -> ...0002), like the console auto-numbers saves.
const nextPs2SaveName = (existingNames: string[], source: string): string => {
  const hasIndex = /^\d{4}$/.test(source.slice(-4));
  const prefix = hasIndex ? source.slice(0, -4) : source;
  const start = hasIndex ? parseInt(source.slice(-4), 10) : 0;
  for (let i = start + 1; ; i++) {
    const candidate = `${prefix}${String(i).padStart(4, "0")}`;
    if (!existingNames.includes(candidate)) return candidate;
  }
};

export const MemoryCardManager: React.FC = () => {
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [selectedPs2Save, setSelectedPs2Save] = useState<string | null>(null);
  const [isPs2ImportDialogOpen, setIsPs2ImportDialogOpen] = useState(false);
  const [isPs2NewCardDialogOpen, setIsPs2NewCardDialogOpen] = useState(false);
  const [ps2ImportFile, setPs2ImportFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isPS1CardLinkDialogOpen, setIsPS1CardLinkDialogOpen] = useState(false);
  const [isUniromDialogOpen, setIsUniromDialogOpen] = useState(false);
  const [copiedSlots, setCopiedSlots] = useState<SaveInfo[]>([]);
  const [copiedSaveBytes, setCopiedSaveBytes] = useState<Uint8Array | null>(
    null,
  );
  // Snapshot of the copied save's icon, captured at copy time so the buffer
  // preview survives a Move (which formats the source slot in place).
  const [copiedIcon, setCopiedIcon] = useState<{
    data: SlotIconData;
    palette: IconPalette;
    frameCount: number;
  } | null>(null);
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [isSingleSaveDialogOpen, setIsSingleSaveDialogOpen] = useState(false);
  const [isHeaderDialogOpen, setIsHeaderDialogOpen] = useState(false);
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [isPocketStationDialogOpen, setIsPocketStationDialogOpen] =
    useState(false);
  const [dialogSlot, setDialogSlot] = useState<number | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState<number | null>(null);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [isCompareDialogOpen, setIsCompareDialogOpen] = useState(false);
  const [compareData, setCompareData] = useState<{
    save1Name: string;
    save1Bytes: Uint8Array;
    save2Name: string;
    save2Bytes: Uint8Array;
  } | null>(null);
  const [historyLabels, setHistoryLabels] = useState<Record<number, string[]>>(
    {},
  );

  // Append a labeled history step for a card mutation. `rowBefore` is the
  // card's undoCount captured before the mutation; labels past that point (the
  // redo branch) are dropped, since a new edit abandons it.
  const appendHistoryLabel = (
    cardId: number,
    rowBefore: number,
    label: string,
  ) => {
    setHistoryLabels((prev) => {
      const name = memoryCards.find((c) => c.id === cardId)?.name ?? "Card";
      const current = prev[cardId] ?? [name];
      return { ...prev, [cardId]: [...current.slice(0, rowBefore + 1), label] };
    });
  };

  // Time-travel to a history position by replaying undo/redo steps, mirroring
  // the reference (which loops Undo/Redo until UndoCount matches the row).
  const handleJumpToHistory = (index: number) => {
    if (selectedCard === null) return;
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (!card) return;
    const current = card.undoCount;
    if (index < current) {
      for (let i = 0; i < current - index; i++) card.undo();
    } else {
      for (let i = 0; i < index - current; i++) card.redo();
    }
    setMemoryCards([...memoryCards]);
  };
  const [fixCorrupted, setFixCorrupted] = usePersistentState(
    "psx-webtools.fixCorruptedCards",
    false,
  );
  const [verifyAfterWrite, setVerifyAfterWrite] = usePersistentState(
    "psx-webtools.verifyAfterWrite",
    true,
  );
  const [isWriteDialogOpen, setIsWriteDialogOpen] = useState(false);
  const [isFormatDialogOpen, setIsFormatDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const singleSaveFileInputRef = useRef<HTMLInputElement>(null);
  const ps2ImportFileInputRef = useRef<HTMLInputElement>(null);

  const {
    isConnected,
    connectionError,
    connectedDevice,
    firmwareVersion,
    connectDexDrive,
    connectMemcarduino,
    connectPS1CardLink,
    connectPS3MCA,
    connectUnirom,
    disconnectDevice,
    readCard,
    writeCard,
    formatCard,
    readPocketStationSerial,
    dumpPocketStationBIOS,
    setPocketStationTime,
  } = useDeviceManager();

  usePrefetchGameData(
    memoryCards.flatMap((entry) =>
      isPs2Card(entry.card) ? [] : entry.card.getSaves(),
    ),
  );

  // PS1-only view of a card entry; the slot-based handlers below are PS1.
  const ps1Card = (id: number | null): PS1MemoryCard | undefined => {
    const entry =
      id === null ? undefined : memoryCards.find((c) => c.id === id);
    return entry && !isPs2Card(entry.card) ? entry.card : undefined;
  };

  // PS2-only view of a card entry; the save-dir handlers are PS2.
  const ps2Card = (id: number | null): PS2MemoryCard | undefined => {
    const entry =
      id === null ? undefined : memoryCards.find((c) => c.id === id);
    return entry && isPs2Card(entry.card) ? entry.card : undefined;
  };

  const handleDexDriveConnect = async () => {
    try {
      await connectDexDrive();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handlePS3MCAConnect = async () => {
    try {
      await connectPS3MCA();
    } catch (err) {
      setError((err as Error).message);
    }
  };

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

  const handlePS1CardLinkConnect = async (cardSlot: number) => {
    try {
      await connectPS1CardLink(cardSlot);
      setIsPS1CardLinkDialogOpen(false);
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
      const deviceLabel = connectedDevice ?? "Device";
      const newMemoryCard: MemoryCard = {
        id: nextCardId(),
        name: `${deviceLabel} Read`,
        type: "device",
        source: firmwareVersion
          ? `${deviceLabel} v${firmwareVersion}`
          : deviceLabel,
        card,
      };
      setMemoryCards((prev) => [...prev, newMemoryCard]);
      setSelectedCard(newMemoryCard.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleWriteToDevice = () => {
    if (selectedCard === null) return;
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (card && isPs2Card(card)) {
      setError("Writing PS2 cards over hardware is not supported yet");
      return;
    }
    setIsWriteDialogOpen(true);
  };

  const handleWriteConfirm = async () => {
    if (selectedCard === null) return;
    const card = ps1Card(selectedCard);
    if (!card) return;
    setIsWriteDialogOpen(false);
    setError(null);
    try {
      await writeCard(card, verifyAfterWrite);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleFormatConfirm = async (quick: boolean) => {
    setIsFormatDialogOpen(false);
    setError(null);
    try {
      await formatCard(quick);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSelectCard = (id: number) => {
    setSelectedSlot(null);
    setSelectedPs2Save(null);
    setSelectedCard(id);
    setSidebarOpen(false);
  };

  const handleFilesOpen = async (files: File[]) => {
    if (files.length === 0) return;

    const openedCards: MemoryCard[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        // Probe by content: PS2 first (size % 528 + superblock magic),
        // otherwise PS1.
        const bytes = new Uint8Array(await file.arrayBuffer());
        const ps2Card = PS2MemoryCard.tryFromBytes(bytes);
        let card: PS1MemoryCard | PS2MemoryCard;
        if (ps2Card) {
          card = ps2Card;
        } else {
          const ps1 = new PS1MemoryCard();
          await ps1.loadFromFile(file, fixCorrupted);
          card = ps1;
        }
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
      setSelectedSlot(null);
      setSelectedPs2Save(null);
      setSidebarOpen(false);
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
    if (selectedCard === null) return;
    const ps2 = ps2Card(selectedCard);
    if (ps2) {
      if (selectedPs2Save === null) return;
      const rowBefore = ps2.undoCount;
      if (ps2.deleteSave(selectedPs2Save)) {
        appendHistoryLabel(selectedCard, rowBefore, "Save deleted");
        setSelectedPs2Save(null);
        setMemoryCards([...memoryCards]);
      } else {
        setError("Failed to delete save");
      }
      return;
    }
    if (selectedSlot !== null) {
      const card = ps1Card(selectedCard);
      if (card) {
        const isRestore =
          card.getSaves()[selectedSlot].slotType === SlotTypes.DeletedInitial;
        const rowBefore = card.undoCount;
        card.toggleDeleteSave(selectedSlot);
        appendHistoryLabel(
          selectedCard,
          rowBefore,
          isRestore ? "Save restored" : "Save deleted",
        );
        setMemoryCards([...memoryCards]);
      }
    }
  };

  const handleNewCard = () => {
    const card = new PS1MemoryCard();
    card.formatCard();
    const newMemoryCard: MemoryCard = {
      id: nextCardId(),
      name: "New Card",
      type: "new",
      source: "",
      card,
    };
    setMemoryCards((prev) => [...prev, newMemoryCard]);
    setSelectedCard(newMemoryCard.id);
    setSelectedSlot(null);
  };

  const handlePs2NewCard = (sizeMb: number) => {
    const card = PS2MemoryCard.format(sizeMb * 1024);
    const newMemoryCard: MemoryCard = {
      id: nextCardId(),
      name: "New PS2 Card",
      type: "new",
      source: "",
      card,
    };
    setMemoryCards((prev) => [...prev, newMemoryCard]);
    setSelectedCard(newMemoryCard.id);
    setSelectedSlot(null);
    setSelectedPs2Save(null);
  };

  const removeCard = (id: number) => {
    setMemoryCards((prev) => prev.filter((c) => c.id !== id));
    setHistoryLabels((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedCard === id) {
      setSelectedCard(null);
      setSelectedSlot(null);
      setSelectedPs2Save(null);
    }
  };

  const handleCloseCard = (id: number) => {
    const card = memoryCards.find((c) => c.id === id);
    if (!card) return;
    if (card.card.changed) {
      setPendingClose(id);
      setCloseConfirmOpen(true);
    } else {
      removeCard(id);
    }
  };

  const handleConfirmClose = () => {
    if (pendingClose !== null) {
      removeCard(pendingClose);
    }
    setPendingClose(null);
    setCloseConfirmOpen(false);
  };

  const handleUndo = () => {
    if (selectedCard === null) return;
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (card) {
      card.undo();
      setMemoryCards([...memoryCards]);
    }
  };

  const handleRedo = () => {
    if (selectedCard === null) return;
    const card = memoryCards.find((c) => c.id === selectedCard)?.card;
    if (card) {
      card.redo();
      setMemoryCards([...memoryCards]);
    }
  };

  const handleEditHeaderConfirm = (
    productCode: string,
    identifier: string,
    region: string,
  ) => {
    if (dialogSlot !== null && selectedCard !== null) {
      const card = ps1Card(selectedCard);
      if (card) {
        const rowBefore = card.undoCount;
        card.setHeaderData(dialogSlot, productCode, identifier, region);
        appendHistoryLabel(selectedCard, rowBefore, "Header edited");
        setMemoryCards([...memoryCards]);
      }
    }
    setIsHeaderDialogOpen(false);
  };

  const handleEditCommentConfirm = (comment: string) => {
    if (dialogSlot !== null && selectedCard !== null) {
      const card = ps1Card(selectedCard);
      if (card) {
        const rowBefore = card.undoCount;
        card.setComment(dialogSlot, comment);
        appendHistoryLabel(selectedCard, rowBefore, "Comment edited");
        setMemoryCards([...memoryCards]);
      }
    }
    setIsCommentDialogOpen(false);
  };

  const handleRemoveSaveConfirm = () => {
    if (dialogSlot !== null && selectedCard !== null) {
      const card = ps1Card(selectedCard);
      if (card) {
        const parentSlot = card.getMasterLinkForSlot(dialogSlot);
        const rowBefore = card.undoCount;
        card.formatSave(parentSlot);
        appendHistoryLabel(selectedCard, rowBefore, "Save removed");
        setSelectedSlot(null);
        setMemoryCards([...memoryCards]);
      }
    }
    setRemoveConfirmOpen(false);
  };

  const handleSlotAction = (action: SlotAction, index: number) => {
    const card = ps1Card(selectedCard);
    // Resolve to the save's first (master) slot so header/comment/info edits
    // target the real save, not a linked continuation slot.
    const master = card ? card.getMasterLinkForSlot(index) : index;
    setDialogSlot(master);
    switch (action) {
      case "editHeader":
        setIsHeaderDialogOpen(true);
        break;
      case "editComment":
        setIsCommentDialogOpen(true);
        break;
      case "info":
        setIsInfoDialogOpen(true);
        break;
      case "remove":
        setRemoveConfirmOpen(true);
        break;
      case "compare": {
        const compareCard = ps1Card(selectedCard);
        if (compareCard && copiedSaveBytes !== null) {
          const fetched = compareCard.getSaveBytes(master);
          setCompareData({
            save1Name: compareCard.getSaves()[master].name,
            save1Bytes: fetched,
            save2Name: copiedSlots[0]?.name ?? "temp buffer",
            save2Bytes: copiedSaveBytes,
          });
          setIsCompareDialogOpen(true);
        }
        break;
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
      const card = ps1Card(selectedCard);
      if (card) {
        const success = await card.saveMemoryCard(
          fileName,
          format,
          fixCorrupted,
        );
        if (success) {
          setError(null);
          // The save cleared the card's dirty flag; re-render so the
          // unsaved-changes dot updates.
          setMemoryCards([...memoryCards]);
        } else {
          setError("Failed to save memory card");
        }
        setIsSaveDialogOpen(false);
      }
    }
  };

  const handlePs2SaveConfirm = async (fileName: string) => {
    if (selectedCard === null) return;
    const card = ps2Card(selectedCard);
    if (card) {
      const success = await card.saveMemoryCard(fileName);
      if (success) {
        setError(null);
        setMemoryCards([...memoryCards]);
      } else {
        setError("Failed to save memory card");
      }
      setIsSaveDialogOpen(false);
    }
  };

  const selectedSaveInfo =
    selectedSlot !== null
      ? ps1Card(selectedCard)?.getSaves()[selectedSlot]
      : undefined;
  const isSlotEmpty = selectedSaveInfo?.slotType === SlotTypes.Formatted;
  // The Delete button toggles delete/restore, so it applies to any real save
  // (regular or deleted) but not to empty or corrupted slots.
  const isDeletable =
    selectedSaveInfo?.slotType === SlotTypes.Initial ||
    selectedSaveInfo?.slotType === SlotTypes.DeletedInitial;

  const dialogCard = dialogSlot !== null ? ps1Card(selectedCard) : undefined;
  const dialogSaveInfo =
    dialogSlot !== null && dialogCard
      ? dialogCard.getSaves()[dialogSlot]
      : undefined;
  const dialogLinkedSlots =
    dialogSlot !== null && dialogCard
      ? dialogCard.getSaveLinks(dialogCard.getMasterLinkForSlot(dialogSlot))
      : [];

  const handleExportSingleSave = () => {
    if (selectedCard === null) return;
    if (ps2Card(selectedCard)) {
      if (selectedPs2Save !== null) setIsSingleSaveDialogOpen(true);
      return;
    }
    if (selectedSlot === null || isSlotEmpty) return;
    setIsSingleSaveDialogOpen(true);
  };

  const handleExportSingleSaveConfirm = async (
    fileName: string,
    saveType: SingleSaveTypes,
  ) => {
    if (selectedCard !== null && selectedSlot !== null) {
      const card = ps1Card(selectedCard);
      if (card) {
        const parentSlot = card.getMasterLinkForSlot(selectedSlot);
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

  const handlePs2ExportConfirm = async (fileName: string) => {
    if (selectedCard !== null && selectedPs2Save !== null) {
      const card = ps2Card(selectedCard);
      if (card) {
        const success = await card.saveSingleSave(fileName, selectedPs2Save);
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

  // PS2 import: pick a data file first, then name the new save dir.
  const handleImportPs2Save = () => {
    const input = ps2ImportFileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const handlePs2ImportFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPs2ImportFile(file);
    setIsPs2ImportDialogOpen(true);
  };

  const handlePs2ImportConfirm = async (
    name: string,
    title: string,
  ): Promise<boolean> => {
    if (selectedCard === null || ps2ImportFile === null) return false;
    const card = ps2Card(selectedCard);
    if (!card) return false;
    const bytes = new Uint8Array(await ps2ImportFile.arrayBuffer());
    const rowBefore = card.undoCount;
    const success = card.importSingleSave(name, bytes, {
      title: title.length > 0 ? title : undefined,
    });
    if (success) {
      appendHistoryLabel(selectedCard, rowBefore, "Save imported");
      setSelectedPs2Save(name);
      setMemoryCards([...memoryCards]);
      setPs2ImportFile(null);
      return true;
    }
    setError("Failed to import save");
    return false;
  };

  const handleImportSave = () => {
    if (selectedCard !== null && ps2Card(selectedCard)) {
      handleImportPs2Save();
    } else {
      handleImportSingleSave();
    }
  };

  const importSingleSaveIntoSlot = async (
    file: File,
    slot: number,
  ): Promise<boolean> => {
    if (selectedCard === null) return false;
    const card = ps1Card(selectedCard);
    if (!card) return false;
    const cardId = selectedCard;
    const success = await card.openSingleSave(file, slot);
    if (success) {
      // Anchor on the position the commit actually landed on (undoCount after
      // the await), not a value captured before it, so a concurrent jump can't
      // attach the label to the wrong step.
      appendHistoryLabel(cardId, card.undoCount - 1, "Save imported");
      setMemoryCards([...memoryCards]);
    }
    return success;
  };

  const handleImportSingleSaveChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || selectedCard === null || selectedSlot === null) return;
    const success = await importSingleSaveIntoSlot(file, selectedSlot);
    setError(success ? null : "Failed to import save");
  };

  const handleFileDrop = async (files: File[]) => {
    // With a card and slot selected, a dropped single-save file imports into
    // that slot (auto-detecting its format); anything else opens as a card.
    if (files.length === 1 && selectedCard !== null && selectedSlot !== null) {
      const droppedCard = ps1Card(selectedCard);
      if (
        droppedCard &&
        droppedCard.getSaves()[selectedSlot].slotType !== SlotTypes.Formatted
      ) {
        // A specific slot was targeted but it isn't empty: reject rather than
        // silently importing into another free slot.
        setError("The selected slot is not empty");
        return;
      }
      const imported = await importSingleSaveIntoSlot(files[0], selectedSlot);
      if (imported) return;
    }
    void handleFilesOpen(files);
  };

  const handleCopyMove = (action: "copy" | "move") => {
    if (selectedCard !== null) {
      const ps2 = ps2Card(selectedCard);
      // PS2 copy clones the save dir under the next free auto-numbered name;
      // PS2 has no temp buffer, so Move is disabled in the toolbar.
      if (ps2 && action === "copy" && selectedPs2Save !== null) {
        const newName = nextPs2SaveName(
          ps2.getSaves().map((s) => s.name),
          selectedPs2Save,
        );
        const rowBefore = ps2.undoCount;
        if (ps2.copySave(selectedPs2Save, newName)) {
          appendHistoryLabel(
            selectedCard,
            rowBefore,
            `Save copied to ${newName}`,
          );
          setSelectedPs2Save(newName);
          setMemoryCards([...memoryCards]);
        } else {
          setError("Failed to copy save");
        }
        return;
      }
    }
    if (selectedCard !== null && selectedSlot !== null) {
      const cardEntry = memoryCards.find((c) => c.id === selectedCard);
      const card = ps1Card(selectedCard);
      if (cardEntry && card) {
        const parentSlot = card.getMasterLinkForSlot(selectedSlot);
        const linkedSlots = card.getSaveLinks(parentSlot);
        const copiedSaves = linkedSlots.map(
          (slotIndex) => card.getSaves()[slotIndex],
        );
        setCopiedSlots(copiedSaves);
        setCopiedSaveBytes(card.getSaveBytes(parentSlot));
        setCopiedIcon({
          data: card.getIconData(parentSlot),
          palette: card.getIconPalette(parentSlot),
          frameCount: copiedSaves[0].iconFrameCount,
        });
        if (action === "move") {
          const rowBefore = card.undoCount;
          card.formatSave(parentSlot);
          appendHistoryLabel(cardEntry.id, rowBefore, "Save moved");
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
      const card = ps1Card(selectedCard);
      if (cardEntry && card) {
        const rowBefore = card.undoCount;
        const success = card.setSaveBytes(selectedSlot, copiedSaveBytes);
        if (success) {
          // Keep the buffer so the same save can be pasted into other free
          // slots (mirrors the reference's persistent temp buffer).
          appendHistoryLabel(cardEntry.id, rowBefore, "Save pasted");
          setMemoryCards([...memoryCards]);
        } else {
          setError("Not enough free space to paste save");
        }
      }
    }
  };

  const handleSlotClick = (index: number) => {
    const card = ps1Card(selectedCard);
    if (!card) return;

    const saves = card.getSaves();
    const parentSlot = card.getMasterLinkForSlot(index);
    const linkedSlots = card.getSaveLinks(parentSlot);

    setSelectedSlot((prev) =>
      linkedSlots.includes(prev ?? -1) ? null : parentSlot,
    );
    setSidebarOpen(true);
    setSelectedGameId(saves[parentSlot].productCode);
    setSelectedRegion(saves[parentSlot].region);
  };

  const handlePs2SaveClick = (name: string) => {
    setSelectedPs2Save((prev) => (prev === name ? null : name));
  };

  const selectedCardEntry = memoryCards.find((c) => c.id === selectedCard);
  const selectedPs1Card = ps1Card(selectedCard);
  const selectedPs2Card = ps2Card(selectedCard);
  const cardHistory = selectedCardEntry
    ? (historyLabels[selectedCardEntry.id] ?? [selectedCardEntry.name])
    : [];
  const historyIndex = selectedCardEntry?.card.undoCount ?? 0;

  const eraseChain =
    dialogSlot !== null &&
    selectedCardEntry &&
    !isPs2Card(selectedCardEntry.card)
      ? selectedCardEntry.card.getSaveLinks(dialogSlot)
      : [];
  const eraseMessage =
    eraseChain.length > 1
      ? `This will erase ${eraseChain.length} slots (${eraseChain
          .map((s) => s + 1)
          .join(", ")}), the entire multi-slot save.`
      : `This will erase the data in slot ${(dialogSlot ?? 0) + 1}.`;

  return (
    <>
      <DragDropWrapper onFileDrop={handleFileDrop}>
        <div className="flex h-full w-full items-center justify-center bg-transparent p-4">
          <div className="flex size-full max-w-7xl flex-col overflow-hidden rounded-xl shadow-xl">
            <MemoryCardToolbar
              selectedSlot={selectedSlot}
              selectedPs2Save={selectedPs2Save}
              selectedCard={selectedCard}
              cardKind={selectedCardEntry?.card.kind ?? "ps1"}
              hasCopiedSave={copiedSaveBytes !== null}
              isSlotEmpty={isSlotEmpty}
              isDeletable={isDeletable}
              canUndo={(selectedCardEntry?.card.undoCount ?? 0) > 0}
              canRedo={(selectedCardEntry?.card.redoCount ?? 0) > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              history={cardHistory}
              historyIndex={historyIndex}
              onJumpToHistory={handleJumpToHistory}
              onCopy={() => handleCopyMove("copy")}
              onMove={() => handleCopyMove("move")}
              onPaste={handlePaste}
              onDelete={handleDelete}
              onSave={() => void handleSaveMemoryCard()}
              onExport={handleExportSingleSave}
              onImport={handleImportSave}
            />
            <div className="flex grow overflow-hidden">
              <CardSidebar
                cards={memoryCards}
                selectedCard={selectedCard}
                onSelectCard={handleSelectCard}
                onNewCard={handleNewCard}
                onNewPs2Card={() => setIsPs2NewCardDialogOpen(true)}
                onCloseCard={handleCloseCard}
                fileInputRef={fileInputRef}
                onFileChange={handleFileInputChange}
                onOpenFile={handleOpenFromFileClick}
                onConnectDexDrive={() => void handleDexDriveConnect()}
                onConnectMemcarduino={() => setIsConnectDialogOpen(true)}
                onConnectPS1CardLink={() => setIsPS1CardLinkDialogOpen(true)}
                onConnectPS3MCA={() => void handlePS3MCAConnect()}
                onConnectUnirom={() => setIsUniromDialogOpen(true)}
                onPocketStation={() => setIsPocketStationDialogOpen(true)}
                fixCorrupted={fixCorrupted}
                onFixCorruptedChange={setFixCorrupted}
                isConnected={isConnected}
                connectedDevice={connectedDevice}
                onDisconnect={() => void handleDisconnect()}
                onRead={() => void handleReadFromDevice()}
                onWrite={handleWriteToDevice}
                onFormat={() => setIsFormatDialogOpen(true)}
              />
              <div className="flex grow flex-row bg-transparent">
                {selectedCardEntry ? (
                  <>
                    <div className="bg-card/60 flex min-h-0 grow flex-col">
                      <CardContentHeader
                        name={selectedCardEntry.name}
                        type={selectedCardEntry.type}
                        kind={selectedCardEntry.card.kind}
                        source={selectedCardEntry.source}
                        checksum={selectedCardEntry.card.getRawChecksum()}
                        copiedSlots={
                          selectedCardEntry.card.kind === "ps2"
                            ? []
                            : copiedSlots
                        }
                        copiedIcon={
                          selectedCardEntry.card.kind === "ps2"
                            ? null
                            : copiedIcon
                        }
                      />
                      {selectedCardEntry.card.kind === "ps2" ? (
                        <Ps2SaveList
                          key={selectedCardEntry.id}
                          card={selectedCardEntry.card}
                          selectedSave={selectedPs2Save}
                          onSelectSave={handlePs2SaveClick}
                        />
                      ) : (
                        <SlotList
                          card={selectedCardEntry.card}
                          selectedSlot={selectedSlot}
                          hasTempBuffer={copiedSaveBytes !== null}
                          onSlotClick={handleSlotClick}
                          onSlotAction={handleSlotAction}
                        />
                      )}
                    </div>
                    {sidebarOpen && selectedCardEntry.card.kind === "ps1" && (
                      <GameDetailsSidebar
                        gameId={selectedGameId ?? ""}
                        region={selectedRegion ?? ""}
                        onClose={() => setSidebarOpen(false)}
                      />
                    )}
                    {selectedCardEntry.card.kind === "ps2" &&
                      selectedPs2Save !== null && (
                        <Ps2SaveInfoSidebar
                          key={`${selectedCardEntry.id}:${selectedPs2Save}`}
                          card={selectedCardEntry.card}
                          saveName={selectedPs2Save}
                          onClose={() => setSelectedPs2Save(null)}
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
        </div>
      </DragDropWrapper>
      <MemcarduinoConnectDialog
        isOpen={isConnectDialogOpen}
        onOpenChange={setIsConnectDialogOpen}
        onConnect={handleMemcarduinoConnect}
      />
      <PS1CardLinkConnectDialog
        isOpen={isPS1CardLinkDialogOpen}
        onOpenChange={setIsPS1CardLinkDialogOpen}
        onConnect={handlePS1CardLinkConnect}
      />
      <UniromConnectDialog
        isOpen={isUniromDialogOpen}
        onOpenChange={setIsUniromDialogOpen}
        onConnect={handleUniromConnect}
      />
      <PocketStationDialog
        isOpen={isPocketStationDialogOpen}
        onOpenChange={setIsPocketStationDialogOpen}
        onReadSerial={readPocketStationSerial}
        onDumpBios={dumpPocketStationBIOS}
        onSetTime={setPocketStationTime}
      />
      <WriteCardDialog
        isOpen={isWriteDialogOpen}
        onOpenChange={setIsWriteDialogOpen}
        cardName={selectedCardEntry?.name ?? "memory card"}
        checksum={selectedCardEntry?.card.getRawChecksum() ?? ""}
        deviceName={connectedDevice ?? "device"}
        verify={verifyAfterWrite}
        onVerifyChange={setVerifyAfterWrite}
        onConfirm={() => void handleWriteConfirm()}
      />
      <FormatCardDialog
        isOpen={isFormatDialogOpen}
        onOpenChange={setIsFormatDialogOpen}
        deviceName={connectedDevice ?? "device"}
        onFormat={(quick) => void handleFormatConfirm(quick)}
      />
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
      <input
        ref={singleSaveFileInputRef}
        type="file"
        accept=".mcs,.ps1,.psv,.mcb,.mcx,.pda,.psx,.psm,.bin,.raw"
        className="sr-only"
        onChange={(e) => void handleImportSingleSaveChange(e)}
      />
      <input
        ref={ps2ImportFileInputRef}
        type="file"
        accept=".sdt,.dat"
        className="sr-only"
        onChange={(e) => void handlePs2ImportFileChange(e)}
      />
      {selectedPs2Card ? (
        <SaveMemoryCardDialog
          key={`ps2-${selectedCard ?? "no-card"}`}
          isOpen={isSaveDialogOpen}
          onOpenChange={setIsSaveDialogOpen}
          defaultFileName={selectedCardEntry?.name ?? "memory_card"}
          formats={PS2_CARD_FORMATS}
          defaultFormat={Ps2CardFormats.Raw}
          onSave={handlePs2SaveConfirm}
        />
      ) : (
        <SaveMemoryCardDialog
          key={selectedCard ?? "no-card"}
          isOpen={isSaveDialogOpen}
          onOpenChange={setIsSaveDialogOpen}
          defaultFileName={selectedCardEntry?.name ?? "memory_card"}
          formats={PS1_CARD_FORMATS}
          defaultFormat={selectedPs1Card?.getCardType() ?? CardTypes.Raw}
          onSave={handleSaveConfirm}
        />
      )}
      {selectedPs2Card ? (
        <SaveSingleSaveDialog
          key={`ps2-${selectedCard ?? "no-card"}-${selectedPs2Save ?? "no-save"}`}
          isOpen={isSingleSaveDialogOpen}
          onOpenChange={setIsSingleSaveDialogOpen}
          defaultFileName={selectedPs2Save ?? "save"}
          formats={PS2_SINGLE_SAVE_FORMATS}
          defaultFormat={Ps2SingleSaveTypes.Sdt}
          onSave={handlePs2ExportConfirm}
        />
      ) : (
        <SaveSingleSaveDialog
          key={`${selectedCard ?? "no-card"}-${selectedSlot ?? "no-slot"}`}
          isOpen={isSingleSaveDialogOpen}
          onOpenChange={setIsSingleSaveDialogOpen}
          defaultFileName={`${selectedSaveInfo?.regionRaw ?? ""}${selectedSaveInfo?.productCode ?? ""}${selectedSaveInfo?.identifier ?? ""}`}
          formats={PS1_SINGLE_SAVE_FORMATS}
          defaultFormat={SingleSaveTypes.Mcs}
          onSave={handleExportSingleSaveConfirm}
        />
      )}
      <Ps2NewCardDialog
        isOpen={isPs2NewCardDialogOpen}
        onOpenChange={setIsPs2NewCardDialogOpen}
        onConfirm={handlePs2NewCard}
      />
      <Ps2ImportSaveDialog
        key={ps2ImportFile?.name ?? "no-file"}
        isOpen={isPs2ImportDialogOpen}
        onOpenChange={setIsPs2ImportDialogOpen}
        defaultName={ps2ImportFile?.name.replace(/\.[^.]+$/, "") ?? ""}
        takenNames={selectedPs2Card?.getSaves().map((s) => s.name) ?? []}
        onImport={(name, title) => handlePs2ImportConfirm(name, title)}
      />
      <EditHeaderDialog
        key={`header-${dialogSlot ?? "none"}`}
        isOpen={isHeaderDialogOpen}
        onOpenChange={setIsHeaderDialogOpen}
        initialProductCode={dialogSaveInfo?.productCode ?? ""}
        initialIdentifier={dialogSaveInfo?.identifier ?? ""}
        initialRegion={dialogSaveInfo?.region ?? ""}
        onSave={handleEditHeaderConfirm}
      />
      <EditCommentDialog
        key={`comment-${dialogSlot ?? "none"}`}
        isOpen={isCommentDialogOpen}
        onOpenChange={setIsCommentDialogOpen}
        initialComment={dialogSaveInfo?.comment ?? ""}
        onSave={handleEditCommentConfirm}
      />
      {dialogSaveInfo && dialogCard && dialogSlot !== null && (
        <SaveInfoDialog
          isOpen={isInfoDialogOpen}
          onOpenChange={setIsInfoDialogOpen}
          save={dialogSaveInfo}
          linkedSlots={dialogLinkedSlots}
          iconData={dialogCard.getIconData(dialogSlot)}
          iconPalette={dialogCard.getIconPalette(dialogSlot)}
          isSoftware={
            dialogCard.getSaveDataType(dialogSlot) === DataTypes.Software
          }
          mcIcon={dialogCard.getPocketStationIcon(dialogSlot, IconTypes.MCIcon)}
          apIcon={dialogCard.getPocketStationIcon(dialogSlot, IconTypes.APIcon)}
        />
      )}
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
      <AlertDialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase slot data</AlertDialogTitle>
            <AlertDialogDescription>
              {eraseMessage} You can undo this action from the toolbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveSaveConfirm}>
              Erase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
