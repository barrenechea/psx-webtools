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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STANDARD_REGIONS = ["America", "Europe", "Japan"];

interface EditHeaderDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialProductCode: string;
  initialIdentifier: string;
  initialRegion: string;
  onSave: (productCode: string, identifier: string, region: string) => void;
}

export const EditHeaderDialog: React.FC<EditHeaderDialogProps> = ({
  isOpen,
  onOpenChange,
  initialProductCode,
  initialIdentifier,
  initialRegion,
  onSave,
}) => {
  const [productCode, setProductCode] = useState(initialProductCode);
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [region, setRegion] = useState(initialRegion);

  const regionOptions = STANDARD_REGIONS.includes(initialRegion)
    ? STANDARD_REGIONS
    : [initialRegion, ...STANDARD_REGIONS].filter((r) => r.length > 0);

  const handleSave = () => {
    onSave(productCode, identifier, region);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Save Header</DialogTitle>
          <DialogDescription>
            Change the product code, identifier and region for this save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="productCode">Product code</Label>
            <Input
              id="productCode"
              value={productCode}
              maxLength={10}
              placeholder="e.g. SLUS-20000"
              onChange={(e) => setProductCode(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="identifier">Identifier</Label>
            <Input
              id="identifier"
              value={identifier}
              maxLength={8}
              placeholder="e.g. SLPM-85xxx"
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="region">Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {regionOptions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
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
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditHeaderDialog;
