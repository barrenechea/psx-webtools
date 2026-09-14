import { useEffect, useRef, useState } from "react";

import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import {
  useHardwareConnection,
  type HardwareStartConfig,
} from "@/hooks/use-hardware";
import PS1MemoryCard from "@/lib/ps1-memory-card";
import {
  SupportedFeatures,
  type CardEvent,
  type FormatChoice,
  type HardwareInterface,
  type SlotCardKind,
} from "@/lib/ps1/hardware/core";
import { DexDrive } from "@/lib/ps1/hardware/dexdrive";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import { PS1CardLink } from "@/lib/ps1/hardware/ps1cardlink";
import { PS3MemCardAdaptor } from "@/lib/ps1/hardware/ps3memcardadaptor";
import { Unirom } from "@/lib/ps1/hardware/unirom";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";

function hasFeature(
  hardware: HardwareInterface | null,
  feature: SupportedFeatures,
): hardware is HardwareInterface {
  return hardware !== null && (hardware.features() & feature) !== 0;
}

function supportsPocketStation(
  hardware: HardwareInterface | null,
): hardware is HardwareInterface {
  return hasFeature(hardware, SupportedFeatures.PocketStation);
}

const POCKETSTATION_REQUIRED =
  "PocketStation service commands require a MemCARDuino or PS3 MC Adaptor";
const DISCONNECT_BEFORE_CONNECT =
  "Disconnect the current device before connecting another.";
const DEVICE_DISCONNECTED = "Device disconnected.";

/**
 * Owns the hardware connection lifecycle (connect/disconnect/read/write) and the
 * loading dialog that reports progress. Card-state side effects (adding a read
 * card, picking the write target) stay in the caller, so this hook stays
 * decoupled from the card list. Slot USB (read/write/format/PocketStation and
 * 0x83 Probe) shares one exclusive queue so a preview cannot land mid-command.
 * Read/write/format/PocketStation snapshot hardwareRef after that lock so they
 * do not use a stale React `device`. User disconnect snapshots the handle,
 * drops the session, then stop()s that object on the same queue. Unplug skips
 * stop() but still invalidates the preview so an in-flight Probe cannot refill
 * it. Connect waits on the same queue and refuses while a device is live. If
 * the device unplugs during start(), connect fail-closes and does not mark the
 * session live. SlotProbe hardware gets a preview Probe after connect.
 * Loading-dialog updates are scoped to the show that opened them.
 */
