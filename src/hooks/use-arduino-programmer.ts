import { useCallback, useState } from "react";
import { ReadableWebToNodeStream } from "readable-web-to-node-stream";
import STK500, { type Board } from "stk500-esm";

const useArduinoProgrammer = () => {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const upload = useCallback(
    async (
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

        setStatus("Requesting serial port access...");
        const port = await navigator.serial.requestPort();
        setStatus(`Opening port at ${board.baudRate} baud...`);
        await port.open({ baudRate: board.baudRate });

        const reader = new ReadableWebToNodeStream(port.readable!);
        const writer = port.writable!.getWriter();

        const serialStream = reader as unknown as NodeJS.ReadWriteStream;
        // @ts-expect-error We are faking the stream
        serialStream.write = (
          buffer: string | Uint8Array,
          onDone: (err: Error | null | undefined) => void
        ) => {
          writer.write(Buffer.from(buffer)).then(() => onDone(null), onDone);
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
    },
    []
  );

  return { upload, progress, error, status };
};

export default useArduinoProgrammer;
