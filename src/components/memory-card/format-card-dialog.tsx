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

interface FormatCardDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  deviceName: string;
  onFormat: (quick: boolean) => void;
}

export const FormatCardDialog: React.FC<FormatCardDialogProps> = ({
  isOpen,
  onOpenChange,
  deviceName,
  onFormat,
}) => {
  const [formatType, setFormatType] = useState<0 | 1>(0);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Format {deviceName}</DialogTitle>
          <DialogDescription>
            Erase the memory card in the connected device into an empty,
            formatted state. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Format type</Label>
            <Select
              value={String(formatType)}
              onValueChange={(value) => setFormatType(Number(value) as 0 | 1)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Quick format</SelectItem>
                <SelectItem value="1">Full format</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              Quick rewrites the card header for a fast reset; full rewrites
              every block on the card.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onFormat(formatType === 0)}>Format</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
