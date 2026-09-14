import { type FamilyToolbarCaps } from "@/components/memory-card/types";
import {
  type CardCommit,
  type CardCommitAsync,
  type TempBuffer,
} from "@/hooks/use-memory-card-workspace";
import PS1MemoryCard, { SlotTypes } from "@/lib/ps1-memory-card";

function copyPs1Save(
  card: PS1MemoryCard,
  slot: number,
): Extract<TempBuffer, { kind: "ps1" }> {
  const parentSlot = card.getMasterLinkForSlot(slot);
  const linkedSlots = card.getSaveLinks(parentSlot);
  const slots = linkedSlots.map((slotIndex) => card.getSaves()[slotIndex]);
  return {
    kind: "ps1",
    bytes: card.getSaveBytes(parentSlot),
    slots,
    icon: {
      data: card.getIconData(parentSlot),
      palette: card.getIconPalette(parentSlot),
      frameCount: slots[0].iconFrameCount,
    },
  };
}

function formatPs1Save(card: PS1MemoryCard, slot: number): void {
  card.formatSave(card.getMasterLinkForSlot(slot));
}

function slotIsEmpty(card: PS1MemoryCard, slot: number | null): boolean {
  if (slot === null) return false;
  return card.getSaves()[slot].slotType === SlotTypes.Formatted;
}

function slotIsDeletable(card: PS1MemoryCard, slot: number | null): boolean {
  if (slot === null) return false;
  const type = card.getSaves()[slot].slotType;
  return type === SlotTypes.Initial || type === SlotTypes.DeletedInitial;
}

function slotIsRestore(card: PS1MemoryCard, slot: number | null): boolean {
  if (slot === null) return false;
  return card.getSaves()[slot].slotType === SlotTypes.DeletedInitial;
}

interface Ps1CardActionsArgs {
  card: PS1MemoryCard;
  cardId: number;
  selectedSlot: number | null;
  tempBuffer: TempBuffer;
  commit: CardCommit;
  commitAsync: CardCommitAsync;
  setSelectedSlot: (slot: number | null) => void;
  setTempBuffer: (buffer: TempBuffer) => void;
  setError: (message: string | null) => void;
}

export function ps1CardActions({
  card,
  cardId,
  selectedSlot,
  tempBuffer,
  commit,
  commitAsync,
  setSelectedSlot,
  setTempBuffer,
  setError,
}: Ps1CardActionsArgs) {
  const isDeletable = slotIsDeletable(card, selectedSlot);
  const isRestore = slotIsRestore(card, selectedSlot);
  const isEmpty = slotIsEmpty(card, selectedSlot);
  const hasCopied = tempBuffer?.kind === "ps1";

  const caps: FamilyToolbarCaps = {
    canCopy: selectedSlot !== null && isDeletable,
    canMove: selectedSlot !== null && isDeletable,
    canPaste: selectedSlot !== null && hasCopied && isEmpty,
    canDelete: selectedSlot !== null && isDeletable,
    canExport: selectedSlot !== null && isDeletable,
    canImport: selectedSlot !== null && isEmpty,
    canSave: true,
    deleteLabel: isRestore ? "Restore save" : "Delete save",
  };

  const copy = () => {
    if (selectedSlot === null) return;
    setTempBuffer(copyPs1Save(card, selectedSlot));
  };

  const move = () => {
    if (selectedSlot === null) return;
    setTempBuffer(copyPs1Save(card, selectedSlot));
    commit(cardId, "Save moved", () => {
      formatPs1Save(card, selectedSlot);
    });
    setSelectedSlot(null);
  };

  const paste = () => {
    if (selectedSlot === null || tempBuffer?.kind !== "ps1") {
      return;
    }
    const ok = commit(cardId, "Save pasted", () =>
      card.setSaveBytes(selectedSlot, tempBuffer.bytes),
    );
    if (!ok) setError("Not enough free space to paste save");
  };

  const deleteSave = () => {
    if (selectedSlot === null) return;
    const restore = slotIsRestore(card, selectedSlot);
    commit(cardId, restore ? "Save restored" : "Save deleted", () => {
      card.toggleDeleteSave(selectedSlot);
    });
  };

  const eraseSave = (slot: number) => {
    commit(cardId, "Save removed", () => {
      formatPs1Save(card, slot);
    });
    setSelectedSlot(null);
  };

  const importFile = async (file: File, slot: number): Promise<boolean> => {
    return commitAsync(cardId, "Save imported", () =>
      card.openSingleSave(file, slot),
    );
  };

  return {
    caps,
    copy,
    move,
    paste,
    deleteSave,
    eraseSave,
    importFile,
  };
}
