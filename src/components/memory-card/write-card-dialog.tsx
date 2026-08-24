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

interface WriteCardDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  cardName: string;
  checksum: string;
  deviceName: string;
  verify: boolean;
  onVerifyChange: (value: boolean) => void;
  onConfirm: () => void;
}

export const WriteCardDialog: React.FC<WriteCardDialogProps> = ({
  isOpen,
  onOpenChange,
  cardName,
  checksum,
  deviceName,
  verify,
  onVerifyChange,
  onConfirm,
}) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Write to {deviceName}</DialogTitle>
        <DialogDescription>
          Overwrite the memory card in the connected device with{" "}
          <span className="text-foreground font-medium">{cardName}</span>. This
          cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Raw CRC-32
          </p>
          <p className="font-mono text-sm tracking-wider">{checksum}</p>
        </div>
        <div className="flex items-start space-x-2">
          <Checkbox
            id="verify-after-write"
            className="mt-0.5"
            checked={verify}
            onCheckedChange={(checked) => onVerifyChange(checked === true)}
          />
          <div className="grid gap-1">
            <Label htmlFor="verify-after-write">Verify after write</Label>
            <p className="text-muted-foreground text-sm">
              Re-read the card and confirm the raw checksum still matches. GME
              comments are not part of this check.
            </p>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={onConfirm}>Write</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