export function useDeviceManager() {
  const { showDialog, updateDialog, hideDialog } = useLoadingDialog();
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
  const [detectedCard, setDetectedCardState] = useState<SlotCardKind | null>(
    null,
  );
  const detectedCardRef = useRef<SlotCardKind | null>(null);
  const bulkDoneRef = useRef(Promise.resolve());
  const bulkDepthRef = useRef(0);
  const probeSlotRef = useRef<() => void>(() => {});
  const classifyGenRef = useRef(0);
  const pendingInsertRef = useRef(false);
  const loadingDialogGenRef = useRef(0);
  const liveRef = useRef(false);
  const connectionGenRef = useRef(0);
  const hardwareRef = useRef<HardwareInterface | null>(null);

  const setDetectedCard = (kind: SlotCardKind | null) => {
    detectedCardRef.current = kind;
    setDetectedCardState(kind);
  };

  const invalidateSlotPreview = () => {
    classifyGenRef.current += 1;
    setDetectedCard(null);
    pendingInsertRef.current = false;
  };

  const dropSession = () => {
    liveRef.current = false;
    hardwareRef.current = null;
    connectionGenRef.current += 1;
    invalidateSlotPreview();
  };

  const handleCardEvent = (ev: CardEvent) => {
    invalidateSlotPreview();
    if (ev === 0x02) return;
    probeSlotRef.current();
  };

  const {
    isConnected,
    device,
    error: connectionError,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
    formatMemoryCard,
    firmwareVersion,
  } = useHardwareConnection(() => {
    dropSession();
    setConnectedDevice(null);
  }, handleCardEvent);

  const flushPendingClassify = () => {
    if (pendingInsertRef.current) {
      pendingInsertRef.current = false;
      probeSlotRef.current();
    }
  };

  const probeNow = async (): Promise<SlotCardKind | null> => {
    const gen = classifyGenRef.current;
    if (!liveRef.current) return null;
    // This checkCard is the follow-up classify; extra 0x83s during it
    // still set pendingInsert and flush after the lock drops.
    pendingInsertRef.current = false;
    const hardware = hardwareRef.current;
    if (!hardware) return null;
    const result = await hardware.checkCard().catch(() => null);
    const kind = result?.present ? result.kind : null;
    if (!liveRef.current || classifyGenRef.current !== gen) return null;
    setDetectedCard(kind);
    return kind;
  };

  // Queue exclusive slot USB. Depth is incremented as soon as an op is queued
  // so a 0x83 Probe coalesces on pendingInsert instead of overlapping.
  const withSlotLock = <T>(op: () => Promise<T>): Promise<T> => {
    bulkDepthRef.current += 1;
    const previous = bulkDoneRef.current;
    const started = (async () => {
      await previous;
      let error: unknown = null;
      let value: T | undefined;
      try {
        value = await op();
      } catch (err) {
        error = err;
      }
      bulkDepthRef.current -= 1;
      if (bulkDepthRef.current === 0) {
        flushPendingClassify();
      }
      if (error !== null) throw error;
      return value as T;
    })();
    bulkDoneRef.current = started.then(
      () => undefined,
      () => undefined,
    );
    return started;
  };

  const probeSlot = () => {
    if (!liveRef.current) return;
    if (bulkDepthRef.current > 0) {
      pendingInsertRef.current = true;
      return;
    }
    void withSlotLock(async () => {
      await probeNow().catch(() => null);
    });
  };

  useEffect(() => {
    probeSlotRef.current = probeSlot;
  });

  // Preview kind if the 0x83 probe already classified the slot; otherwise
  // Probe under the slot lock so a Read/Write cannot start mid-checkCard.
  const formatSlotKind = async (): Promise<SlotCardKind | null> => {
    if (!liveRef.current) return null;
    if (detectedCardRef.current !== null) return detectedCardRef.current;
    return withSlotLock(async () => {
      if (!liveRef.current) return null;
      if (detectedCardRef.current !== null) return detectedCardRef.current;
      return probeNow();
    });
  };

  const withLoadingDialog = async <T>(
    title: string,
    status: string,
    work: (
      update: (
        status: string,
        additionalInfo?: string,
        progress?: number,
      ) => void,
    ) => Promise<T>,
    success?: string,
  ): Promise<T> => {
    loadingDialogGenRef.current += 1;
    const gen = loadingDialogGenRef.current;
    showDialog(title, status);
    const update = (
      nextStatus: string,
      additionalInfo?: string,
      progress?: number,
    ) => {
      if (gen === loadingDialogGenRef.current) {
        updateDialog(nextStatus, additionalInfo, progress);
      }
    };
    let error: unknown = null;
    let value: T | undefined;
    try {
      value = await work(update);
    } catch (err) {
      error = err;
    }
    if (error !== null) {
      if (gen === loadingDialogGenRef.current) hideDialog();
      throw error;
    }
    if (success !== undefined) update(success);
    setTimeout(() => {
      if (gen === loadingDialogGenRef.current) hideDialog();
    }, 1000);
    return value as T;
  };

  const connectNamed = (
    label: string,
    hardware: HardwareInterface,
    config: HardwareStartConfig,
  ): Promise<void> => {
    if (liveRef.current) {
      return Promise.reject(new Error(DISCONNECT_BEFORE_CONNECT));
    }
    return withLoadingDialog(
      `Connecting to ${label}`,
      "Initializing connection...",
      async (update) => {
        await withSlotLock(async () => {
          if (liveRef.current) {
            throw new Error(DISCONNECT_BEFORE_CONNECT);
          }
          invalidateSlotPreview();
          const gen = connectionGenRef.current;
          await connect(hardware, config, update);
          if (connectionGenRef.current !== gen) {
            throw new Error(DEVICE_DISCONNECTED);
          }
          liveRef.current = true;
          hardwareRef.current = hardware;
          setConnectedDevice(label);
          if (hasFeature(hardware, SupportedFeatures.SlotProbe)) {
            await probeNow().catch(() => null);
          }
        });
      },
    );
  };

  const connectDexDrive = () =>
    connectNamed("DexDrive", new DexDrive(), {
      deviceType: "dexdrive",
      baudRate: 38400,
      signalsConfig: [],
    });

  const connectMemcarduino = (deviceType: string, connectionMode: string) => {
    const baudRate = connectionMode === "fast" ? 115200 : 38400;
    return connectNamed("MemCARDuino", new MemCARDuino(), {
      deviceType,
      baudRate,
      signalsConfig:
        deviceType === "arduino_nano"
          ? [{ dataTerminalReady: true }, { dataTerminalReady: false }]
          : [],
    });
  };

  const connectPS1CardLink = (cardSlot: number) => {
    const hardware = new PS1CardLink();
    hardware.cardSlot = cardSlot;
    return connectNamed("PS1CardLink", hardware, {
      deviceType: "ps1cardlink",
      baudRate: 115200,
      signalsConfig: [],
    });
  };

  const connectPS3MCA = () =>
    connectNamed("PS3 MC Adaptor", new PS3MemCardAdaptor(), {
      deviceType: "ps3mca",
      baudRate: 0,
      signalsConfig: [],
    });

  const connectUnirom = (cardSlot: number) => {
    const hardware = new Unirom();
    hardware.cardSlot = cardSlot;
    return connectNamed("Unirom", hardware, {
      deviceType: "unirom",
      baudRate: 115200,
      signalsConfig: [],
    });
  };

  const disconnectDevice = () =>
    withLoadingDialog(
      "Disconnecting from device",
      "Initializing disconnection...",
      async (update) => {
        const hardware = hardwareRef.current;
        dropSession();
        await withSlotLock(async () => {
          await disconnect(hardware, update);
          setConnectedDevice(null);
        });
      },
      "Disconnected successfully!",
    );

  const requireLiveHardware = (): HardwareInterface => {
    const hardware = liveRef.current ? hardwareRef.current : null;
    if (!hardware) {
      throw new Error(DEVICE_DISCONNECTED);
    }
    return hardware;
  };

  const readCard = (fixData: boolean, keyset?: Ps2MgKeyset) =>
    withSlotLock(async () => {
      requireLiveHardware();
      return withLoadingDialog(
        "Reading Memory Card",
        "Reading memory card data...",
        async (update) => {
          const hardware = requireLiveHardware();
          const card = await readMemoryCard(
            hardware,
            (progress) => {
              update(
                `Reading memory card... ${Math.round(progress * 100)}%`,
                undefined,
                progress,
              );
            },
            fixData,
            keyset,
          );
          if (!card) throw new Error("Failed to read memory card");
          return card;
        },
        "Memory card read successfully!",
      );
    });

  const writeCard = (
    card: PS1MemoryCard | PS2MemoryCard,
    verify = false,
    keyset?: Ps2MgKeyset,
  ) =>
    withSlotLock(async () => {
      requireLiveHardware();
      return withLoadingDialog(
        "Writing to Memory Card",
        "Preparing to write data...",
        async (update) => {
          const hardware = requireLiveHardware();
          const ok = await writeMemoryCard(
            hardware,
            card,
            (progress) => {
              const verifying = verify && progress >= 0.5;
              const phaseProgress = verifying
                ? (progress - 0.5) * 2
                : verify
                  ? progress * 2
                  : progress;
              update(
                verifying
                  ? `Verifying memory card... ${Math.round(phaseProgress * 100)}%`
                  : `Writing to memory card... ${Math.round(phaseProgress * 100)}%`,
                undefined,
                progress,
              );
            },
            verify,
            undefined,
            keyset,
          );
          if (!ok) throw new Error("Failed to write memory card to device");
        },
        verify
          ? "Memory card write verified."
          : "Memory card write successful!",
      );
    });

  const formatCard = (choice: FormatChoice, keyset?: Ps2MgKeyset) =>
    withSlotLock(async () => {
      requireLiveHardware();
      return withLoadingDialog(
        "Formatting Memory Card",
        "Preparing to format...",
        async (update) => {
          const hardware = requireLiveHardware();
          await formatMemoryCard(
            hardware,
            choice,
            (progress) =>
              update(
                `Formatting memory card... ${Math.round(progress * 100)}%`,
                undefined,
                progress,
              ),
            keyset,
          );
        },
        "Memory card formatted!",
      );
    });

  const requirePocketStation = (): HardwareInterface => {
    const hardware = requireLiveHardware();
    if (!supportsPocketStation(hardware)) {
      throw new Error(POCKETSTATION_REQUIRED);
    }
    return hardware;
  };

  const readPocketStationSerial = (): Promise<number> =>
    withSlotLock(async () => {
      const hardware = requirePocketStation();
      const { serial, errorMsg } = await hardware.readPocketStationSerial();
      if (errorMsg) throw new Error(errorMsg);
      return serial;
    });

  const dumpPocketStationBIOS = (): Promise<{
    bios: Uint8Array;
    serial: number;
  }> =>
    withSlotLock(async () => {
      const hardware = requirePocketStation();
      const { serial, errorMsg } = await hardware.readPocketStationSerial();
      if (errorMsg) throw new Error(errorMsg);
      const bios = new Uint8Array(0x4000);
      for (let part = 0; part < 128; part++) {
        const chunk = await hardware.dumpPocketStationBIOS(part);
        if (chunk === null)
          throw new Error(`Failed to read BIOS chunk ${part}`);
        bios.set(chunk, part * 128);
      }
      return { bios, serial };
    });

  const setPocketStationTime = (): Promise<void> =>
    withSlotLock(async () => {
      const hardware = requirePocketStation();
      const { success, errorMsg } = await hardware.setPocketStationTime();
      if (!success)
        throw new Error(errorMsg ?? "Failed to set PocketStation time");
    });

  return {
    isConnected,
    connectionError,
    connectedDevice,
    canPocketStation: supportsPocketStation(device),
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
    writeCard,
    formatCard,
    readPocketStationSerial,
    dumpPocketStationBIOS,
    setPocketStationTime,
  };
}
