import { useEffect, useRef, useState } from "react";

import { useDeviceManager } from "@/hooks/use-device-manager";
import type {
  MemoryCard,
  MemoryCardDraft,
} from "@/hooks/use-memory-card-workspace";
import { usePersistentState } from "@/hooks/use-persistent-state";
import PS1MemoryCard from "@/lib/ps1-memory-card";
import type { FormatChoice, SlotCardKind } from "@/lib/ps1/hardware/core";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { Ps2CardError, type Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import {
  fromStoredMgKeyset,
  PS2_MG_KEYSET_STORAGE_KEY,
  shouldClearKeysetOn,
  type StoredMgKeyset,
  toStoredMgKeyset,
} from "@/lib/ps2/ps2-mgkeyset";

export interface MemoryCardDeviceDialogsProps {
  isConnectDialogOpen: boolean;
  setIsConnectDialogOpen: (open: boolean) => void;
  handleMemcarduinoConnect: (
    deviceType: string,
    connectionMode: string,
  ) => Promise<void>;
  isPS1CardLinkDialogOpen: boolean;
  setIsPS1CardLinkDialogOpen: (open: boolean) => void;
  handlePS1CardLinkConnect: (cardSlot: number) => Promise<void>;
  isUniromDialogOpen: boolean;
  setIsUniromDialogOpen: (open: boolean) => void;
  handleUniromConnect: (cardSlot: number) => Promise<void>;
  isPocketStationDialogOpen: boolean;
  setIsPocketStationDialogOpen: (open: boolean) => void;
  readPocketStationSerial: () => Promise<number>;
  dumpPocketStationBIOS: () => Promise<{ bios: Uint8Array; serial: number }>;
  setPocketStationTime: () => Promise<void>;
  isWriteDialogOpen: boolean;
  setIsWriteDialogOpen: (open: boolean) => void;
  handleWriteConfirm: () => void;
  verifyAfterWrite: boolean;
  setVerifyAfterWrite: (value: boolean) => void;
  isFormatDialogOpen: boolean;
  setIsFormatDialogOpen: (open: boolean) => void;
  formatCardKind: "ps1" | "ps2";
  handleFormatConfirm: (choice: FormatChoice) => void;
  isMgKeyDialogOpen: boolean;
  handleMgKeyClose: (open: boolean) => void;
  storedSection: string | null;
  handleMgKeySelect: (section: string, keyset: Ps2MgKeyset) => void;
  detectedCard: SlotCardKind | null;
  writeCardName: string;
  writeChecksum: string;
  writeKind: "ps1" | "ps2";
  deviceName: string;
}

type DeviceCard = PS1MemoryCard | PS2MemoryCard;

type MgPendingOp =
  | { kind: "read" }
  | { kind: "write"; card: DeviceCard }
  | { kind: "format"; choice: FormatChoice };

function useMgAuthFlow() {
  const [storedMgKeyset, setStoredMgKeyset] =
    usePersistentState<StoredMgKeyset | null>(PS2_MG_KEYSET_STORAGE_KEY, null);
  const [isMgKeyDialogOpen, setIsMgKeyDialogOpen] = useState(false);
  const pendingMgOpRef = useRef<MgPendingOp | null>(null);

  const mgKeyset = fromStoredMgKeyset(storedMgKeyset);
  const storedSection =
    mgKeyset !== null && storedMgKeyset !== null
      ? storedMgKeyset.section
      : null;

  useEffect(() => {
    if (
      storedMgKeyset !== null &&
      fromStoredMgKeyset(storedMgKeyset) === null
    ) {
      setStoredMgKeyset(null);
    }
  }, [storedMgKeyset, setStoredMgKeyset]);

  const reportAuthError = (err: unknown, op: MgPendingOp): boolean => {
    if (
      err instanceof Ps2CardError &&
      (err.needsKey || err.step !== undefined)
    ) {
      if (
        shouldClearKeysetOn(err) ||
        (storedMgKeyset !== null && mgKeyset === null)
      ) {
        setStoredMgKeyset(null);
      }
      pendingMgOpRef.current = op;
      setIsMgKeyDialogOpen(true);
      return true;
    }
    return false;
  };

  const persistKeyset = (section: string, keyset: Ps2MgKeyset) => {
    setStoredMgKeyset(toStoredMgKeyset(section, keyset));
  };

  const takePendingOp = (): MgPendingOp | null => {
    const op = pendingMgOpRef.current;
    pendingMgOpRef.current = null;
    return op;
  };

  const handleDialogOpenChange = (open: boolean): boolean => {
    if (!open) {
      const hadPending = pendingMgOpRef.current !== null;
      pendingMgOpRef.current = null;
      setIsMgKeyDialogOpen(false);
      return hadPending;
    }
    setIsMgKeyDialogOpen(true);
    return false;
  };

  return {
    mgKeyset,
    storedSection,
    isMgKeyDialogOpen,
    reportAuthError,
    persistKeyset,
    takePendingOp,
    handleDialogOpenChange,
  };
}

interface UseMemoryCardDeviceOpsArgs {
  addCard: (entry: MemoryCardDraft) => number;
  selectCard: (id: number | null) => void;
  selectedEntry: MemoryCard | undefined;
  fixCorrupted: boolean;
  setError: (message: string | null) => void;
}

export function useMemoryCardDeviceOps({
  addCard,
  selectCard,
  selectedEntry,
  fixCorrupted,
  setError,
}: UseMemoryCardDeviceOpsArgs) {
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isPS1CardLinkDialogOpen, setIsPS1CardLinkDialogOpen] = useState(false);
  const [isUniromDialogOpen, setIsUniromDialogOpen] = useState(false);
  const [isPocketStationDialogOpen, setIsPocketStationDialogOpen] =
    useState(false);
  const [isWriteDialogOpen, setIsWriteDialogOpen] = useState(false);
  const [isFormatDialogOpen, setIsFormatDialogOpen] = useState(false);
  const [formatCardKind, setFormatCardKind] = useState<"ps1" | "ps2">("ps1");
  const [verifyAfterWrite, setVerifyAfterWrite] = usePersistentState(
    "psx-webtools.verifyAfterWrite",
    true,
  );

  const mg = useMgAuthFlow();
  const {
    isConnected,
    connectionError,
    connectedDevice,
    canPocketStation,
    firmwareVersion,
    detectedCard,
    formatSlotKind,
    connectDexDrive,
    connectMemcarduino,
    connectPS1CardLink,
    connectPS3MCA,
    connectUnirom,
    disconnectDevice,
    readCard,
    writeCard: writeToDevice,
    formatCard,
    readPocketStationSerial,
    dumpPocketStationBIOS,
    setPocketStationTime,
  } = useDeviceManager();

  // Report session failures on the error banner instead of throwing
  // through the click handler (connect, disconnect, and dialog start).
  const trySession = async (op: () => Promise<void>): Promise<boolean> => {
    let sessionError: unknown = null;
    try {
      await op();
    } catch (err) {
      sessionError = err;
    }
    if (sessionError !== null) {
      setError((sessionError as Error).message);
      return false;
    }
    return true;
  };

  const catchMg = async (
    op: () => Promise<void>,
    pending: Parameters<typeof mg.reportAuthError>[1],
  ) => {
    setError(null);
    let caught: unknown = null;
    try {
      await op();
    } catch (err) {
      caught = err;
    }
    if (caught === null) return;
    if (!mg.reportAuthError(caught, pending)) {
      setError((caught as Error).message);
    }
  };

  const performRead = async (keyset?: Ps2MgKeyset) => {
    const card = await readCard(
      fixCorrupted,
      keyset ?? mg.mgKeyset ?? undefined,
    );
    const deviceLabel = connectedDevice ?? "Device";
    const id = addCard({
      name: `${deviceLabel} Read`,
      type: "device",
      source: firmwareVersion
        ? `${deviceLabel} v${firmwareVersion}`
        : deviceLabel,
      card,
    });
    selectCard(id);
  };

  const performWrite = async (card: DeviceCard, keyset?: Ps2MgKeyset) => {
    await writeToDevice(
      card,
      verifyAfterWrite,
      keyset ?? mg.mgKeyset ?? undefined,
    );
  };

  const performFormat = async (choice: FormatChoice, keyset?: Ps2MgKeyset) => {
    await formatCard(choice, keyset ?? mg.mgKeyset ?? undefined);
  };

  const handleMemcarduinoConnect = async (
    deviceType: string,
    connectionMode: string,
  ) => {
    const ok = await trySession(() =>
      connectMemcarduino(deviceType, connectionMode),
    );
    if (ok) setIsConnectDialogOpen(false);
  };

  const handlePS1CardLinkConnect = async (cardSlot: number) => {
    const ok = await trySession(() => connectPS1CardLink(cardSlot));
    if (ok) setIsPS1CardLinkDialogOpen(false);
  };

  const handleUniromConnect = async (cardSlot: number) => {
    const ok = await trySession(() => connectUnirom(cardSlot));
    if (ok) setIsUniromDialogOpen(false);
  };

  const handleWriteConfirm = () => {
    const card = selectedEntry?.card;
    if (!card) return;
    setIsWriteDialogOpen(false);
    void catchMg(() => performWrite(card), {
      kind: "write",
      card,
    });
  };

  const handleMgKeySelect = (section: string, keyset: Ps2MgKeyset) => {
    mg.persistKeyset(section, keyset);
    setError(null);
    const pending = mg.takePendingOp();
    mg.handleDialogOpenChange(false);
    if (!pending) return;
    void catchMg(async () => {
      if (pending.kind === "read") await performRead(keyset);
      else if (pending.kind === "write")
        await performWrite(pending.card, keyset);
      else await performFormat(pending.choice, keyset);
    }, pending);
  };

  const handleMgKeyClose = (open: boolean) => {
    if (mg.handleDialogOpenChange(open)) {
      setError("Canceled. Load a key file and retry the read/write.");
    }
  };

  const handleFormatClick = () => {
    void (async () => {
      setError(null);
      const kind = await formatSlotKind();
      if (!kind) {
        setError("No memory card detected. Insert a card and try again.");
        return;
      }
      setFormatCardKind(kind === "pocketstation" ? "ps1" : kind);
      setIsFormatDialogOpen(true);
    })();
  };

  const handleFormatConfirm = (choice: FormatChoice) => {
    setIsFormatDialogOpen(false);
    void catchMg(() => performFormat(choice), { kind: "format", choice });
  };

  return {
    isConnected,
    connectionError,
    connectedDevice,
    canPocketStation,
    onConnectDexDrive: () => {
      void trySession(connectDexDrive);
    },
    onConnectMemcarduino: () => setIsConnectDialogOpen(true),
    onConnectPS1CardLink: () => setIsPS1CardLinkDialogOpen(true),
    onConnectPS3MCA: () => {
      void trySession(connectPS3MCA);
    },
    onConnectUnirom: () => setIsUniromDialogOpen(true),
    onPocketStation: () => setIsPocketStationDialogOpen(true),
    onDisconnect: () => {
      void trySession(disconnectDevice);
    },
    onRead: () => {
      void catchMg(() => performRead(), { kind: "read" });
    },
    onWrite: () => {
      if (selectedEntry) setIsWriteDialogOpen(true);
    },
    onFormat: handleFormatClick,
    dialogs: {
      isConnectDialogOpen,
      setIsConnectDialogOpen,
      handleMemcarduinoConnect,
      isPS1CardLinkDialogOpen,
      setIsPS1CardLinkDialogOpen,
      handlePS1CardLinkConnect,
      isUniromDialogOpen,
      setIsUniromDialogOpen,
      handleUniromConnect,
      isPocketStationDialogOpen,
      setIsPocketStationDialogOpen,
      readPocketStationSerial,
      dumpPocketStationBIOS,
      setPocketStationTime,
      isWriteDialogOpen,
      setIsWriteDialogOpen,
      handleWriteConfirm,
      verifyAfterWrite,
      setVerifyAfterWrite,
      isFormatDialogOpen,
      setIsFormatDialogOpen,
      formatCardKind,
      handleFormatConfirm,
      isMgKeyDialogOpen: mg.isMgKeyDialogOpen,
      handleMgKeyClose,
      storedSection: mg.storedSection,
      handleMgKeySelect,
      detectedCard,
      writeCardName: selectedEntry?.name ?? "memory card",
      writeChecksum: selectedEntry?.view.checksum ?? "",
      writeKind: selectedEntry?.view.kind ?? "ps1",
      deviceName: connectedDevice ?? "device",
    } satisfies MemoryCardDeviceDialogsProps,
  };
}
