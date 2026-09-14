import { useEffect, useRef, useState } from "react";

import { crc32, formatCrc32 } from "@/lib/crc32";
import PS1MemoryCard from "@/lib/ps1-memory-card";
import type {
  CardEvent,
  FormatChoice,
  HardwareInterface,
} from "@/lib/ps1/hardware/core";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { isPs2ConquestCard } from "@/lib/ps2/ps2-conquest";
import { Ps2CardError, type Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import type { Ps2CardImageResult } from "@/lib/ps2/ps2-types";

function throwIfPs2AuthResult(
  result: Ps2CardImageResult,
): asserts result is Extract<Ps2CardImageResult, { status: "ok" }> {
  if (result.status === "needs-auth") {
    throw new Ps2CardError(
      "This PS2 card needs MagicGate authentication, but no key set is set.",
      undefined,
      true,
    );
  }
  if (result.status === "error") {
    throw new Ps2CardError(result.message, result.step);
  }
}

export interface HardwareStartConfig {
  deviceType: string;
  baudRate: number;
  signalsConfig: SerialOutputSignals[];
}

// Manages a single hardware connection (MemCARDuino, Unirom, ...). The
// concrete device is created by the caller and passed in, so this hook stays
// device-agnostic and the connect dialogs can each own their own hardware.
export function useHardwareConnection(
  onDeviceDisconnected?: () => void,
  onCardEvent?: (ev: CardEvent) => void,
) {
  const [device, setDevice] = useState<HardwareInterface | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);
  const connectionGenRef = useRef(0);

  const onDeviceDisconnectedRef = useRef(onDeviceDisconnected);
  useEffect(() => {
    onDeviceDisconnectedRef.current = onDeviceDisconnected;
  });

  // Latest card-event handler, so connect() can stash one stable callback on
  // the hardware that always forwards to the current closure.
  const onCardEventRef = useRef(onCardEvent);
  useEffect(() => {
    onCardEventRef.current = onCardEvent;
  });

  const handleCardEvent = (ev: CardEvent) => {
    onCardEventRef.current?.(ev);
  };

  // OS-reported unplug: drop the connection without calling stop() (the
  // device is already gone) and let the caller clear its own UI state.
  const handleDeviceDisconnected = () => {
    connectionGenRef.current += 1;
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
    const gen = connectionGenRef.current;
    hardware.onDisconnected = handleDeviceDisconnected;
    hardware.onCardEvent = handleCardEvent;

    let result: string | null = null;
    let startError: unknown = null;
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
      startError = err;
    }
    if (startError !== null) {
      setError((startError as Error).message);
      throw startError;
    }

    if (result !== null) {
      setError(result);
      throw new Error(result);
    }

    if (connectionGenRef.current !== gen) {
      setDevice(null);
      setIsConnected(false);
      setFirmwareVersion(null);
      throw new Error("Device disconnected.");
    }

    setDevice(hardware);
    setIsConnected(true);
    setError(null);
    setFirmwareVersion(hardware.firmware());
    onStatusUpdate("Connected successfully.");
  };

  const disconnect = async (
    hardware: HardwareInterface | null,
    onStatusUpdate: (status: string) => void,
  ) => {
    if (hardware) {
      try {
        onStatusUpdate("Closing connection...");
        await hardware.stop();
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

  // Slot I/O and user disconnect take the hardware handle from the caller
  // (session hardwareRef). React `device` lags a commit behind unplug/connect
  // and is not the kill switch.
  const readMemoryCard = async (
    hardware: HardwareInterface,
    onProgress?: (progress: number) => void,
    fixData = false,
    keyset?: Ps2MgKeyset,
  ): Promise<PS1MemoryCard | PS2MemoryCard | null> => {
    const cardCheck = await hardware.checkCard();
    if (!cardCheck.present) {
      throw new Error(cardCheck.message);
    }
    if (cardCheck.kind === "ps2") {
      const result = await hardware.readPS2CardImage((progress) => {
        onProgress?.(progress);
      }, keyset);
      throwIfPs2AuthResult(result);
      const card = PS2MemoryCard.tryFromBytes(result.image);
      if (!card) {
        // A Conquest dump is not a PFS card and must not fall through to the
        // PS1 loader either; report it as Conquest so the user knows why.
        if (isPs2ConquestCard(result.image)) {
          throw new Error(
            "The card is a SoulCalibur II Conquest card with no PFS filesystem; it cannot be loaded or written.",
          );
        }
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
        const frame = await hardware.readMemoryCardFrame(i);
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
    hardware: HardwareInterface,
    card: PS1MemoryCard | PS2MemoryCard,
    onProgress?: (progress: number) => void,
    verify = false,
    frameCount = 1024,
    keyset?: Ps2MgKeyset,
  ): Promise<boolean> => {
    const cardCheck = await hardware.checkCard();
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
      const result = await hardware.writePS2CardImage(
        raw,
        (progress) => {
          onProgress?.(progress);
        },
        verify,
        keyset,
      );
      throwIfPs2AuthResult(result);
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
        const success = await hardware.writeMemoryCardFrame(i, frame);
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
          const frame = await hardware.readMemoryCardFrame(i);
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

  // Format the card in the slot. PS1 writes 64 (quick) or 1024 (full) frames
  // through writeMemoryCard. PS2 keeps the on-disk bad-block list (or
  // spare-scans an unformatted card) and builds format2; quick programs
  // filesystem pages only, full erases every unlisted block first.
  const formatMemoryCard = async (
    hardware: HardwareInterface,
    choice: FormatChoice,
    onProgress?: (progress: number) => void,
    keyset?: Ps2MgKeyset,
  ): Promise<void> => {
    const cardCheck = await hardware.checkCard();
    if (!cardCheck.present) {
      throw new Error(cardCheck.message);
    }
    if (cardCheck.kind === "ps2") {
      if (choice.kind !== "ps2") {
        throw new Error(
          "The card in the slot is PS2, but a PS1 format was requested.",
        );
      }
      const result = await hardware.formatPS2Card(
        (progress) => {
          onProgress?.(progress);
        },
        choice.quick,
        keyset,
      );
      throwIfPs2AuthResult(result);
      return;
    }
    if (choice.kind !== "ps1") {
      throw new Error("The card in the slot is not a PS2 memory card.");
    }
    const blank = new PS1MemoryCard();
    blank.formatCard();
    const success = await writeMemoryCard(
      hardware,
      blank,
      onProgress,
      false,
      choice.quick ? 64 : 1024,
      keyset,
    );
    if (!success) {
      throw new Error("Failed to format memory card");
    }
  };

  return {
    isConnected,
    device,
    error,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
    formatMemoryCard,
    firmwareVersion,
  };
}
