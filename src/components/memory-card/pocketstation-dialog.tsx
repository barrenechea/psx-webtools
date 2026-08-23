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
import { Separator } from "@/components/ui/separator";
import {
  calcBiosChecksum,
  formatPocketStationSerial,
  getBiosDate,
  getBiosRemark,
  getBiosVersion,
} from "@/lib/ps1/pocketstation";
import { cn } from "@/lib/utils";

interface PocketStationDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReadSerial: () => Promise<number>;
  onDumpBios: () => Promise<{ bios: Uint8Array; serial: number }>;
  onSetTime: () => Promise<void>;
}

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
      {label}
    </p>
    <p className="text-sm break-all">{value}</p>
  </div>
);

export const PocketStationDialog: React.FC<PocketStationDialogProps> = ({
  isOpen,
  onOpenChange,
  onReadSerial,
  onDumpBios,
  onSetTime,
}) => {
  const [serial, setSerial] = useState<number | null>(null);
  const [bios, setBios] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
    setBusy(false);
  };

  const handleReadSerial = () =>
    void run(async () => {
      setSerial(await onReadSerial());
    });

  const handleDumpBios = () =>
    void run(async () => {
      const { bios: dumped, serial: newSerial } = await onDumpBios();
      setBios(dumped);
      setSerial(newSerial);
    });

  const handleSetTime = () =>
    void run(async () => {
      await onSetTime();
      setMessage({
        kind: "success",
        text: "PocketStation time set from this PC.",
      });
    });

  const handleSaveBios = () => {
    if (!bios) return;
    const blob = new Blob([new Uint8Array(bios)], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "BIOS.bin";
    link.click();
    URL.revokeObjectURL(url);
  };

  const checksum = bios ? calcBiosChecksum(bios) : null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PocketStation</DialogTitle>
          <DialogDescription>
            Read the serial, dump the BIOS, or push the PC clock.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleReadSerial}
              disabled={busy}
            >
              Read serial
            </Button>
            <Button variant="outline" onClick={handleDumpBios} disabled={busy}>
              Dump BIOS
            </Button>
            <Button variant="outline" onClick={handleSetTime} disabled={busy}>
              Set PC time
            </Button>
          </div>
          {serial !== null && (
            <>
              <Separator />
              <Row label="Serial" value={formatPocketStationSerial(serial)} />
            </>
          )}
          {bios && checksum !== null && (
            <>
              <Separator />
              <div className="grid gap-3">
                <Row label="Date" value={getBiosDate(bios)} />
                <Row label="Version" value={getBiosVersion(bios)} />
                <Row
                  label="Checksum"
                  value={checksum.toString(16).toUpperCase().padStart(8, "0")}
                />
                <Row label="Remark" value={getBiosRemark(checksum)} />
              </div>
            </>
          )}
          {message && (
            <p
              className={cn(
                "text-sm",
                message.kind === "error"
                  ? "text-destructive"
                  : "text-green-600",
              )}
            >
              {message.text}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          {bios && (
            <Button variant="outline" onClick={handleSaveBios}>
              Save BIOS.bin
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PocketStationDialog;
