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
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";

interface Ps2ImportSaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  takenNames: string[];
  onImport: (name: string, title: string) => Promise<boolean>;
}

export const Ps2ImportSaveDialog: React.FC<Ps2ImportSaveDialogProps> = ({
  isOpen,
  onOpenChange,
  defaultName,
  takenNames,
  onImport,
}) => {
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nameError =
    name.length === 0
      ? "Save name is required"
      : !PS2MemoryCard.isValidName(name)
        ? "Use letters, numbers and dashes only (A–Z, 0–9, -), max 32 chars"
        : takenNames.includes(name)
          ? "A save with this name already exists on the card"
          : null;

  const handleImport = async () => {
    if (nameError !== null) return;
    const ok = await onImport(name, title);
    if (ok) {
      onOpenChange(false);
    } else {
      setError("Import failed (card full or invalid save)");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import PS2 Save</DialogTitle>
          <DialogDescription>
            Create a new save directory from the selected file. The file becomes
            the save's data file.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="ps2ImportName">Save name</Label>
            <Input
              id="ps2ImportName"
              value={name}
              maxLength={32}
              placeholder="BASLUS-12345XXXX0001"
              onChange={(e) => {
                setName(e.target.value.toUpperCase());
                setError(null);
              }}
            />
            {nameError !== null && (
              <p className="text-destructive text-sm">{nameError}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ps2ImportTitle">Title (optional)</Label>
            <Input
              id="ps2ImportTitle"
              value={title}
              maxLength={34}
              placeholder={name.length > 0 ? name : "Defaults to the save name"}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
            />
          </div>
          {error !== null && (
            <p className="text-destructive text-sm">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleImport()}
            disabled={nameError !== null}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
