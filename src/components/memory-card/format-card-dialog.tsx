import { useState } from "react";

import { Button } from "@/components/ui/button";
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
import type { FormatChoice } from "@/lib/ps1/hardware/core";

const FORMAT_TYPE_ITEMS = [
  { value: "0", label: "Quick format" },
  { value: "1", label: "Full format" },
];

function formatTypeHelp(isPs2: boolean, quick: boolean): string {
  if (isPs2) {
    return quick
      ? "Quick format is how the PS3 Memory Card Utility formats a card: it rebuilds the filesystem and leaves unused erase blocks alone. Listed bad blocks are never touched."
      : "Full format rebuilds the filesystem after erasing every usable block first, instead of leaving unused erase blocks alone. Listed bad blocks are never touched.";
  }
  return quick
    ? "Quick rewrites the card header for a fast reset."
    : "Full rewrites every block on the card, not only the header.";
}

interface FormatCardDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  deviceName: string;
  // The slot kind probed when the dialog opened. PS2 quick is the PS3 Utility
  // path; PS1 quick rewrites 64 frames.
  cardKind: "ps1" | "ps2";
  onFormat: (choice: FormatChoice) => void;
}

export const FormatCardDialog: React.FC<FormatCardDialogProps> = ({
  isOpen,
  onOpenChange,
  deviceName,
  cardKind,
  onFormat,
}) => {
  const [formatType, setFormatType] = useState<0 | 1>(0);
  const isPs2 = cardKind === "ps2";

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Format {deviceName}</DialogTitle>
          <DialogDescription>
            {isPs2
              ? "Rebuild the PS2 filesystem. Existing saves will no longer appear. This cannot be undone."
              : "Erase the memory card in the connected device into an empty, formatted state. This cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Format type</Label>
            <Select
              items={FORMAT_TYPE_ITEMS}
              value={String(formatType)}
              onValueChange={(value) => {
                if (value != null) setFormatType(Number(value) as 0 | 1);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format type" />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_TYPE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {formatTypeHelp(isPs2, formatType === 0)}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onFormat({
                kind: isPs2 ? "ps2" : "ps1",
                quick: formatType === 0,
              })
            }
          >
            Format
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
