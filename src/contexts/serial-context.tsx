import { createContext, ReactNode, useCallback, useRef, useState } from "react";

export interface SerialContextType {
  port: SerialPort | null;
  isConnected: boolean;
  connectToPort: (options: SerialOptions) => Promise<void>;
  disconnectFromPort: () => Promise<void>;
  writeToPort: (data: Uint8Array, timeout: number) => Promise<void>;
  withPortWriter: <T>(
    operation: (
      writer: WritableStreamDefaultWriter<Uint8Array>,
      signal: AbortSignal
    ) => Promise<T>
  ) => Promise<T>;
  cancelCurrentOperation: () => void;
}

interface SerialOptions {
  baudRate: number;
}

export const SerialContext = createContext<SerialContextType | undefined>(
  undefined
);

export const SerialProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const connectToPort = useCallback(
    async (options: SerialOptions): Promise<void> => {
      try {
        const selectedPort = await navigator.serial.requestPort();
        await selectedPort.open({
          baudRate: options.baudRate,
          parity: "none",
          dataBits: 8,
          stopBits: 2,
        });

        // Required for e.g. SharkLink & Yaroze cable compat. Doesn't interfere with the 3-wire setups.
        // Setting them after open due to https://github.com/WICG/serial/issues/195#issuecomment-1703331091
        await selectedPort.setSignals({
          dataTerminalReady: true,
          requestToSend: true,
        });

        setPort(selectedPort);
        setIsConnected(true);
      } catch (error) {
        throw new Error(
          `Error connecting to port: ${(error as Error).message}`
        );
      }
    },
    []
  );

  const disconnectFromPort = useCallback(async (): Promise<void> => {
    if (port) {
      try {
        await port.close();
        setPort(null);
        setIsConnected(false);
      } catch (error) {
        throw new Error(
          `Error disconnecting from port: ${(error as Error).message}`
        );
      }
    }
  }, [port]);

  const withPortWriter = useCallback(
    async <T,>(
      operation: (
        writer: WritableStreamDefaultWriter<Uint8Array>,
        signal: AbortSignal
      ) => Promise<T>
    ): Promise<T> => {
      if (!port) throw new Error("Port is not connected");
      if (!port.writable) throw new Error("Port is not writable");

      const writer = port.writable.getWriter();
      abortControllerRef.current = new AbortController();

      try {
        return await operation(writer, abortControllerRef.current.signal);
      } finally {
        writer.releaseLock();
        abortControllerRef.current = null;
      }
    },
    [port]
  );

  const writeToPort = useCallback(
    async (data: Uint8Array, timeout: number): Promise<void> => {
      return withPortWriter(async (writer, signal) => {
        await Promise.race([
          writer.write(data),
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("Write operation timed out")),
              timeout
            );
          }),
        ]);
      });
    },
    [withPortWriter]
  );

  const cancelCurrentOperation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return (
    <SerialContext.Provider
      value={{
        port,
        isConnected,
        connectToPort,
        disconnectFromPort,
        writeToPort,
        withPortWriter,
        cancelCurrentOperation,
      }}
    >
      {children}
    </SerialContext.Provider>
  );
};
