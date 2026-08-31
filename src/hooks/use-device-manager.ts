import { useState } from "react";

import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import { useHardwareConnection } from "@/hooks/use-hardware";
import type { CardEvent, SlotCardKind } from "@/lib/ps1/hardware/core";
import { DexDrive } from "@/lib/ps1/hardware/dexdrive";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import { PS1CardLink } from "@/lib/ps1/hardware/ps1cardlink";
import { PS3MemCardAdaptor } from "@/lib/ps1/hardware/ps3memcardadaptor";
import { Unirom } from "@/lib/ps1/hardware/unirom";
import PS1MemoryCard from "@/lib/ps1-memory-card";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";

/**
 * Owns the hardware connection lifecycle (connect/disconnect/read/write) and the
 * loading dialog that reports progress. Card-state side effects (adding a read
 * card, picking the write target) stay in the caller, so this hook stays
 * decoupled from the card list.
 */
export function useDeviceManager(onCardEvent?: (ev: CardEvent) => void) {
  const { showDialog, updateDialog, hideDialog } = useLoadingDialog();
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
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
  } = useHardwareConnection(() => setConnectedDevice(null), onCardEvent);

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

  const connectDexDrive = async () => {
    showDialog("Connecting to DexDrive", "Initializing connection...");
    try {
      await connect(
        new DexDrive(),
        { deviceType: "dexdrive", baudRate: 38400, signalsConfig: [] },
        updateDialog,
      );
      setConnectedDevice("DexDrive");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      hideDialog();
      throw err;
    }
  };

  const connectMemcarduino = async (
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
        updateDialog,
      );
      setConnectedDevice("MemCARDuino");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      hideDialog();
      throw err;
    }
  };

  const connectPS1CardLink = async (cardSlot: number) => {
    showDialog("Connecting to PS1CardLink", "Initializing connection...");
    try {
      const device = new PS1CardLink();
      device.cardSlot = cardSlot;
      await connect(
        device,
        { deviceType: "ps1cardlink", baudRate: 115200, signalsConfig: [] },
        updateDialog,
      );
      setConnectedDevice("PS1CardLink");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      hideDialog();
      throw err;
    }
  };

  const connectPS3MCA = async () => {
    showDialog("Connecting to PS3 MC Adaptor", "Initializing connection...");
    try {
      await connect(
        new PS3MemCardAdaptor(),
        { deviceType: "ps3mca", baudRate: 0, signalsConfig: [] },
        updateDialog,
      );
      setConnectedDevice("PS3 MC Adaptor");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      hideDialog();
      throw err;
    }
  };

  const connectUnirom = async (cardSlot: number) => {
    showDialog("Connecting to Unirom", "Initializing connection...");
    try {
      const device = new Unirom();
      device.cardSlot = cardSlot;
      await connect(
        device,
        { deviceType: "unirom", baudRate: 115200, signalsConfig: [] },
        updateDialog,
      );
      setConnectedDevice("Unirom");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      hideDialog();
      throw err;
    }
  };

  const disconnectDevice = async () => {
    showDialog("Disconnecting from device", "Initializing disconnection...");
    try {
      await disconnect(updateDialog);
      setConnectedDevice(null);
      updateDialog("Disconnected successfully!");
      setTimeout(hideDialog, 1000);
    } catch (err) {
      hideDialog();
      throw err;
    }
  };

  const readCard = async (fixData: boolean, keyset?: Ps2MgKeyset) => {
    showDialog("Reading Memory Card", "Reading memory card data...");
    let card: PS1MemoryCard | PS2MemoryCard | null;

    try {
      card = await readMemoryCard(
        (progress) => {
          updateDialog(
            `Reading memory card... ${Math.round(progress * 100)}%`,
            undefined,
            progress,
          );
        },
        fixData,
        keyset,
      );
    } catch (err) {
      hideDialog();
      throw err;
    }

    if (!card) {
      hideDialog();
      throw new Error("Failed to read memory card");
    }

    updateDialog("Memory card read successfully!");
    setTimeout(hideDialog, 1000);
    return card;
  };

  const writeCard = async (
    card: PS1MemoryCard | PS2MemoryCard,
    verify = false,
    keyset?: Ps2MgKeyset,
  ) => {
    showDialog("Writing to Memory Card", "Preparing to write data...");
    let success: boolean;

    try {
      success = await writeMemoryCard(
        card,
        (progress) => {
          const verifying = verify && progress >= 0.5;
          const phaseProgress = verifying
            ? (progress - 0.5) * 2
            : verify
              ? progress * 2
              : progress;
          updateDialog(
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
    } catch (err) {
      hideDialog();
      throw err;
    }

    if (!success) {
      hideDialog();
      throw new Error("Failed to write memory card to device");
    }

    updateDialog(
      verify ? "Memory card write verified." : "Memory card write successful!",
    );
    setTimeout(hideDialog, 1000);
  };

  // Probe the slot's card kind for the format dialog and the detected-card
  // preview. Returns null when no device is connected or no card is present; the
  // caller reports that.
  const checkCard = async (): Promise<SlotCardKind | null> => {
    if (!device) return null;
    const result = await device.checkCard();
    if (!result.present) return null;
    return result.kind;
  };

  // Format the card in the slot (PS2 format2 from Get Specs, or PS1 quick/full
  // frames). Returns the blank PS2 card on a PS2 format so the caller can put
  // it in the card list; null on a PS1 format (which the list does not track).
  const formatCard = async (
    quick: boolean,
    keyset?: Ps2MgKeyset,
  ): Promise<PS2MemoryCard | null> => {
    showDialog("Formatting Memory Card", "Preparing to format...");
    let blank: PS1MemoryCard | PS2MemoryCard | null;
    try {
      blank = await formatMemoryCard(
        quick,
        (progress) =>
          updateDialog(
            `Formatting memory card... ${Math.round(progress * 100)}%`,
            undefined,
            progress,
          ),
        keyset,
      );
    } catch (err) {
      hideDialog();
      throw err;
    }
    if (!blank) {
      hideDialog();
      throw new Error("Failed to format memory card");
    }
    updateDialog("Memory card formatted!");
    setTimeout(hideDialog, 1000);
    return blank instanceof PS2MemoryCard ? blank : null;
  };

  const getPsDevice = (): MemCARDuino | PS3MemCardAdaptor | null =>
    device instanceof MemCARDuino || device instanceof PS3MemCardAdaptor
      ? device
      : null;

  const readPocketStationSerial = async (): Promise<number> => {
    const mcdino = getPsDevice();
    if (!mcdino)
      throw new Error(
        "PocketStation is only available on a MemCARDuino or PS3 MC Adaptor",
      );
    const { serial, errorMsg } = await mcdino.readPocketStationSerial();
    if (errorMsg) throw new Error(errorMsg);
    return serial;
  };

  const dumpPocketStationBIOS = async (): Promise<{
    bios: Uint8Array;
    serial: number;
  }> => {
    const mcdino = getPsDevice();
    if (!mcdino)
      throw new Error(
        "PocketStation is only available on a MemCARDuino or PS3 MC Adaptor",
      );
    const { serial, errorMsg } = await mcdino.readPocketStationSerial();
    if (errorMsg) throw new Error(errorMsg);
    const bios = new Uint8Array(0x4000);
    for (let part = 0; part < 128; part++) {
      const chunk = await mcdino.dumpPocketStationBIOS(part);
      if (chunk === null) throw new Error(`Failed to read BIOS chunk ${part}`);
      bios.set(chunk, part * 128);
    }
    return { bios, serial };
  };

  const setPocketStationTime = async (): Promise<void> => {
    const mcdino = getPsDevice();
    if (!mcdino)
      throw new Error(
        "PocketStation is only available on a MemCARDuino or PS3 MC Adaptor",
      );
    const { success, errorMsg } = await mcdino.setPocketStationTime();
    if (!success)
      throw new Error(errorMsg ?? "Failed to set PocketStation time");
  };

  return {
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
  };
}
