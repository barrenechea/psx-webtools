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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useSaveFileForm, {
  type SaveFormatOption,
} from "@/hooks/use-save-file-form";

interface SaveDialogProps<T extends number> {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFileName: string;
  formats: readonly SaveFormatOption<T>[];
  defaultFormat: T;
  onSave: (fileName: string, saveType: T, ecc?: boolean) => Promise<void>;
  /** When set, show an ECC-spares checkbox initialized to `default`. */
  ecc?: { default: boolean };
}

export const SaveDialog = <T extends number>({
  isOpen,
  onOpenChange,
  defaultFileName,
  formats,
  defaultFormat,
  onSave,
  ecc,
}: SaveDialogProps<T>) => {
  const {
    fileName,
    setFileName,
    saveType,
    setFormat,
    subExtension,
    setExtension,
    currentExtensions,
    hasExtensionPicker,
  } = useSaveFileForm<T>({
    defaultFileName,
    defaultFormat,
    extensionsFor: (format) =>
      formats.find((option) => option.value === format)?.extensions ?? [],
  });
  const [eccValue, setEccValue] = useState(ecc?.default ?? false);

  const handleSave = () => {
    void onSave(fileName, saveType, ecc !== undefined ? eccValue : undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save Game Data</DialogTitle>
          <DialogDescription>
            Choose a file name and format for your save data.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
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
              onValueChange={(value) => setFormat(parseInt(value) as T)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                {formats.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value.toString()}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasExtensionPicker && (
            <div className="grid gap-2">
              <Label htmlFor="rawExtension">File extension</Label>
              <Select value={subExtension} onValueChange={setExtension}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select extension" />
                </SelectTrigger>
                <SelectContent>
                  {currentExtensions.map((ext) => (
                    <SelectItem key={ext} value={ext}>
                      {ext}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {ecc !== undefined && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="ecc"
                checked={eccValue}
                onCheckedChange={(checked) => setEccValue(checked === true)}
              />
              <Label htmlFor="ecc" className="font-normal">
                Include ECC spares (528-byte pages)
              </Label>
            </div>
          )}
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
