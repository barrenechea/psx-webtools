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

// New cards are offered only in the standard retail sizes; cards of other
// valid geometries can still be loaded from a file or a device.
const PS2_CARD_SIZES_MB = [8, 16, 32, 64, 128];

interface Ps2NewCardDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (sizeMb: number) => void;
}

export const Ps2NewCardDialog: React.FC<Ps2NewCardDialogProps> = ({
  isOpen,
  onOpenChange,
  onConfirm,
}) => {
  const [sizeMb, setSizeMb] = useState(8);

  const handleConfirm = () => {
    onConfirm(sizeMb);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New PS2 Memory Card</DialogTitle>
          <DialogDescription>
            Choose a size for the new card. The image is formatted on your
            machine; save it to download a card image file.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="ps2CardSize">Card size</Label>
            <Select
              value={sizeMb.toString()}
              onValueChange={(value) => setSizeMb(parseInt(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                {PS2_CARD_SIZES_MB.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size} MB
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
