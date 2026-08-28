import { useRef, useState } from "react";

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
import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import { type ParsedMgSection, parsePs3mcaIni } from "@/lib/ps2/ps2-mgkeyset";

interface Ps2MgKeyDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The currently stored keyset's section name (display only). */
  storedSection: string | null;
  onSelect: (section: string, keyset: Ps2MgKeyset) => void;
  onClear: () => void;
}

// Prompts for a ps3mca.ini key file and lets the user pick which keyset to use.
// Shows only section names and keychange_param — never the key bytes.
export const Ps2MgKeyDialog: React.FC<Ps2MgKeyDialogProps> = ({
  isOpen,
  onOpenChange,
  storedSection,
  onSelect,
  onClear,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sections, setSections] = useState<ParsedMgSection[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset the parsed file on every close path (Cancel/X/Escape, Use, or
  // Clear) so a re-open never shows a previous file's sections.
  const resetState = () => {
    setFileName(null);
    setSections(null);
    setSelected(null);
    setError(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  // Wipe the stored keyset but keep the loaded file in view so the user can
  // pick a section (or load another file) without leaving the dialog.
  const handleClear = () => {
    setError(null);
    onClear();
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetState();
    try {
      const text = await file.text();
      const parsed = parsePs3mcaIni(text);
      setFileName(file.name);
      if (parsed.length === 0) {
        setSections([]);
        setError(
          "No usable keyset in this file. Each section needs keychange_param (0–3) plus the five handshake rows.",
        );
        return;
      }
      setSections(parsed);
      setSelected(parsed.length === 1 ? 0 : null);
    } catch {
      setError("Could not read the key file.");
    }
  };

  const handleUse = () => {
    if (selected === null || !sections) return;
    const s = sections[selected];
    if (!s) return;
    resetState();
    onSelect(s.section, s.keyset);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PS2 MagicGate key set</DialogTitle>
          <DialogDescription>
            This official PS2 card needs MagicGate authentication. Load a
            ps3mca.ini key file and pick the keyset that matches the card. Keys
            are kept only in this browser's local storage.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Key file</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => fileRef.current?.click()}
              >
                Load ps3mca.ini
              </Button>
              {fileName && (
                <span className="text-muted-foreground text-sm">
                  {fileName}
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".ini,text/plain"
              className="sr-only"
              onChange={(e) => void handleFileChange(e)}
            />
          </div>

          {sections !== null && sections.length > 0 && (
            <div className="grid gap-2">
              <Label>Keyset</Label>
              <div className="grid gap-2">
                {sections.map((s, i) => (
                  <Button
                    key={`${s.section}-${i}`}
                    variant={selected === i ? "default" : "outline"}
                    className="w-full justify-between font-normal"
                    onClick={() => setSelected(i)}
                  >
                    <span>{s.section}</span>
                    <span className="text-muted-foreground text-xs">
                      keychange_param {s.keyset.keychangeParam}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {storedSection !== null && (
            <p className="text-muted-foreground text-sm">
              Currently stored: {storedSection}
            </p>
          )}
          {error !== null && (
            <p className="text-destructive text-sm">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handleClear}>
            Clear stored keys
          </Button>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUse} disabled={selected === null}>
            Use keyset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
