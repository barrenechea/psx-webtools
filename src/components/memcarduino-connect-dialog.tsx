import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MemcarduinoConnectDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (deviceType: string, connectionMode: string) => Promise<void>;
}

export const MemcarduinoConnectDialog: React.FC<
  MemcarduinoConnectDialogProps
> = ({ isOpen, onOpenChange, onConnect }) => {
  const [deviceType, setDeviceType] = useState<string>("");
  const [connectionMode, setConnectionMode] = useState<string>("");

  const handleConnect = async () => {
    if (deviceType && connectionMode) {
      await onConnect(deviceType, connectionMode);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect to MemCARDuino</DialogTitle>
          <DialogDescription>
            Select your device type and connection mode to connect to
            MemCARDuino.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Select value={deviceType} onValueChange={setDeviceType}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select device type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="esp8266_esp32">ESP8266 / ESP32</SelectItem>
              <SelectItem value="rpi_pico">Raspberry Pi Pico</SelectItem>
              <SelectItem value="arduino_nano">Arduino Nano</SelectItem>
              <SelectItem value="arduino_leonardo_micro">
                Arduino Leonardo or Micro
              </SelectItem>
            </SelectContent>
          </Select>

          <Select value={connectionMode} onValueChange={setConnectionMode}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select connection mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">Fast Mode (115200 baud)</SelectItem>
              <SelectItem value="legacy">Legacy Mode (38400 baud)</SelectItem>
            </SelectContent>
          </Select>

          <p className="mt-2 text-sm text-muted-foreground">
            Note: If you purchased a reader from AliExpress, it's very likely to
            use an Arduino Nano in Legacy mode.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => void handleConnect()}
            disabled={!deviceType || !connectionMode}
          >
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
