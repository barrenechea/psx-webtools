import { useState } from "react";

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
    saveSettings: boolean,
  ) => Promise<void>;
}

interface SavedSettings {
  deviceType: string;
  connectionMode: string;
  saveSettings: boolean;
}

const DEFAULT_SETTINGS: SavedSettings = {
  deviceType: "",
  connectionMode: "",
  saveSettings: false,
};

const DEVICE_TYPE_ITEMS = [
  { value: "esp8266_esp32", label: "ESP8266 / ESP32" },
  { value: "rpi_pico", label: "Raspberry Pi Pico" },
  { value: "arduino_nano", label: "Arduino Nano" },
  {
    value: "arduino_leonardo_micro",
    label: "Arduino Leonardo or Micro",
  },
];

const CONNECTION_MODE_ITEMS = [
  { value: "fast", label: "Fast Mode (115200 baud)" },
  { value: "legacy", label: "Legacy Mode (38400 baud)" },
];

const loadSavedSettings = (): SavedSettings => {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  const savedSettings = window.localStorage.getItem("memcarduinoSettings");
  if (!savedSettings) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(savedSettings) as Partial<SavedSettings>;
    return {
      deviceType: parsed.deviceType ?? "",
      connectionMode: parsed.connectionMode ?? "",
      saveSettings: parsed.saveSettings ?? false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const MemcarduinoConnectDialog: React.FC<
  MemcarduinoConnectDialogProps
> = ({ isOpen, onOpenChange, onConnect }) => {
  const [deviceType, setDeviceType] = useState<string>(
    () => loadSavedSettings().deviceType,
  );
  const [connectionMode, setConnectionMode] = useState<string>(
    () => loadSavedSettings().connectionMode,
  );
  const [saveSettings, setSaveSettings] = useState(
    () => loadSavedSettings().saveSettings,
  );

  const handleConnect = async () => {
    if (deviceType && connectionMode) {
      await onConnect(deviceType, connectionMode, saveSettings);
      if (saveSettings) {
        localStorage.setItem(
          "memcarduinoSettings",
          JSON.stringify({ deviceType, connectionMode, saveSettings }),
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
        <div className="grid gap-4">
          <Select
            items={DEVICE_TYPE_ITEMS}
            value={deviceType}
            onValueChange={(value) => {
              if (value != null) setDeviceType(value);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select device type" />
            </SelectTrigger>
            <SelectContent>
              {DEVICE_TYPE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            items={CONNECTION_MODE_ITEMS}
            value={connectionMode}
            onValueChange={(value) => {
              if (value != null) setConnectionMode(value);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select connection mode" />
            </SelectTrigger>
            <SelectContent>
              {CONNECTION_MODE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-muted-foreground mt-2 text-sm">
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
