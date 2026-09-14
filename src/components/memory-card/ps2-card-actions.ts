import { type FamilyToolbarCaps } from "@/components/memory-card/types";
import {
  type CardCommit,
  type TempBuffer,
} from "@/hooks/use-memory-card-workspace";
import { PS2MemoryCard, type Ps2SaveSnapshot } from "@/lib/ps2/ps2-card";
import {
  detectPs2Container,
  Ps2ContainerFormat,
  readPs2Container,
} from "@/lib/ps2/ps2-single-save";
import { sameDirentName } from "@/lib/ps2/ps2-sjis";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";

function copyPs2Save(
  card: PS2MemoryCard,
  name: string,
): Extract<TempBuffer, { kind: "ps2" }> | null {
  const info = card.getSaves().find((s) => s.name === name) ?? null;
  const snapshot = card.snapshotSave(name);
  if (info === null || snapshot === null) return null;
  return { kind: "ps2", info, snapshot };
}

/** Compare bytes from a PS2 temp-buffer snapshot: named file, else largest non-icon.sys. */
export function ps2SnapshotCompareBytes(
  snapshot: Ps2SaveSnapshot,
): Uint8Array | null {
  const named = snapshot.files.find((f) =>
    sameDirentName(f.name, snapshot.name),
  );
  if (named) return named.data;
  let best: Uint8Array | null = null;
  let bestSize = -1;
  for (const f of snapshot.files) {
    if (f.name.toLowerCase() === "icon.sys") continue;
    if (f.data.length > bestSize) {
      bestSize = f.data.length;
      best = f.data;
    }
  }
  return best;
}

function ps2SaveIsDeletable(save: Ps2SaveInfo | undefined): boolean {
  return save !== undefined && !save.corrupted;
}

function ps2SaveIsRestore(save: Ps2SaveInfo | undefined): boolean {
  return save?.deleted === true;
}

interface Ps2CardActionsArgs {
  card: PS2MemoryCard;
  saves: Ps2SaveInfo[];
  cardId: number;
  selectedSave: string | null;
  tempBuffer: TempBuffer;
  commit: CardCommit;
  setPendingReplace: (open: boolean) => void;
  setSelectedSave: (name: string | null) => void;
  setTempBuffer: (buffer: TempBuffer) => void;
  setError: (message: string | null) => void;
}

export function ps2CardActions({
  card,
  saves,
  cardId,
  selectedSave,
  tempBuffer,
  commit,
  setPendingReplace,
  setSelectedSave,
  setTempBuffer,
  setError,
}: Ps2CardActionsArgs) {
  const selectedInfo =
    selectedSave !== null
      ? saves.find((s) => s.name === selectedSave)
      : undefined;
  const isDeletable = ps2SaveIsDeletable(selectedInfo);
  const isRestore = ps2SaveIsRestore(selectedInfo);
  const hasCopied = tempBuffer?.kind === "ps2";

  const caps: FamilyToolbarCaps = {
    canCopy: selectedSave !== null,
    canMove: selectedSave !== null && !isRestore && isDeletable,
    canPaste: hasCopied,
    canDelete: selectedSave !== null && isDeletable,
    canExport: selectedSave !== null,
    canImport: true,
    canSave: true,
    deleteLabel: isRestore ? "Restore save" : "Delete save",
  };

  const copy = () => {
    if (selectedSave === null) return;
    const copied = copyPs2Save(card, selectedSave);
    if (copied === null) {
      setError("Failed to copy save");
      return;
    }
    setTempBuffer(copied);
  };

  const move = () => {
    if (selectedSave === null) return;
    const copied = copyPs2Save(card, selectedSave);
    if (copied === null) {
      setError("Failed to copy save");
      return;
    }
    const name = selectedSave;
    const ok = commit(cardId, "Save moved", () => card.deleteSave(name));
    if (!ok) {
      setError("Failed to move save");
      return;
    }
    setSelectedSave(null);
    setTempBuffer(copied);
  };

  const paste = () => {
    if (tempBuffer?.kind !== "ps2") return;
    const name = tempBuffer.snapshot.name;
    if (saves.some((s) => s.name === name)) {
      setPendingReplace(true);
      return;
    }
    const ok = commit(cardId, "Save pasted", () =>
      card.insertSave(tempBuffer.snapshot),
    );
    if (ok) setSelectedSave(name);
    else setError("Not enough free space to paste save");
  };

  const confirmReplace = () => {
    setPendingReplace(false);
    if (tempBuffer?.kind !== "ps2") return;
    const name = tempBuffer.snapshot.name;
    const ok = commit(cardId, [`Removed ${name}`, `Pasted ${name}`], () =>
      card.replaceSave(tempBuffer.snapshot),
    );
    if (ok) setSelectedSave(name);
    else setError("Not enough free space to replace save");
  };

  const deleteSave = () => {
    if (selectedSave === null) return;
    const save = saves.find((s) => s.name === selectedSave);
    if (save === undefined || save.corrupted) return;
    const ok = commit(
      cardId,
      save.deleted ? "Save restored" : "Save deleted",
      () => card.toggleDeleteSave(selectedSave),
    );
    if (!ok) {
      setError(
        save.deleted ? "Failed to restore save" : "Failed to delete save",
      );
    }
  };

  const eraseSave = (name: string) => {
    const ok = commit(cardId, "Save removed", () => card.eraseSave(name));
    if (ok) {
      if (selectedSave === name) setSelectedSave(null);
      return;
    }
    setError("Failed to erase save");
  };

  const importFile = async (
    file: File,
    name: string,
    title: string,
  ): Promise<boolean> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const format = detectPs2Container(bytes, file.name);
    let ok = false;
    if (format === Ps2ContainerFormat.Unknown) {
      ok = commit(cardId, "Save imported", () =>
        card.importSingleSave(name, bytes, {
          title: title.length > 0 ? title : undefined,
        }),
      );
    } else {
      const container = await readPs2Container(bytes, file.name).catch(
        () => null,
      );
      if (container !== null) {
        const files = container.files;
        const containerTitle = container.title;
        ok = commit(cardId, "Save imported", () =>
          card.importContainer(name, files, {
            title: title.length > 0 ? title : containerTitle || undefined,
          }),
        );
      }
    }
    if (ok) setSelectedSave(name);
    else setError("Failed to import save");
    return ok;
  };

  return {
    caps,
    copy,
    move,
    paste,
    deleteSave,
    eraseSave,
    confirmReplace,
    importFile,
  };
}
