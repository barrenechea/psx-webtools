import { useState } from "react";

import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import { useHardwareConnection } from "@/hooks/use-hardware";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import { PS1CardLink } from "@/lib/ps1/hardware/ps1cardlink";
import { Unirom } from "@/lib/ps1/hardware/unirom";
import PS1MemoryCard from "@/lib/ps1-memory-card";

/**
 * Owns the hardware connection lifecycle (connect/disconnect/read/write) and the
 * loading dialog that reports progress. Card-state side effects (adding a read
 * card, picking the write target) stay in the caller, so this hook stays
 * decoupled from the card list.
 */
export function useDeviceManager() {
  const { showDialog, updateDialog, hideDialog } = useLoadingDialog();
  const {
    isConnected,
    device,
    error: connectionError,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
    firmwareVersion,
  } = useHardwareConnection();
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);

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

  const readCard = async (fixData: boolean) => {
    showDialog("Reading Memory Card", "Reading memory card data...");
    let card: PS1MemoryCard | null;

    try {
      card = await readMemoryCard((progress) => {
        updateDialog(
          `Reading memory card... ${Math.round(progress * 100)}%`,
          undefined,
          progress,
        );
      }, fixData);
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

  const writeCard = async (card: PS1MemoryCard, verify = false) => {
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

  const readPocketStationSerial = async (): Promise<number> => {
    const mcdino = device instanceof MemCARDuino ? device : null;
    if (!mcdino)
      throw new Error("PocketStation is only available on a MemCARDuino");
    const { serial, errorMsg } = await mcdino.readPocketStationSerial();
    if (errorMsg) throw new Error(errorMsg);
    return serial;
  };

  const dumpPocketStationBIOS = async (): Promise<{
    bios: Uint8Array;
    serial: number;
  }> => {
    const mcdino = device instanceof MemCARDuino ? device : null;
    if (!mcdino)
      throw new Error("PocketStation is only available on a MemCARDuino");
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
    const mcdino = device instanceof MemCARDuino ? device : null;
    if (!mcdino)
      throw new Error("PocketStation is only available on a MemCARDuino");
    const { success, errorMsg } = await mcdino.setPocketStationTime();
    if (!success)
      throw new Error(errorMsg ?? "Failed to set PocketStation time");
  };

  return {
    isConnected,
    connectionError,
    connectedDevice,
    firmwareVersion,
    connectMemcarduino,
    connectPS1CardLink,
    connectUnirom,
    disconnectDevice,
    readCard,
    writeCard,
    readPocketStationSerial,
    dumpPocketStationBIOS,
    setPocketStationTime,
  };
}
