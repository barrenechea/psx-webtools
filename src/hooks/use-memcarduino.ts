import { useCallback, useState } from "react";

import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import PS1MemoryCard from "@/lib/ps1-memory-card";

export function useMemcarduino() {
  const [memcarduino, setMemcarduino] = useState<MemCARDuino | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (portInfo: string, speed: number) => {
    try {
      const mcduino = new MemCARDuino();
      const result = await mcduino.start(portInfo, speed);
      if (result === null) {
        setMemcarduino(mcduino);
        setIsConnected(true);
        setError(null);
      } else {
        setError(result);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (memcarduino) {
      await memcarduino.stop();
      setMemcarduino(null);
      setIsConnected(false);
    }
  }, [memcarduino]);

  const readMemoryCard =
    useCallback(async (): Promise<PS1MemoryCard | null> => {
      if (!memcarduino) {
        setError("MemCARDuino not connected");
        return null;
      }

      try {
        const card = new PS1MemoryCard();
        for (let i = 0; i < 1024; i++) {
          const frame = await memcarduino.readMemoryCardFrame(i);
          if (frame === null) {
            throw new Error(`Failed to read frame ${i}`);
          }
          card.setRawData(i * 128, frame);
        }
        return card;
      } catch (err) {
        setError((err as Error).message);
        return null;
      }
    }, [memcarduino]);

  const writeMemoryCard = useCallback(
    async (card: PS1MemoryCard): Promise<boolean> => {
      if (!memcarduino) {
        setError("MemCARDuino not connected");
        return false;
      }

      try {
        for (let i = 0; i < 1024; i++) {
          const frame = card.getRawData(i * 128, 128);
          const success = await memcarduino.writeMemoryCardFrame(i, frame);
          if (!success) {
            throw new Error(`Failed to write frame ${i}`);
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

  return {
    isConnected,
    error,
    connect,
    disconnect,
    readMemoryCard,
    writeMemoryCard,
  };
}
