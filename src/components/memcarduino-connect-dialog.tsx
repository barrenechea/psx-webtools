import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  onConnect: (
    deviceType: string,
    connectionMode: string,
    saveSettings: boolean
  ) => Promise<void>;
}

interface SavedSettings {
  deviceType: string;
  connectionMode: string;
  saveSettings: boolean;
}

export const MemcarduinoConnectDialog: React.FC<
  MemcarduinoConnectDialogProps
> = ({ isOpen, onOpenChange, onConnect }) => {
  const [deviceType, setDeviceType] = useState<string>("");
  const [connectionMode, setConnectionMode] = useState<string>("");
  const [saveSettings, setSaveSettings] = useState(false);

  useEffect(() => {
    const savedSettings = localStorage.getItem("memcarduinoSettings");
    if (savedSettings) {
      const {
        deviceType: savedDeviceType,
        connectionMode: savedConnectionMode,
        saveSettings,
      } = JSON.parse(savedSettings) as SavedSettings;
      setDeviceType(savedDeviceType);
      setConnectionMode(savedConnectionMode);
      setSaveSettings(saveSettings);
    }
  }, []);

  const handleConnect = async () => {
    if (deviceType && connectionMode) {
      await onConnect(deviceType, connectionMode, saveSettings);
      if (saveSettings) {
        localStorage.setItem(
          "memcarduinoSettings",
          JSON.stringify({ deviceType, connectionMode, saveSettings })
        );
      } else {
        localStorage.removeItem("memcarduinoSettings");
      }
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
            Note: If you purchased a reader from AliExpress with the software as
            it comes, it's very likely to use an Arduino Nano in Legacy mode.
          </p>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="saveSettings"
              checked={saveSettings}
              onCheckedChange={(checked) => setSaveSettings(checked as boolean)}
            />
            <Label htmlFor="saveSettings">
              Save settings for next connection
            </Label>
          </div>
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
