import { useEffect, useRef, useState } from "react";

import { crc32, formatCrc32 } from "@/lib/crc32";
import type { HardwareInterface, SlotCardKind } from "@/lib/ps1/hardware/core";
import PS1MemoryCard from "@/lib/ps1-memory-card";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";

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
  // Last probed card kind in the connected slot. Cards can be hot-swapped
  // without disconnecting, so this is refreshed by every slot check
  // (connect, read, write), never trusted as a connect-time snapshot.
  const [slotCardKind, setSlotCardKind] = useState<SlotCardKind | null>(null);

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
    setSlotCardKind(null);
    setError("Device disconnected.");
    onDeviceDisconnectedRef.current?.();
  };

  const connect = async (
    hardware: HardwareInterface,
    startConfig: HardwareStartConfig,
    onStatusUpdate: (status: string) => void,
  ) => {
    hardware.onDisconnected = handleDeviceDisconnected;
    setSlotCardKind(null);

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

    // Probe the slot right after connect so the UI knows the card kind
    // before the first read/write. Default checkCard implementations are
    // no-ops; only slot-probing hardware talks to the device.
    const slotCheck = await hardware.checkCard();
    setSlotCardKind(slotCheck.present ? slotCheck.kind : null);
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
        setSlotCardKind(null);
      } catch (err) {
        setError((err as Error).message);
        onStatusUpdate(`Error disconnecting: ${(err as Error).message}`);
      }
    }
  };

  const readMemoryCard = async (
    onProgress?: (progress: number) => void,
    fixData = false,
  ): Promise<PS1MemoryCard | PS2MemoryCard | null> => {
    if (!device) {
      setError("Device not connected");
      return null;
    }
    const cardCheck = await device.checkCard();
    setSlotCardKind(cardCheck.present ? cardCheck.kind : null);
    if (!cardCheck.present) {
      throw new Error(cardCheck.message);
    }
    if (cardCheck.kind === "ps2") {
      const result = await device.readPS2CardImage((progress) => {
        onProgress?.(progress);
      });
      if (result.status === "needs-auth") {
        throw new Error(
          "This PS2 card needs authentication before it can be read, which is not supported yet.",
        );
      }
      if (result.status === "error") {
        throw new Error(result.message);
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
    card: PS1MemoryCard,
    onProgress?: (progress: number) => void,
    verify = false,
    frameCount = 1024,
  ): Promise<boolean> => {
    if (!device) {
      setError("Device not connected");
      return false;
    }
    const cardCheck = await device.checkCard();
    setSlotCardKind(cardCheck.present ? cardCheck.kind : null);
    if (!cardCheck.present) {
      throw new Error(cardCheck.message);
    }
    if (cardCheck.kind === "ps2") {
      throw new Error(
        "A PS2 memory card is in the slot. PS2 card write over hardware is not supported yet.",
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
    slotCardKind,
  };
}
