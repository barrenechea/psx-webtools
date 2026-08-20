import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PS1BlockIcon from "@/components/ui/ps1-icon";
import { Separator } from "@/components/ui/separator";
import type {
  IconPalette,
  SaveInfo,
  SlotIconData,
} from "@/lib/ps1-memory-card";

interface SaveInfoDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  save: SaveInfo;
  linkedSlots: number[];
  iconData: SlotIconData;
  iconPalette: IconPalette;
}

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
      {label}
    </p>
    <p className="text-sm break-all">{value}</p>
  </div>
);

export const SaveInfoDialog: React.FC<SaveInfoDialogProps> = ({
  isOpen,
  onOpenChange,
  save,
  linkedSlots,
  iconData,
  iconPalette,
}) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Save Information</DialogTitle>
        <DialogDescription>Details for the selected save.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="flex items-center gap-4">
          <div className="bg-muted flex size-16 shrink-0 items-center justify-center rounded-md">
            <PS1BlockIcon
              iconData={iconData}
              iconPalette={iconPalette}
              iconFrameCount={save.iconFrameCount}
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {save.name || "Unknown"}
            </p>
            <p className="text-muted-foreground text-xs">
              {save.iconFrameCount} icon frame
              {save.iconFrameCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <Separator />
        <div className="grid gap-3">
          <Row label="Product code" value={save.productCode || "—"} />
          <Row label="Identifier" value={save.identifier || "—"} />
          <Row label="Region" value={save.region || "—"} />
          <Row label="File type" value="Save data" />
          <Row label="Size" value={`${save.blockCount} KB`} />
          <Row
            label="Slot(s)"
            value={linkedSlots.map((s) => s + 1).join(", ")}
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default SaveInfoDialog;
