import { useEffect, useRef, useState } from "react";

import { crc32, formatCrc32 } from "@/lib/crc32";
import type { HardwareInterface } from "@/lib/ps1/hardware/core";
import PS1MemoryCard from "@/lib/ps1-memory-card";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { Ps2CardError, type Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";

export interface HardwareStartConfig {
  deviceType: string;
  baudRate: number;
  signalsConfig: SerialOutputSignals[];
}

// Manages a single hardware connection (MemCARDuino, Unirom, ...). The
// concrete device is created by the caller and passed in, so this hook stays
// device-agnostic and the connect dialogs can each own their own hardware.
export function useHardwareConnection(onDeviceDisconnected?: () => void) {
  const [device, setDevice] = useState<HardwareInterface | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);

  const onDeviceDisconnectedRef = useRef(onDeviceDisconnected);
  useEffect(() => {
    onDeviceDisconnectedRef.current = onDeviceDisconnected;
  });

  // OS-reported unplug: drop the connection without calling stop() (the
  // device is already gone) and let the caller clear its own UI state.
  const handleDeviceDisconnected = () => {
    setDevice(null);
    setIsConnected(false);
    setFirmwareVersion(null);
    setError("Device disconnected.");
    onDeviceDisconnectedRef.current?.();
  };

  const connect = async (
    hardware: HardwareInterface,
    startConfig: HardwareStartConfig,
    onStatusUpdate: (status: string) => void,
  ) => {
    hardware.onDisconnected = handleDeviceDisconnected;

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
    keyset?: Ps2MgKeyset,
  ): Promise<PS1MemoryCard | PS2MemoryCard | null> => {
    if (!device) {
      setError("Device not connected");
      return null;
    }
    const cardCheck = await device.checkCard();
    if (!cardCheck.present) {
      throw new Error(cardCheck.message);
    }
    if (cardCheck.kind === "ps2") {
      const result = await device.readPS2CardImage((progress) => {
        onProgress?.(progress);
      }, keyset);
      if (result.status === "needs-auth") {
        throw new Error(
          "This PS2 card needs MagicGate authentication, but no key set is set.",
        );
      }
      if (result.status === "error") {
        throw new Ps2CardError(result.message, result.step);
      }
      const card = PS2MemoryCard.tryFromBytes(result.image);
      if (!card) {
        throw new Error("The PS2 card could not be read as a card image.");
      }
      card.markChanged();
      return card;
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
    card: PS1MemoryCard | PS2MemoryCard,
    onProgress?: (progress: number) => void,
    verify = false,
    frameCount = 1024,
    keyset?: Ps2MgKeyset,
  ): Promise<boolean> => {
    if (!device) {
      setError("Device not connected");
      return false;
    }
    const cardCheck = await device.checkCard();
    if (!cardCheck.present) {
      throw new Error(cardCheck.message);
    }
    if (cardCheck.kind === "ps2") {
      if (!(card instanceof PS2MemoryCard)) {
        throw new Error(
          "A PS2 card is in the slot, but the selected card is not a PS2 card image.",
        );
      }
      const raw = card.getRawData();
      const result = await device.writePS2CardImage(
        raw,
        (progress) => {
          onProgress?.(progress);
        },
        verify,
        keyset,
      );
      if (result.status === "needs-auth") {
        throw new Error(
          "This PS2 card needs MagicGate authentication, but no key set is set.",
        );
      }
      if (result.status === "error") {
        throw new Ps2CardError(result.message, result.step);
      }
      return true;
    }

    if (!(card instanceof PS1MemoryCard)) {
      throw new Error(
        "A PS1 card is in the slot, but the selected card is not a PS1 card image.",
      );
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
