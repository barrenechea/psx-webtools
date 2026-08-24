import { useState } from "react";

import { crc32, formatCrc32 } from "@/lib/crc32";
import type { HardwareInterface } from "@/lib/ps1/hardware/core";
import PS1MemoryCard from "@/lib/ps1-memory-card";

export interface HardwareStartConfig {
  deviceType: string;
  baudRate: number;
  signalsConfig: SerialOutputSignals[];
}

// Manages a single hardware connection (MemCARDuino, Unirom, ...). The
// concrete device is created by the caller and passed in, so this hook stays
// device-agnostic and the connect dialogs can each own their own hardware.
export function useHardwareConnection() {
  const [device, setDevice] = useState<HardwareInterface | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);

  const connect = async (
    hardware: HardwareInterface,
    startConfig: HardwareStartConfig,
    onStatusUpdate: (status: string) => void,
  ) => {
    let result: string | null;

    try {
      onStatusUpdate(
        `Attempting connection at ${startConfig.baudRate} baud...`,
      );
      result = await hardware.start(
        startConfig.deviceType,
        startConfig.baudRate,
        startConfig.signalsConfig,
        onStatusUpdate,
      );
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }

    if (result !== null) {
      setError(result);
      throw new Error(result);
    }

    setDevice(hardware);
    setIsConnected(true);
    setError(null);
    setFirmwareVersion(hardware.firmware());
    onStatusUpdate("Connected successfully.");
  };

  const disconnect = async (onStatusUpdate: (status: string) => void) => {
    if (device) {
      try {
        onStatusUpdate("Closing connection...");
        await device.stop();
        onStatusUpdate("Disconnected successfully.");
        setDevice(null);
        setIsConnected(false);
        setFirmwareVersion(null);
      } catch (err) {
        setError((err as Error).message);
        onStatusUpdate(`Error disconnecting: ${(err as Error).message}`);
      }
    }
  };

  const readMemoryCard = async (
    onProgress?: (progress: number) => void,
    fixData = false,
  ): Promise<PS1MemoryCard | null> => {
    if (!device) {
      setError("Device not connected");
      return null;
    }

    try {
      const card = new PS1MemoryCard();

      // Delay to play nice with WebSerial - damn you Virtual DOM!
      await new Promise((resolve) => setTimeout(resolve, 100));

      for (let i = 0; i < 1024; i++) {
        const frame = await device.readMemoryCardFrame(i);
        if (frame === null) {
          setError(`Failed to read frame ${i}`);
          return null;
        }
        card.setRawData(i * 128, frame, fixData);

        if (onProgress) {
          onProgress((i + 1) / 1024);
        }
      }
      // A device read is of unknown origin, so treat the card as edited.
      card.markChanged();
      return card;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  };

  const writeMemoryCard = async (
    card: PS1MemoryCard,
    onProgress?: (progress: number) => void,
    verify = false,
    frameCount = 1024,
  ): Promise<boolean> => {
    if (!device) {
      setError("Device not connected");
      return false;
    }

    let failure: string | null = null;

    try {
      // Delay to play nice with WebSerial - damn you Virtual DOM!
      await new Promise((resolve) => setTimeout(resolve, 100));

      const frameSize = 128;
      const expectedChecksum = crc32(
        card.getRawData(0, frameCount * frameSize),
      );
      const writeShare = verify ? 0.5 : 1;

      for (let i = 0; i < frameCount; i++) {
        const frame = card.getRawData(i * frameSize, frameSize);
        const success = await device.writeMemoryCardFrame(i, frame);
        if (!success) {
          failure = `Failed to write frame ${i}`;
          break;
        }

        if (onProgress) {
          onProgress(((i + 1) / frameCount) * writeShare);
        }
      }

      if (!failure && verify) {
        const readback = new Uint8Array(frameCount * frameSize);
        for (let i = 0; i < frameCount; i++) {
          const frame = await device.readMemoryCardFrame(i);
          if (frame === null) {
            failure = `Failed to verify frame ${i}`;
            break;
          }
          readback.set(frame, i * frameSize);
          if (onProgress) {
            onProgress(writeShare + ((i + 1) / frameCount) * (1 - writeShare));
          }
        }

        if (!failure) {
          const actualChecksum = crc32(readback);
          if (actualChecksum !== expectedChecksum) {
            failure = `Verify failed: expected CRC-32 ${formatCrc32(expectedChecksum)}, got ${formatCrc32(actualChecksum)}`;
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
      return false;
    }

    if (failure) {
      setError(failure);
      throw new Error(failure);
    }

    return true;
  };

  return {
    isConnected,
    device,
    error,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
    firmwareVersion,
  };
}
