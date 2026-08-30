import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import { fetchStandardMgKeysets } from "@/lib/ps2/ps2-mg-web";
import { type ParsedMgSection, parsePs3mcaIni } from "@/lib/ps2/ps2-mgkeyset";

interface Ps2MgKeyDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The currently stored keyset's section name (display only). */
  storedSection: string | null;
  onSelect: (section: string, keyset: Ps2MgKeyset) => void;
}

// Lets the user pick a MagicGate key set, fetched from the pinned IPFS file or
// loaded from a ps3mca.ini. Shows only section names — never the key bytes.
export const Ps2MgKeyDialog: React.FC<Ps2MgKeyDialogProps> = ({
  isOpen,
  onOpenChange,
  storedSection,
  onSelect,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<ParsedMgSection[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the loaded key sets on every close path so a re-open never shows a
  // previous fetch or file.
  const resetState = () => {
    setSections(null);
    setFetching(false);
    setError(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  // Load key sets for the pick list. A lone key set is used immediately, so the
  // user is never asked to pick the only option on offer (any source).
  const applySections = (next: ParsedMgSection[]) => {
    if (next.length === 1) {
      const s = next[0];
      resetState();
      onSelect(s.section, s.keyset);
      return;
    }
    setSections(next);
  };

  const handleFetch = async () => {
    setError(null);
    setFetching(true);
    let next: ParsedMgSection[] | null = null;
    let message: string | null = null;
    try {
      next = await fetchStandardMgKeysets();
    } catch (err) {
      message = (err as Error).message || "Could not fetch the key sets.";
    }
    setFetching(false);
    if (next !== null) {
      applySections(next);
    } else {
      setError(message);
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    resetState();
    try {
      const parsed = parsePs3mcaIni(await file.text());
      if (parsed.length === 0) {
        setSections([]);
        setError(
          "No usable key set in this file. Each section needs keychange_param (0–3) plus the five handshake rows.",
        );
        return;
      }
      applySections(parsed);
    } catch {
      setError("Could not read the key file.");
    }
  };

  const hasKeysets = sections !== null && sections.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PS2 MagicGate key set</DialogTitle>
          <DialogDescription>
            This PS2 card needs MagicGate authentication. Fetch the key sets or
            load a ps3mca.ini file, then pick the one that matches the card.
            Keys are kept only in this browser's local storage.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            {hasKeysets ? (
              <div className="grid gap-2">
                <Label>Key set</Label>
                {sections.map((s, i) => (
                  <Button
                    key={`${s.section}-${i}`}
                    variant="outline"
                    className="w-full font-normal"
                    onClick={() => {
                      resetState();
                      onSelect(s.section, s.keyset);
                    }}
                  >
                    <span className="capitalize">{s.section}</span>
                  </Button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => void handleFetch()}
                  disabled={fetching}
                >
                  {fetching ? "Fetching…" : "Fetch keys from IPFS"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  Load ps3mca.ini
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".ini,text/plain"
                  className="sr-only"
                  onChange={(e) => void handleFileChange(e)}
                />
              </div>
            )}
          </div>

          {storedSection !== null && (
            <p className="text-muted-foreground text-sm">
              Currently stored: {storedSection}
            </p>
          )}
          {error !== null && (
            <p className="text-destructive text-sm">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
