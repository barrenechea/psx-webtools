import { useCallback, useState } from "react";
import { ReadableWebToNodeStream } from "readable-web-to-node-stream";
import STK500, { type Board } from "stk500-esm";

const useArduinoProgrammer = () => {
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (
      board: Board,
      hexFileSource: string,
      sourceType: "url" | "content"
    ) => {
      try {
        setError(null);
        setProgress(0);

        let hexData: string;
        if (sourceType === "url") {
          // Fetch hex file from URL
          const response = await fetch(hexFileSource);
          hexData = await response.text();
        } else {
          // Use the provided hex file content
          hexData = hexFileSource;
        }

        // Request serial port access
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: board.baudRate });

        // Create readable and writable streams
        const reader = new ReadableWebToNodeStream(port.readable!);
        const writer = port.writable!.getWriter();

        // Create a fake NodeJS.ReadWriteStream
        const serialStream = reader as unknown as NodeJS.ReadWriteStream;
        // @ts-expect-error We are faking the stream
        serialStream.write = (
          buffer: string | Uint8Array,
          onDone: (err: Error | null | undefined) => void
        ) => {
          writer.write(Buffer.from(buffer)).then(() => onDone(null), onDone);
          return true;
        };

        const stk500 = new STK500();
        await stk500.bootload(serialStream, hexData, board);

        setProgress(100);

        if (reader) {
          // @ts-expect-error this is specific to the "readable-web-to-node-stream" library
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await reader.reader.cancel();
          // await this.reader.close() // this blocks if uploading failed
        }
        if (writer) {
          await writer.close();
        }
        if (port) {
          await port.close();
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unknown error occurred"
        );
      }
    },
    []
  );

  return { upload, progress, error };
};

export default useArduinoProgrammer;
