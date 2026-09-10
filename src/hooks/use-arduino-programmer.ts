import type { Duplex } from "node:stream";

import { useState } from "react";
import STK500, { type Board } from "stk500-esm";

type DataListener = (chunk: Uint8Array) => void;

// stk500-esm talks to a Node Duplex (write / on("data") / removeListener).
// Web Serial already gives us streams; this only fills that duck-typed gap.
function serialStreamForStk500(
  readable: ReadableStream<Uint8Array>,
  writable: WritableStream<Uint8Array>,
) {
  const reader = readable.getReader();
  const writer = writable.getWriter();
  const dataListeners = new Set<DataListener>();
  const pending: Uint8Array[] = [];
  let closed = false;

  const emit = (chunk: Uint8Array) => {
    if (dataListeners.size === 0) pending.push(chunk);
    else for (const listener of dataListeners) listener(chunk);
  };

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || closed) break;
        if (value && value.length > 0) emit(value.slice());
      }
    } catch {
      // Cancel rejects the in-flight read.
    }
  })();

  return {
    write(chunk: Uint8Array, cb?: (error?: Error | null) => void) {
      if (closed) {
        cb?.(new Error("serial stream is closed"));
        return false;
      }
      void writer.write(chunk.slice()).then(
        () => cb?.(),
        (err: unknown) =>
          cb?.(err instanceof Error ? err : new Error(String(err))),
      );
      return true;
    },
    on(_event: "data", listener: DataListener) {
      dataListeners.add(listener);
      while (pending.length > 0 && dataListeners.has(listener)) {
        const next = pending.shift();
        if (next) listener(next);
      }
    },
    removeListener(_event: "data", listener: DataListener) {
      dataListeners.delete(listener);
    },
    async close() {
      if (closed) return;
      closed = true;
      dataListeners.clear();
      pending.length = 0;
      try {
        await reader.cancel();
        reader.releaseLock();
      } catch {
        // Already cancelled.
      }
      try {
        await writer.close();
        writer.releaseLock();
      } catch {
        // Already closed.
      }
    },
  };
}

const useArduinoProgrammer = () => {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const upload = async (
    board: Board,
    hexFileSource: string,
    sourceType: "url" | "content",
  ) => {
    try {
      setError(null);
      setProgress(0);
      setStatus("Preparing to flash...");

      let hexData: string;
      if (sourceType === "url") {
        setStatus("Fetching hex file...");
        const response = await fetch(hexFileSource);
        hexData = await response.text();
      } else {
        hexData = hexFileSource;
      }

      // Check if Web Serial API is supported
      if (!("serial" in navigator)) {
        const errorMessage =
          "Web Serial API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.";
        setError(errorMessage);
        setStatus(`Error: ${errorMessage}`);
        return;
      }

      setStatus("Requesting serial port access...");
      const port = await navigator.serial.requestPort();
      setStatus(`Opening port at ${board.baudRate} baud...`);
      await port.open({ baudRate: board.baudRate });

      const serialStream = serialStreamForStk500(
        port.readable!,
        port.writable!,
      );
      const stk500 = new STK500(serialStream as unknown as Duplex, board);

      setStatus("Starting bootloader process...");
      await stk500.bootload(hexData, (status, percentage) => {
        setProgress(percentage);
        setStatus(`${status}... ${percentage.toFixed(0)}%`);
      });

      setStatus("Flashing completed successfully!");
      setProgress(100);

      await serialStream.close();
      await port.close();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";
      setError(errorMessage);
      setStatus(`Error: ${errorMessage}`);
    }
  };

  return { upload, progress, error, status };
};

export default useArduinoProgrammer;
