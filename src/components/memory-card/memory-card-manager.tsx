import { useEffect, useRef, useState } from "react";

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
import {
  gameDataTargetsFromPs2Saves,
  gameDataTargetsFromSaves,
  usePrefetchGameData,
} from "@/hooks/use-game-data";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { SaveFormatOption } from "@/hooks/use-save-file-form";
import type { CardEvent, SlotCardKind } from "@/lib/ps1/hardware/core";
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
import {
  PS2MemoryCard,
  type Ps2SaveSnapshot,
  type Ps2SingleSaveFormat,
} from "@/lib/ps2/ps2-card";
import { isPs2ConquestCard } from "@/lib/ps2/ps2-conquest";
import { Ps2CardError, type Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import {
  fromStoredMgKeyset,
  PS2_MG_KEYSET_STORAGE_KEY,
  shouldClearKeysetOn,
  type StoredMgKeyset,
  toStoredMgKeyset,
} from "@/lib/ps2/ps2-mgkeyset";
import {
  detectPs2Container,
  Ps2ContainerFormat,
  readPs2Container,
} from "@/lib/ps2/ps2-single-save";
import {
  PS2_RAW_EXTENSIONS,
  PS2_SINGLE_SAVE_EXTENSIONS,
  Ps2CardFormats,
  type Ps2SaveInfo,
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
import { MemoryCardToolbar } from "./memory-card-toolbar";
import { PocketStationDialog } from "./pocketstation-dialog";
import { Ps1SaveInfoDialog } from "./ps1-save-info-dialog";
import type { Ps1SlotAction } from "./ps1-slot";
import { Ps1SlotList } from "./ps1-slot-list";
import { derivePs1SlotRows } from "./ps1-slot-rows";
import { Ps2ImportSaveDialog } from "./ps2-import-save-dialog";
import { Ps2MgKeyDialog } from "./ps2-mg-key-dialog";
import { Ps2NewCardDialog } from "./ps2-new-card-dialog";
import { Ps2SaveInfoSidebar } from "./ps2-save-info-sidebar";
import { Ps2SaveList } from "./ps2-save-list";
import { SlotCardPreview } from "./slot-card-preview";
import { isPs2Card, type MemoryCard } from "./types";
import { WriteCardDialog } from "./write-card-dialog";

let lastCardId = 0;
const nextCardId = (): number => ++lastCardId;

// Runs an async operation with a shared "in flight" flag set for its duration.
// `onSettled` runs once the flag clears, whether the op succeeded or threw, so a
// remembered insert is classified even when a failed op releases the guard. Also
// serializes the slot-preview classify against Read/Write/Format so an `AA 40` Probe
// (which the firmware clocks as SIO) cannot land mid-MagicGate.
async function withBusy<T>(
  flag: { current: boolean },
  op: () => Promise<T>,
  onSettled?: () => void,
): Promise<T> {
  flag.current = true;
  try {
    return await op();
  } finally {
    flag.current = false;
    onSettled?.();
  }
}

// The read, write, or format awaiting a MagicGate keyset, so the key dialog can
// retry the exact operation once a section is picked (or on a repeated failure).
type MgPendingOp =
  | { kind: "read" }
  | { kind: "write"; card: PS1MemoryCard | PS2MemoryCard }
  | { kind: "format" };

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
    {
      value: Ps2SingleSaveTypes.MaxDrive,
      label: "MAX Drive (.psu)",
      extensions: [".psu"],
    },
    {
      value: Ps2SingleSaveTypes.Ems,
      label: "EMS (.psu)",
      extensions: [".psu"],
    },
    {
      value: Ps2SingleSaveTypes.SharkPort,
      label: "SharkPort (.sps)",
      extensions: [".sps"],
    },
    {
      value: Ps2SingleSaveTypes.XPort,
      label: "X-Port (.xps)",
      extensions: [".xps"],
    },
    {
      value: Ps2SingleSaveTypes.CodeBreaker,
      label: "CodeBreaker (.cbs)",
      extensions: [".cbs"],
    },
    {
      value: Ps2SingleSaveTypes.Psv,
      label: "PSV (.psv)",
      extensions: [".psv"],
    },
  ];

// Container format the card model accepts for each non-raw export type.
const PS2_EXPORT_CONTAINER_FORMAT: Partial<
  Record<Ps2SingleSaveTypes, Ps2SingleSaveFormat>
> = {
  [Ps2SingleSaveTypes.MaxDrive]: "max",
  [Ps2SingleSaveTypes.Ems]: "ems",
  [Ps2SingleSaveTypes.SharkPort]: "sharkport",
  [Ps2SingleSaveTypes.XPort]: "xport",
  [Ps2SingleSaveTypes.CodeBreaker]: "codebreaker",
  [Ps2SingleSaveTypes.Psv]: "psv",
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
  // PS2 temp buffer: the captured save (info for the header preview + a
  // snapshot for re-creation). Mutually exclusive with the PS1 buffer.
  const [copiedPs2, setCopiedPs2] = useState<{
    info: Ps2SaveInfo;
    snapshot: Ps2SaveSnapshot;
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
  // Card id awaiting a "replace existing save?" confirmation (PS2 paste).
  const [pendingPs2Replace, setPendingPs2Replace] = useState<number | null>(
    null,
  );
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
  const [storedMgKeyset, setStoredMgKeyset] =
    usePersistentState<StoredMgKeyset | null>(PS2_MG_KEYSET_STORAGE_KEY, null);
  const [isWriteDialogOpen, setIsWriteDialogOpen] = useState(false);
  const [isFormatDialogOpen, setIsFormatDialogOpen] = useState(false);
  // The slot kind probed when the format dialog opens, so it can offer the right
  // options (PS2 is a full NAND erase, no quick/full).
  const [formatCardKind, setFormatCardKind] = useState<"ps1" | "ps2">("ps1");
  // Card family detected in the device slot via the 0x83 interrupt edges;
  // drives the slot preview. Null when the slot is empty or not yet probed
  // (and always null on non-probing devices).
  const [detectedCard, setDetectedCard] = useState<SlotCardKind | null>(null);
  const [isMgKeyDialogOpen, setIsMgKeyDialogOpen] = useState(false);
  // The read/write awaiting a keyset, kept in a ref (not state) so the close
  // path always sees the latest value and a successful pick clears it before
  // the dialog closes.
  const pendingMgOpRef = useRef<MgPendingOp | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const singleSaveFileInputRef = useRef<HTMLInputElement>(null);
  const ps2ImportFileInputRef = useRef<HTMLInputElement>(null);
  // The slot preview is driven by two classify sources, neither a timer nor a dump: the
  // 0x83 interrupt edges while connected (insert 0x01/0x03 re-classifies the
  // slot, remove 0x02 clears it), plus one classify when the PS3 MCA connection
  // goes live — the firmware can queue a 01/03 during `start()` before
  // `isConnected` is true, and that edge would otherwise be dropped. The
  // classify is guarded so it never overlaps another classify or a bulk
  // read/write/format (an `AA 40` Probe injected mid-MagicGate would break
  // authentication). `useHardwareConnection` keeps the latest handler closure,
  // so no local ref shim is needed.
  const probingRef = useRef(false);
  const bulkOpInFlightRef = useRef(false);
  const probeSlotRef = useRef<() => void>(() => {});
  // Bumped on every remove (0x02). A classify captures the value at its start
  // and applies its result only if it still matches, so a 0x02 that lands
  // mid-classify cannot be undone by the stale result restoring the preview.
  const classifyGenRef = useRef(0);
  // Set when an insert (0x01/0x03) arrives while a classify or bulk op holds the
  // guard; the firmware won't resend that one-shot edge, so the classify is run
  // once when the guard clears. A remove clears it (the preview is already empty).
  const pendingInsertRef = useRef(false);

  // Hotplug edge handler, passed straight into useDeviceManager (the connection
  // hook stores it in a ref updated every render, so it always sees fresh state).
  const handleCardEvent = (ev: CardEvent) => {
    if (ev === 0x02) {
      // Remove: invalidate any in-flight classify (so its stale result can't
      // restore the preview), drop any remembered insert, and clear the preview.
      classifyGenRef.current += 1;
      pendingInsertRef.current = false;
      setDetectedCard(null);
      return;
    }
    // Insert (0x01 PS1 / 0x03 PS2). The byte is not the card family; re-classify
    // with 3x `AA 40` (+ `81 58` for a type-01 slot). `probeSlot` remembers the
    // insert if a classify or bulk op is holding the guard.
    probeSlotRef.current();
  };

  // Live keyset restored from the persisted entry. A missing or corrupt entry
  // restores to null, so it degrades to the normal "no keyset" prompt instead
  // of crashing the manager on load. A MagicGate rejection clears it; a
  // successful pick persists it.
  const mgKeyset = fromStoredMgKeyset(storedMgKeyset);
  // Only surface the stored section name when the entry actually restored.
  const storedSection =
    mgKeyset !== null && storedMgKeyset !== null
      ? storedMgKeyset.section
      : null;

  // A corrupt entry restores to null but would otherwise linger in localStorage
  // forever, since a clone dump never hits the auth path that clears it — so
  // clear it via the hook's setter, which empties state and storage together.
  // Converges: once storedMgKeyset is null the check stops.
  useEffect(() => {
    if (
      storedMgKeyset !== null &&
      fromStoredMgKeyset(storedMgKeyset) === null
    ) {
      setStoredMgKeyset(null);
    }
  }, [storedMgKeyset, setStoredMgKeyset]);

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
    checkCard,
    readPocketStationSerial,
    dumpPocketStationBIOS,
    setPocketStationTime,
  } = useDeviceManager(handleCardEvent);

  usePrefetchGameData([
    ...gameDataTargetsFromSaves(
      memoryCards.flatMap((entry) =>
        isPs2Card(entry.card) ? [] : entry.card.getSaves(),
      ),
    ),
    ...gameDataTargetsFromPs2Saves(
      memoryCards.flatMap((entry) =>
        isPs2Card(entry.card) ? entry.card.getSaves() : [],
      ),
    ),
  ]);

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
    // Clear the preview on purpose; the connect-time classify (and later 0x83
    // edges) fill it in. Also drop any insert remembered from a previous
    // connection.
    setDetectedCard(null);
    pendingInsertRef.current = false;
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
    setDetectedCard(null);
    try {
      await disconnectDevice();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Route a read/write failure: a MagicGate rejection (no keyset yet, or the
  // stored one was rejected) opens the key dialog to re-prompt; anything else
  // is a plain error message.
  const handleMgAuthError = (err: unknown, op: MgPendingOp): void => {
    if (
      err instanceof Ps2CardError &&
      (err.needsKey || err.step !== undefined)
    ) {
      // Clear the stored keyset when a named step rejected it, or when the
      // stored entry restored to null (corrupt) so it stops lingering.
      // needsKey with a valid entry is impossible (a keyset would have been
      // passed), so needsKey here means "no usable keyset" — prompt, don't
      // clear a healthy one.
      if (
        shouldClearKeysetOn(err) ||
        (storedMgKeyset !== null && mgKeyset === null)
      ) {
        setStoredMgKeyset(null);
      }
      pendingMgOpRef.current = op;
      setIsMgKeyDialogOpen(true);
      return;
    }
    setError((err as Error).message);
  };

  const performRead = async (keyset?: Ps2MgKeyset) => {
    await withBusy(
      bulkOpInFlightRef,
      async () => {
        const card = await readCard(
          fixCorrupted,
          keyset ?? mgKeyset ?? undefined,
        );
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
      },
      flushPendingClassify,
    );
  };

  const performWrite = async (
    card: PS1MemoryCard | PS2MemoryCard,
    keyset?: Ps2MgKeyset,
  ) => {
    await withBusy(
      bulkOpInFlightRef,
      () => writeCard(card, verifyAfterWrite, keyset ?? mgKeyset ?? undefined),
      flushPendingClassify,
    );
  };

  const handleReadFromDevice = async () => {
    setError(null);
    try {
      await performRead();
    } catch (err) {
      handleMgAuthError(err, { kind: "read" });
    }
  };

  // Runs a classify for a remembered insert (set while guarded) and clears the
  // flag. Called when a classify finishes and when a bulk op (withBusy) clears
  // its guard, so a one-shot insert edge is never dropped.
  const flushPendingClassify = () => {
    if (pendingInsertRef.current) {
      pendingInsertRef.current = false;
      probeSlotRef.current();
    }
  };

  // Re-classifies the slot for the preview (3x `AA 40`, plus `81 58` for a type-01
  // slot). Guarded so it never overlaps another classify or a bulk op; an insert
  // arriving while one of those guards holds is remembered and classified once
  // the guard clears (an insert with no connection is dropped — there is no card
  // to classify). The result applies only if the remove-generation is still
  // current, so a 0x02 that lands mid-classify cannot restore the preview from that
  // stale classify's result.
  const probeSlot = () => {
    if (!isConnected) return;
    if (probingRef.current || bulkOpInFlightRef.current) {
      pendingInsertRef.current = true;
      return;
    }
    probingRef.current = true;
    const gen = classifyGenRef.current;
    void (async () => {
      const kind = await checkCard().catch(() => null);
      if (classifyGenRef.current === gen) setDetectedCard(kind);
      // Release the guard on both the apply and the stale path so it cannot
      // stick, then classify a remembered insert now that the pipe is free.
      probingRef.current = false;
      flushPendingClassify();
    })();
  };

  // The handler and flush paths call through `probeSlotRef` (never a captured
  // closure), so the ref must point at the latest classify. Assigned in an
  // effect (not during render) so the compiler can reason about the ref.
  useEffect(() => {
    probeSlotRef.current = probeSlot;
  });

  // On connect, the firmware's idle watch can queue a one-shot 01/03 the moment
  // `transferIn` is armed — before `isConnected` is true, so that edge's classify
  // can be dropped (the ref still held the isConnected===false closure). Classify
  // once the connection is live; the ref holds the isConnected===true closure
  // because this effect runs after the assignment one. Gated to PS3 MC Adaptor so
  // other devices do not set the preview.
  useEffect(() => {
    if (isConnected && connectedDevice === "PS3 MC Adaptor") {
      probeSlotRef.current();
    }
  }, [isConnected, connectedDevice]);

  const handleWriteToDevice = () => {
    if (selectedCard === null) return;
    setIsWriteDialogOpen(true);
  };

  const handleWriteConfirm = async () => {
    if (selectedCard === null) return;
    const card = ps1Card(selectedCard) ?? ps2Card(selectedCard);
    if (!card) return;
    setIsWriteDialogOpen(false);
    setError(null);
    try {
      await performWrite(card);
    } catch (err) {
      handleMgAuthError(err, { kind: "write", card });
    }
  };

  // Persist the picked keyset and re-run the awaiting operation with it. The
  // fresh keyset is passed explicitly because the persisted-state update is
  // not yet visible in this render.
  const handleMgKeySelect = (section: string, keyset: Ps2MgKeyset) => {
    setStoredMgKeyset(toStoredMgKeyset(section, keyset));
    setIsMgKeyDialogOpen(false);
    // Capture-and-clear before the close/retry so a close routed through
    // handleMgKeyClose can never mistake a successful pick for a cancel.
    const op = pendingMgOpRef.current;
    pendingMgOpRef.current = null;
    if (!op) return;
    void (async () => {
      setError(null);
      try {
        if (op.kind === "read") await performRead(keyset);
        else if (op.kind === "write") await performWrite(op.card, keyset);
        else await performFormat(false, keyset);
      } catch (err) {
        handleMgAuthError(err, op);
      }
    })();
  };

  const handleMgKeyClose = (open: boolean) => {
    if (!open) {
      // Only report a cancel while an operation is still waiting on a keyset;
      // Use clears pendingMgOpRef first, so a successful pick never lands here
      // with a pending op.
      const hadPending = pendingMgOpRef.current !== null;
      pendingMgOpRef.current = null;
      if (hadPending) {
        setError("Canceled. Load a key file and retry the read/write.");
      }
    }
    setIsMgKeyDialogOpen(open);
  };

  const addFormattedPs2Card = (blank: PS2MemoryCard) => {
    const label = connectedDevice ?? "Device";
    const newCard: MemoryCard = {
      id: nextCardId(),
      name: `${label} Formatted`,
      type: "device",
      source: firmwareVersion ? `${label} v${firmwareVersion}` : label,
      card: blank,
    };
    setMemoryCards((prev) => [...prev, newCard]);
    setSelectedCard(newCard.id);
    setSelectedSlot(null);
    setSelectedPs2Save(null);
  };

  // Build and write the blank card, then put the formatted PS2 card in the list
  // so the sidebar is not a stale save list while the slot reads empty.
  const performFormat = async (quick: boolean, keyset?: Ps2MgKeyset) => {
    const blank = await withBusy(
      bulkOpInFlightRef,
      () => formatCard(quick, keyset ?? mgKeyset ?? undefined),
      flushPendingClassify,
    );
    if (blank) addFormattedPs2Card(blank);
  };

  // Probe the slot so the format dialog can hide quick/full for a PS2 card. A
  // PocketStation is PS1-compatible, so it offers the PS1 quick/full options.
  const handleFormatClick = async () => {
    setError(null);
    const kind = await checkCard();
    if (!kind) {
      setError("No memory card detected. Insert a card and try again.");
      return;
    }
    setFormatCardKind(kind === "pocketstation" ? "ps1" : kind);
    setIsFormatDialogOpen(true);
  };

  const handleFormatConfirm = async (quick: boolean) => {
    setIsFormatDialogOpen(false);
    setError(null);
    try {
      await performFormat(quick);
    } catch (err) {
      handleMgAuthError(err, { kind: "format" });
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
      // Probe by content: PS2 first (size % 528 + superblock magic), otherwise
      // PS1. A Conquest dump is neither, so refuse it clearly rather than fall
      // through to the PS1 loader.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ps2Card = PS2MemoryCard.tryFromBytes(bytes);
      let card: PS1MemoryCard | PS2MemoryCard | null = null;
      let openError: string | null = null;
      if (ps2Card) {
        card = ps2Card;
      } else if (isPs2ConquestCard(bytes)) {
        openError =
          "PS2 Conquest card (SoulCalibur II); it has no PFS filesystem, so it cannot be loaded, formatted, or written.";
      } else {
        try {
          const ps1 = new PS1MemoryCard();
          await ps1.loadFromFile(file, fixCorrupted);
          card = ps1;
        } catch (err) {
          openError = (err as Error).message;
        }
      }
      if (card) {
        openedCards.push({
          id: nextCardId(),
          name: file.name,
          type: "file",
          source: file.name,
          card,
        });
      } else {
        errors.push(
          `${file.name}: ${openError ?? "could not be read as a card."}`,
        );
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

  const handleSlotAction = (action: Ps1SlotAction, index: number) => {
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

  const handlePs2SaveConfirm = async (
    fileName: string,
    _saveType: Ps2CardFormats,
    ecc?: boolean,
  ) => {
    if (selectedCard === null) return;
    const card = ps2Card(selectedCard);
    if (card) {
      const success = await card.saveMemoryCard(fileName, ecc);
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

  const handlePs2ExportConfirm = async (
    fileName: string,
    saveType: Ps2SingleSaveTypes,
  ) => {
    if (selectedCard !== null && selectedPs2Save !== null) {
      const card = ps2Card(selectedCard);
      if (card) {
        const format = PS2_EXPORT_CONTAINER_FORMAT[saveType];
        const success = format
          ? await card.saveSingleSaveContainer(
              fileName,
              selectedPs2Save,
              format,
            )
          : await card.saveSingleSave(fileName, selectedPs2Save);
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
    const format = detectPs2Container(bytes, ps2ImportFile.name);
    let success: boolean;
    if (format !== Ps2ContainerFormat.Unknown) {
      try {
        const container = await readPs2Container(bytes, ps2ImportFile.name);
        success = card.importContainer(name, container.files, {
          title: title.length > 0 ? title : container.title || undefined,
        });
      } catch {
        success = false;
      }
    } else {
      success = card.importSingleSave(name, bytes, {
        title: title.length > 0 ? title : undefined,
      });
    }
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
      // PS2 copy/move stage the save in the temp buffer (no in-card duplicate);
      // move also deletes it from this card so it can be pasted into another.
      if (ps2 && selectedPs2Save !== null) {
        const name = selectedPs2Save;
        const info = ps2.getSaves().find((s) => s.name === name) ?? null;
        const snapshot = ps2.snapshotSave(name);
        if (info === null || snapshot === null) {
          setError("Failed to copy save");
          return;
        }
        if (action === "move") {
          const rowBefore = ps2.undoCount;
          if (!ps2.deleteSave(name)) {
            setError("Failed to move save");
            return;
          }
          appendHistoryLabel(selectedCard, rowBefore, "Save moved");
          setSelectedPs2Save(null);
          setMemoryCards([...memoryCards]);
        }
        setCopiedPs2({ info, snapshot });
        setCopiedSaveBytes(null);
        setCopiedSlots([]);
        setCopiedIcon(null);
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
    const ps2 = selectedCard !== null ? ps2Card(selectedCard) : undefined;
    if (ps2 && copiedPs2 !== null) {
      const cardId = selectedCard;
      if (cardId === null) return;
      const name = copiedPs2.snapshot.name;
      if (ps2.getSaves().some((s) => s.name === name)) {
        // A same-named save exists in the target card: confirm before
        // replacing it (never silently auto-duplicate).
        setPendingPs2Replace(cardId);
        return;
      }
      const rowBefore = ps2.undoCount;
      if (ps2.insertSave(copiedPs2.snapshot)) {
        appendHistoryLabel(cardId, rowBefore, "Save pasted");
        setSelectedPs2Save(name);
        setMemoryCards([...memoryCards]);
      } else {
        setError("Not enough free space to paste save");
      }
      return;
    }
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

  const handleConfirmPs2Replace = () => {
    const cardId = pendingPs2Replace;
    setPendingPs2Replace(null);
    if (cardId === null || copiedPs2 === null) return;
    const ps2 = ps2Card(cardId);
    if (ps2 === undefined) return;
    const name = copiedPs2.snapshot.name;
    const rowBefore = ps2.undoCount;
    if (ps2.replaceSave(copiedPs2.snapshot)) {
      // replaceSave is delete + insert (two undo steps); label both so the
      // history rows stay in sync with the card's undo count.
      appendHistoryLabel(cardId, rowBefore, `Removed ${name}`);
      appendHistoryLabel(cardId, rowBefore + 1, `Pasted ${name}`);
      setSelectedPs2Save(name);
    } else {
      setError("Not enough free space to replace save");
    }
    setMemoryCards([...memoryCards]);
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
  const ps2Saves =
    selectedCardEntry && selectedCardEntry.card.kind === "ps2"
      ? selectedCardEntry.card.getSaves()
      : [];
  const ps1Slots =
    selectedCardEntry && selectedCardEntry.card.kind === "ps1"
      ? derivePs1SlotRows(selectedCardEntry.card)
      : [];
  const cardHistory = selectedCardEntry
    ? (historyLabels[selectedCardEntry.id] ?? [selectedCardEntry.name])
    : [];
  const historyIndex = selectedCardEntry?.card.undoCount ?? 0;

  // The temp buffer holds one save of one kind; paste only applies when the
  // buffer's kind matches the selected card's kind (a PS1 save cannot go into
  // a PS2 card and vice versa).
  const selectedKind = selectedCardEntry?.card.kind ?? "ps1";
  const hasCopiedSave =
    selectedKind === "ps2" ? copiedPs2 !== null : copiedSaveBytes !== null;

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
              hasCopiedSave={hasCopiedSave}
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
                onFormat={() => void handleFormatClick()}
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
                        copiedPs2={
                          selectedCardEntry.card.kind === "ps2"
                            ? (copiedPs2?.info ?? null)
                            : null
                        }
                      />
                      {selectedCardEntry.card.kind === "ps2" ? (
                        <Ps2SaveList
                          key={selectedCardEntry.id}
                          saves={ps2Saves}
                          selectedSave={selectedPs2Save}
                          onSelectSave={handlePs2SaveClick}
                        />
                      ) : (
                        <Ps1SlotList
                          slots={ps1Slots}
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
      <SlotCardPreview kind={detectedCard} />
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
        cardKind={formatCardKind}
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
        accept=".sdt,.dat,.psu,.max,.sps,.xps,.cbs,.psv,.npo"
        className="sr-only"
        onChange={(e) => void handlePs2ImportFileChange(e)}
      />
      {selectedPs2Card ? (
        <SaveMemoryCardDialog
          key={`ps2-${selectedCard ?? "no-card"}-${isSaveDialogOpen ? "open" : "closed"}-${selectedPs2Card.getLoadedEcc() ? "ecc" : "noecc"}`}
          isOpen={isSaveDialogOpen}
          onOpenChange={setIsSaveDialogOpen}
          defaultFileName={selectedCardEntry?.name ?? "memory_card"}
          formats={PS2_CARD_FORMATS}
          defaultFormat={Ps2CardFormats.Raw}
          ecc={{ default: selectedPs2Card.getLoadedEcc() }}
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
      <Ps2MgKeyDialog
        isOpen={isMgKeyDialogOpen}
        onOpenChange={handleMgKeyClose}
        storedSection={storedSection}
        onSelect={handleMgKeySelect}
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
        <Ps1SaveInfoDialog
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
      <AlertDialog
        open={pendingPs2Replace !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPs2Replace(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace save?</AlertDialogTitle>
            <AlertDialogDescription>
              A save named “{copiedPs2?.snapshot.name}” already exists in this
              card. Replacing it deletes the existing save first; you can undo
              this from the toolbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPs2Replace}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
