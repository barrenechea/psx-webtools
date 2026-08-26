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
import useSaveFileForm, {
  type SaveFormatOption,
} from "@/hooks/use-save-file-form";

interface SaveDialogProps<T extends number> {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFileName: string;
  formats: readonly SaveFormatOption<T>[];
  defaultFormat: T;
  onSave: (fileName: string, saveType: T) => Promise<void>;
}

export const SaveDialog = <T extends number>({
  isOpen,
  onOpenChange,
  defaultFileName,
  formats,
  defaultFormat,
  onSave,
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

  const handleSave = () => {
    void onSave(fileName, saveType);
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
