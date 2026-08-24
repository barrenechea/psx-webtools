import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_TABLE_ROWS = 400;

const off = (i: number): string =>
  `0x${i.toString(16).padStart(4, "0").toUpperCase()} (${i})`;
const val = (b: number): string =>
  `0x${b.toString(16).padStart(2, "0").toUpperCase()} (${b})`;

interface DiffByte {
  offset: number;
  a: number;
  b: number;
}

// Flat list of the differing bytes between two equal-or-unequal-length buffers.
function diffBytes(a: Uint8Array, b: Uint8Array): DiffByte[] {
  const out: DiffByte[] = [];
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) out.push({ offset: i, a: a[i], b: b[i] });
  }
  return out;
}

interface CompareSaveDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  save1Name: string;
  save2Name: string;
  save1Bytes: Uint8Array;
  save2Bytes: Uint8Array;
}

export const CompareSaveDialog: React.FC<CompareSaveDialogProps> = ({
  isOpen,
  onOpenChange,
  save1Name,
  save2Name,
  save1Bytes,
  save2Bytes,
}) => {
  const sizeMismatch = save1Bytes.length !== save2Bytes.length;
  const diffs = sizeMismatch ? [] : diffBytes(save1Bytes, save2Bytes);
  const rows = diffs.slice(0, MAX_TABLE_ROWS);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare saves</DialogTitle>
          <DialogDescription>
            <span className="block">Save 1: {save1Name}</span>
            <span className="block">Save 2: {save2Name} (temp buffer)</span>
          </DialogDescription>
        </DialogHeader>
        {sizeMismatch ? (
          <p className="py-2 text-sm">
            Save file size mismatch. Saves can&apos;t be compared. (
            {save1Bytes.length} vs {save2Bytes.length} bytes)
          </p>
        ) : diffs.length === 0 ? (
          <p className="py-2 text-sm">Compared saves are identical.</p>
        ) : (
          <div className="space-y-2 py-2">
            <p className="text-muted-foreground text-sm">
              {diffs.length} byte{diffs.length === 1 ? "" : "s"} differ.
            </p>
            <div className="max-h-96 overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left">Offset</th>
                    <th className="text-left">Save 1</th>
                    <th className="text-left">Save 2</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.offset}>
                      <td className="pl-2">{off(d.offset)}</td>
                      <td>{val(d.a)}</td>
                      <td>{val(d.b)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {diffs.length > rows.length && (
              <p className="text-muted-foreground text-xs">
                ...and {diffs.length - rows.length} more differing bytes
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CompareSaveDialog;
