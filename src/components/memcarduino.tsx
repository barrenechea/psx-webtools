import { AlertCircle } from "lucide-react";
import React, { useCallback, useState } from "react";

import { LogViewer } from "@/components/log-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogs } from "@/hooks/use-logs";
import { useMemCARDuino } from "@/hooks/use-memcarduino";

export const MemCARDuinoReader: React.FC = () => {
  const {
    connect,
    disconnect,
    isConnected,
    firmwareVersion,
    readFrame,
    writeFrame,
  } = useMemCARDuino();
  const { logs } = useLogs();
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [frameNumber, setFrameNumber] = useState<number>(0);
  const [frameData, setFrameData] = useState<string>("");

  const handleConnect = useCallback(async () => {
    try {
      await connect(baudRate);
    } catch (error) {
      console.error("Failed to connect:", error);
    }
  }, [connect, baudRate]);

  const handleReadFrame = useCallback(async () => {
    try {
      const data = await readFrame(frameNumber);
      if (data) {
        setFrameData(
          Array.from(data)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ")
        );
      } else {
        setFrameData("Failed to read frame");
      }
    } catch (error) {
      console.error("Failed to read frame:", error);
      setFrameData("Error reading frame");
    }
  }, [readFrame, frameNumber]);

  const handleWriteFrame = useCallback(async () => {
    try {
      const dataArray = frameData.split(" ").map((hex) => parseInt(hex, 16));
      if (dataArray.length !== 128) {
        throw new Error("Invalid frame data length");
      }
      const success = await writeFrame(frameNumber, new Uint8Array(dataArray));
      if (success) {
        alert("Frame written successfully");
      } else {
        alert("Failed to write frame");
      }
    } catch (error) {
      console.error("Failed to write frame:", error);
      alert("Error writing frame");
    }
  }, [writeFrame, frameNumber, frameData]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>MemCARDuino Reader</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex space-x-4">
          <Select
            onValueChange={(value) => setBaudRate(parseInt(value))}
            defaultValue={baudRate.toString()}
            disabled={isConnected}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Baud rate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="38400">38400</SelectItem>
              <SelectItem value="115200">115200</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => {
              if (isConnected) void disconnect();
              else void handleConnect();
            }}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </Button>
        </div>
        {isConnected && (
          <div className="space-y-4">
            <div>Firmware version: {firmwareVersion}</div>
            <div className="flex space-x-4">
              <Input
                type="number"
                placeholder="Frame number"
                value={frameNumber}
                onChange={(e) => setFrameNumber(parseInt(e.target.value))}
              />
              <Button onClick={() => void handleReadFrame()}>Read Frame</Button>
              <Button onClick={() => void handleWriteFrame()}>Write Frame</Button>
            </div>
            <textarea
              className="h-32 w-full rounded border p-2"
              value={frameData}
              onChange={(e) => setFrameData(e.target.value)}
              placeholder="Frame data (hex)"
            />
          </div>
        )}
        <LogViewer logs={logs} />
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Note</AlertTitle>
          <AlertDescription>
            This feature requires a browser that supports the Web Serial API and
            a connected MemCARDuino device.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
