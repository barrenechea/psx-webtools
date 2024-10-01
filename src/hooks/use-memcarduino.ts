import { useCallback, useMemo, useState } from "react";

import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import PS1MemoryCard from "@/lib/ps1-memory-card";

export function useMemcarduino() {
  const [memcarduino, setMemcarduino] = useState<MemCARDuino | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);

  const connect = useCallback(
    async (
      deviceType: string,
      baudRate: number,
      signalsConfig: SerialOutputSignals[],
      onStatusUpdate: (status: string) => void
    ) => {
      try {
        const mcduino = new MemCARDuino();
        onStatusUpdate(`Attempting connection at ${baudRate} baud...`);
        const result = await mcduino.start(
          deviceType,
          baudRate,
          signalsConfig,
          onStatusUpdate
        );
        if (result === null) {
          setMemcarduino(mcduino);
          setIsConnected(true);
          setError(null);
          setFirmwareVersion(mcduino.firmware());
          onStatusUpdate(
            `Connected successfully at ${mcduino.getBaudRate()} baud.`
          );
        } else {
          throw new Error(result);
        }
      } catch (err) {
        setError((err as Error).message);
        throw err;
      }
    },
    []
  );

  const disconnect = useCallback(
    async (onStatusUpdate: (status: string) => void) => {
      if (memcarduino) {
        try {
          onStatusUpdate("Closing connection...");
          await memcarduino.stop();
          onStatusUpdate("Disconnected successfully.");
          setMemcarduino(null);
          setIsConnected(false);
          setFirmwareVersion(null);
        } catch (err) {
          setError((err as Error).message);
          onStatusUpdate(`Error disconnecting: ${(err as Error).message}`);
        }
      }
    },
    [memcarduino]
  );

  const readMemoryCard = useCallback(
    async (
      onProgress?: (progress: number) => void
    ): Promise<PS1MemoryCard | null> => {
      if (!memcarduino) {
        setError("MemCARDuino not connected");
        return null;
      }

      try {
        const card = new PS1MemoryCard();

        // Delay to play nice with WebSerial - damn you Virtual DOM!
        await new Promise((resolve) => setTimeout(resolve, 100));

        for (let i = 0; i < 1024; i++) {
          const frame = await memcarduino.readMemoryCardFrame(i);
          if (frame === null) {
            throw new Error(`Failed to read frame ${i}`);
          }
          card.setRawData(i * 128, frame);

          if (onProgress) {
            onProgress((i + 1) / 1024);
          }
        }
        return card;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    },
    [memcarduino]
  );

  const writeMemoryCard = useCallback(
    async (
      card: PS1MemoryCard,
      onProgress?: (progress: number) => void
    ): Promise<boolean> => {
      if (!memcarduino) {
        setError("MemCARDuino not connected");
        return false;
      }

      try {
        // Delay to play nice with WebSerial - damn you Virtual DOM!
        await new Promise((resolve) => setTimeout(resolve, 100));

        for (let i = 0; i < 1024; i++) {
          const frame = card.getRawData(i * 128, 128);
          const success = await memcarduino.writeMemoryCardFrame(i, frame);
          if (!success) {
            throw new Error(`Failed to write frame ${i}`);
          }

          if (onProgress) {
            onProgress((i + 1) / 1024);
          }
        }
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    },
    [memcarduino]
  );

  return useMemo(
    () => ({
      isConnected,
      error,
      connect,
      disconnect,
      readMemoryCard,
      writeMemoryCard,
      firmwareVersion,
    }),
    [
      isConnected,
      error,
      connect,
      disconnect,
      readMemoryCard,
      writeMemoryCard,
      firmwareVersion,
    ]
  );
}
