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
import { SingleSaveExtensions, SingleSaveTypes } from "@/lib/ps1-memory-card";

interface SaveSingleSaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFileName: string;
  onSave: (fileName: string, saveType: SingleSaveTypes) => Promise<void>;
}

const singleSaveExtensionsFor = (
  format: SingleSaveTypes,
): readonly string[] => [SingleSaveExtensions[format]];

export const SaveSingleSaveDialog: React.FC<SaveSingleSaveDialogProps> = ({
  isOpen,
  onOpenChange,
  defaultFileName,
  onSave,
}) => {
  const { fileName, setFileName, saveType, setFormat } =
    useSaveFileForm<SingleSaveTypes>({
      defaultFileName,
      defaultFormat: SingleSaveTypes.Mcs,
      extensionsFor: singleSaveExtensionsFor,
    });

  const handleSave = () => {
    void onSave(fileName, saveType);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Save</DialogTitle>
          <DialogDescription>
            Choose a file name and format for this single save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="singleSaveFileName">File name</Label>
            <Input
              id="singleSaveFileName"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="singleSaveFormat">Save format</Label>
            <Select
              value={saveType.toString()}
              onValueChange={(value) =>
                setFormat(parseInt(value) as SingleSaveTypes)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SingleSaveTypes.Mcs.toString()}>
                  MCS single save (.mcs)
                </SelectItem>
                <SelectItem value={SingleSaveTypes.Psv.toString()}>
                  PS3 single save (.psv)
                </SelectItem>
                <SelectItem value={SingleSaveTypes.Psx.toString()}>
                  Action Replay (.mcb)
                </SelectItem>
                <SelectItem value={SingleSaveTypes.Raw.toString()}>
                  RAW single save
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SaveSingleSaveDialog;
