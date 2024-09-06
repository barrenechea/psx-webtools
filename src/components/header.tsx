import { Plug, Unplug } from "lucide-react";
import { useState } from "react";

import PSLogo from "@/assets/ps-logo.svg?react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogs } from "@/hooks/use-logs";
import { useSerial } from "@/hooks/use-serial";

export const Header: React.FC = () => {
  const { isConnected, connectToPort, disconnectFromPort } = useSerial();
  const { appendLog } = useLogs();
  const [baudRate, setBaudRate] = useState<number>(115200);

  const handleConnect = async () => {
    try {
      await connectToPort({ baudRate });
      appendLog(`Connected to serial port at ${baudRate} bps`);
    } catch (error) {
      appendLog(`Error connecting to port: ${(error as Error).message}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFromPort();
      appendLog("Disconnected from serial port");
    } catch (error) {
      appendLog(`Error disconnecting from port: ${(error as Error).message}`);
    }
  };

  return (
    <header className="sticky top-0 z-10 border-b  p-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center space-x-4">
          <PSLogo className="size-8" />
          <h1 className="text-2xl font-bold">PS1 WebTools</h1>
        </div>
        <div className="flex items-center space-x-4">
          <Select
            onValueChange={(value: string) => setBaudRate(parseInt(value))}
            defaultValue="115200"
            disabled={isConnected}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select baud rate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="115200">115,200 bps (Standard)</SelectItem>
              <SelectItem value="510000">
                510,000 bps (FTDI friendly)
              </SelectItem>
              <SelectItem value="518400">518,400 bps (PSX native)</SelectItem>
              <SelectItem value="1036800">1,036,800 bps (SIOLOADER)</SelectItem>
            </SelectContent>
          </Select>
          {isConnected ? (
            <Button
              onClick={() => void handleDisconnect()}
              variant="destructive"
            >
              <Unplug className="mr-2 size-4" /> Disconnect
            </Button>
          ) : (
            <Button onClick={() => void handleConnect()} variant="default">
              <Plug className="mr-2 size-4" /> Connect
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
