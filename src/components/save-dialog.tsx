import { useEffect, useState } from "react";

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
import { CardTypes } from "@/lib/ps1-memory-card";

interface SaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFileName: string;
  onSave: (fileName: string, saveType: CardTypes) => Promise<void>;
}

export const SaveDialog: React.FC<SaveDialogProps> = ({
  isOpen,
  onOpenChange,
  defaultFileName,
  onSave,
}) => {
  const [fileName, setFileName] = useState(defaultFileName);
  const [saveType, setSaveType] = useState<CardTypes>(CardTypes.Raw);

  const handleSave = () => {
    void onSave(fileName, saveType);
    onOpenChange(false);
  };

  useEffect(() => {
    setFileName(defaultFileName);
  }, [defaultFileName]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Game Data</DialogTitle>
          <DialogDescription>
            Choose a file name and format for your save data.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="fileName">File name</Label>
            <Input
              id="fileName"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="format">Save format</Label>
            <Select
              value={saveType.toString()}
              onValueChange={(value) => setSaveType(parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CardTypes.Raw.toString()}>
                  Raw Format (.bin)
                </SelectItem>
                <SelectItem value={CardTypes.Mcx.toString()}>
                  MCX Format (.mcx)
                </SelectItem>
                <SelectItem value={CardTypes.Vmp.toString()}>
                  VMP Format (.vmp)
                </SelectItem>
                <SelectItem value={CardTypes.Vgs.toString()}>
                  VGS Format (.vgs)
                </SelectItem>
                <SelectItem value={CardTypes.Gme.toString()}>
                  GME Format (.gme)
                </SelectItem>
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

export default SaveDialog;
