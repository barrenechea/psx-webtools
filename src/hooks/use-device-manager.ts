import { useState } from "react";

import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import { useHardwareConnection } from "@/hooks/use-hardware";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
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

  const writeCard = async (card: PS1MemoryCard) => {
    showDialog("Writing to Memory Card", "Preparing to write data...");
    let success: boolean;

    try {
      success = await writeMemoryCard(card, (progress) => {
        updateDialog(
          `Writing to memory card... ${Math.round(progress * 100)}%`,
          undefined,
          progress,
        );
      });
    } catch (err) {
      hideDialog();
      throw err;
    }

    if (!success) {
      hideDialog();
      throw new Error("Failed to write memory card to device");
    }

    updateDialog("Memory card write successful!");
    setTimeout(hideDialog, 1000);
  };

  return {
    isConnected,
    connectionError,
    connectedDevice,
    firmwareVersion,
    connectMemcarduino,
    connectUnirom,
    disconnectDevice,
    readCard,
    writeCard,
  };
}
