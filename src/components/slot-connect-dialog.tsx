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

const MEMORY_CARD_SLOT_ITEMS = [
  { value: "0", label: "Slot 1" },
  { value: "1", label: "Slot 2" },
];

interface SlotConnectDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  storageKey: string;
  note: string;
  onConnect: (cardSlot: number) => Promise<void>;
}

interface SavedSettings {
  cardSlot: number;
  saveSettings: boolean;
}

const DEFAULT_SETTINGS: SavedSettings = {
  cardSlot: 0,
  saveSettings: false,
};

const loadSavedSettings = (storageKey: string): SavedSettings => {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  const savedSettings = window.localStorage.getItem(storageKey);
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

export const SlotConnectDialog: React.FC<SlotConnectDialogProps> = ({
  isOpen,
  onOpenChange,
  title,
  storageKey,
  note,
  onConnect,
}) => {
  const [cardSlot, setCardSlot] = useState<number>(
    () => loadSavedSettings(storageKey).cardSlot,
  );
  const [saveSettings, setSaveSettings] = useState(
    () => loadSavedSettings(storageKey).saveSettings,
  );

  const handleConnect = async () => {
    await onConnect(cardSlot);
    if (saveSettings) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ cardSlot, saveSettings }),
      );
    } else {
      localStorage.removeItem(storageKey);
    }
  };

  const saveId = `${storageKey}-saveSettings`;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Select the memory card slot to read from or write to.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Memory card slot</Label>
            <Select
              items={MEMORY_CARD_SLOT_ITEMS}
              value={String(cardSlot)}
              onValueChange={(value) => {
                if (value != null) setCardSlot(Number(value));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select memory card slot" />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_CARD_SLOT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm text-muted-foreground">{note}</p>

          <div className="flex items-center space-x-2">
            <Checkbox
              id={saveId}
              checked={saveSettings}
              onCheckedChange={(checked) => setSaveSettings(checked)}
            />
            <Label htmlFor={saveId}>Save settings for next connection</Label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void handleConnect()}>Connect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
