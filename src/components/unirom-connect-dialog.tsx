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

interface UniromConnectDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (cardSlot: number, saveSettings: boolean) => Promise<void>;
}

interface SavedSettings {
  cardSlot: number;
  saveSettings: boolean;
}

const DEFAULT_SETTINGS: SavedSettings = {
  cardSlot: 0,
  saveSettings: false,
};

const loadSavedSettings = (): SavedSettings => {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  const savedSettings = window.localStorage.getItem("uniromSettings");
  if (!savedSettings) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = JSON.parse(savedSettings) as Partial<SavedSettings>;
    return {
      cardSlot: parsed.cardSlot ?? 0,
      saveSettings: parsed.saveSettings ?? false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const UniromConnectDialog: React.FC<UniromConnectDialogProps> = ({
  isOpen,
  onOpenChange,
  onConnect,
}) => {
  const [cardSlot, setCardSlot] = useState<number>(
    () => loadSavedSettings().cardSlot,
  );
  const [saveSettings, setSaveSettings] = useState(
    () => loadSavedSettings().saveSettings,
  );

  const handleConnect = async () => {
    await onConnect(cardSlot, saveSettings);
    if (saveSettings) {
      localStorage.setItem(
        "uniromSettings",
        JSON.stringify({ cardSlot, saveSettings }),
      );
    } else {
      localStorage.removeItem("uniromSettings");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect to Unirom</DialogTitle>
          <DialogDescription>
            Select the memory card slot to read from or write to.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Memory card slot</Label>
            <Select
              value={String(cardSlot)}
              onValueChange={(value) => setCardSlot(Number(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select memory card slot" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Slot 1</SelectItem>
                <SelectItem value="1">Slot 2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <p className="text-muted-foreground text-sm">
            Note: Unirom connects at a fixed 115200 baud rate. Make sure the
            Unirom firmware is running on your console.
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
          <Button onClick={() => void handleConnect()}>Connect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
