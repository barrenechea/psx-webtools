import type { Duplex } from "node:stream";

import { useState } from "react";
import { ReadableWebToNodeStream } from "readable-web-to-node-stream";
import STK500, { type Board } from "stk500-esm";

const useArduinoProgrammer = () => {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const upload = async (
    board: Board,
    hexFileSource: string,
    sourceType: "url" | "content"
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
      if (!('serial' in navigator)) {
        throw new Error('Web Serial API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.');
      }

      setStatus("Requesting serial port access...");
      const port = await navigator.serial.requestPort();
      setStatus(`Opening port at ${board.baudRate} baud...`);
      await port.open({ baudRate: board.baudRate });

      const reader = new ReadableWebToNodeStream(port.readable!);
      const writer = port.writable!.getWriter();

      // We're faking the stream
      const serialStream = reader as unknown as Duplex;
      serialStream.write = (
        chunk: string | Uint8Array,
        encodingOrCb?:
          | BufferEncoding
          | ((error?: Error | null) => void),
        cb?: (error?: Error | null) => void
      ) => {
        const encoder = new TextEncoder();
        const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
        void writer
          .write(typeof chunk === "string" ? encoder.encode(chunk) : chunk)
          .then(() => callback?.(), callback);
        return true;
      };

      const stk500 = new STK500(serialStream, board);

      setStatus("Starting bootloader process...");
      await stk500.bootload(hexData, (status, percentage) => {
        setProgress(percentage);
        setStatus(`${status}... ${percentage.toFixed(0)}%`);
      });

      setStatus("Flashing completed successfully!");
      setProgress(100);

      if (reader) {
        // @ts-expect-error this is specific to the "readable-web-to-node-stream" library
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await reader.reader.cancel();
      }
      if (writer) {
        await writer.close();
      }
      if (port) {
        await port.close();
      }
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
