import { useCallback, useState } from "react";

import { useLogs } from "@/hooks/use-logs";

enum MCinoCommands {
  GETID = 0xa0,
  GETVER = 0xa1,
  MCR = 0xa2,
  MCW = 0xa3,
  PSINFO = 0xb0,
  PSBIOS = 0xb1,
  PSTIME = 0xb2,
}

enum MCinoResponses {
  ERROR = 0xe0,
  GOOD = 0x47,
  BADCHECKSUM = 0x4e,
  BADSECTOR = 0xff,
}

interface UseMemCARDuinoReturn {
  connect: (baudRate: number) => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: boolean;
  firmwareVersion: string | null;
  readFrame: (frameNumber: number) => Promise<Uint8Array | null>;
  writeFrame: (frameNumber: number, frameData: Uint8Array) => Promise<boolean>;
}

export function useMemCARDuino(): UseMemCARDuinoReturn {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [reader, setReader] =
    useState<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const [writer, setWriter] =
    useState<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const [firmwareVersion, setFirmwareVersion] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const { appendLog } = useLogs();

  const sendCommand = useCallback(
    async (
      command: MCinoCommands,
      currentWriter: WritableStreamDefaultWriter<Uint8Array>
    ) => {
      await currentWriter.write(new Uint8Array([command]));
    },
    []
  );

  const readResponse = useCallback(
    async (
      length: number,
      currentReader: ReadableStreamDefaultReader<Uint8Array>
    ): Promise<Uint8Array> => {
      let buffer = new Uint8Array(0);
      while (buffer.length < length) {
        const { value, done } = await currentReader.read();
        if (done) break;
        buffer = new Uint8Array([...buffer, ...value]);
      }
      if (buffer.length < length) throw new Error("Incomplete response");
      return buffer.slice(0, length);
    },
    []
  );

  const disconnect = useCallback(async () => {
    if (reader) {
      await reader.cancel();
      setReader(null);
    }
    if (writer) {
      await writer.close();
      setWriter(null);
    }
    if (port) {
      await port.close();
      setPort(null);
    }
    setFirmwareVersion(null);
    setIsConnected(false);
    appendLog("Disconnected from MemCARDuino");
  }, [appendLog]);

  const connect = useCallback(
    async (baudRate: number) => {
      try {
        const selectedPort = await navigator.serial.requestPort();
        await selectedPort.open({
          baudRate,
          dataBits: 8,
          stopBits: 2,
          parity: "none",
        });

        if (!selectedPort.readable || !selectedPort.writable) {
          throw new Error("Serial port is not readable or writable");
        }

        const portReader = selectedPort.readable.getReader();
        const portWriter = selectedPort.writable.getWriter();

        // Toggle DTR to reset Arduino
        await selectedPort.setSignals({ dataTerminalReady: false });
        await new Promise((resolve) => setTimeout(resolve, 100));
        await selectedPort.setSignals({ dataTerminalReady: true });
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Set RTS and DTR
        await selectedPort.setSignals({
          dataTerminalReady: true,
          requestToSend: true,
        });

        // Check if this is MemCARDuino
        await sendCommand(MCinoCommands.GETID, portWriter);
        let idResponse = await readResponse(6, portReader);

        if (new TextDecoder().decode(idResponse) !== "MCDINO") {
          // Try again with DTR enabled (for Arduino Leonardo or Micro)
          await selectedPort.setSignals({ dataTerminalReady: true });
          await sendCommand(MCinoCommands.GETID, portWriter);
          idResponse = await readResponse(6, portReader);

          if (new TextDecoder().decode(idResponse) !== "MCDINO") {
            throw new Error("MemCARDuino not detected");
          }
        }

        // Get firmware version
        await sendCommand(MCinoCommands.GETVER, portWriter);
        const versionResponse = await readResponse(1, portReader);
        const version = versionResponse[0];

        // Now that we've confirmed the connection, update the state
        setPort(selectedPort);
        setReader(portReader);
        setWriter(portWriter);
        setFirmwareVersion(`${version >> 4}.${version & 0xf}`);
        setIsConnected(true);

        appendLog(`Connected to MemCARDuino at ${baudRate} bps`);
      } catch (error) {
        appendLog(`Failed to connect: ${(error as Error).message}`);
        await disconnect();
      }
    },
    [appendLog, sendCommand, readResponse, disconnect]
  );

  const readFrame = useCallback(
    async (frameNumber: number): Promise<Uint8Array | null> => {
      if (!writer || !reader) throw new Error("Not connected");

      const frameMsb = (frameNumber >> 8) & 0xff;
      const frameLsb = frameNumber & 0xff;

      await sendCommand(MCinoCommands.MCR, writer);
      await writer.write(new Uint8Array([frameMsb, frameLsb]));

      const response = await readResponse(130, reader);
      const frameData = response.slice(0, 128);
      const checksum = response[128];
      const status = response[129];

      if (status !== MCinoResponses.GOOD) {
        appendLog(`Failed to read frame ${frameNumber}: Bad status`);
        return null;
      }

      let calculatedChecksum = frameMsb ^ frameLsb;
      for (const byte of frameData) calculatedChecksum ^= byte;

      if (calculatedChecksum !== checksum) {
        appendLog(`Failed to read frame ${frameNumber}: Checksum mismatch`);
        return null;
      }

      appendLog(`Successfully read frame ${frameNumber}`);
      return frameData;
    },
    [writer, reader, sendCommand, readResponse, appendLog]
  );

  const writeFrame = useCallback(
    async (frameNumber: number, frameData: Uint8Array): Promise<boolean> => {
      if (!writer || !reader) throw new Error("Not connected");
      if (frameData.length !== 128)
        throw new Error("Invalid frame data length");

      const frameMsb = (frameNumber >> 8) & 0xff;
      const frameLsb = frameNumber & 0xff;

      let checksum = frameMsb ^ frameLsb;
      for (const byte of frameData) checksum ^= byte;

      await sendCommand(MCinoCommands.MCW, writer);
      await writer.write(
        new Uint8Array([frameMsb, frameLsb, ...frameData, checksum])
      );

      const response = await readResponse(1, reader);
      const success = response[0] === MCinoResponses.GOOD;

      if (success) {
        appendLog(`Successfully wrote frame ${frameNumber}`);
      } else {
        appendLog(`Failed to write frame ${frameNumber}`);
      }

      return success;
    },
    [writer, reader, sendCommand, readResponse, appendLog]
  );

  return {
    connect,
    disconnect,
    isConnected,
    firmwareVersion,
    readFrame,
    writeFrame,
  };
}
