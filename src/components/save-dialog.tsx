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
import useSaveFileForm from "@/hooks/use-save-file-form";
import {
  CardExtensions,
  CardTypes,
  RAW_EXTENSIONS,
} from "@/lib/ps1-memory-card";

interface SaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFileName: string;
  defaultFormat: CardTypes;
  onSave: (fileName: string, saveType: CardTypes) => Promise<void>;
}

const cardExtensionsFor = (format: CardTypes): readonly string[] =>
  format === CardTypes.Raw ? RAW_EXTENSIONS : [CardExtensions[format]];

export const SaveDialog: React.FC<SaveDialogProps> = ({
  isOpen,
  onOpenChange,
  defaultFileName,
  defaultFormat,
  onSave,
}) => {
  const {
    fileName,
    setFileName,
    saveType,
    setFormat,
    subExtension,
    setExtension,
    currentExtensions,
    hasExtensionPicker,
  } = useSaveFileForm<CardTypes>({
    defaultFileName,
    defaultFormat,
    extensionsFor: cardExtensionsFor,
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
              onValueChange={(value) => setFormat(parseInt(value) as CardTypes)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CardTypes.Raw.toString()}>
                  Raw Memory Card
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
