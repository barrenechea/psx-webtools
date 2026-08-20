import PS1MemoryCard, { SlotTypes } from "@/lib/ps1-memory-card";

/**
 * Finds all slots that are part of the same (linked) save, following the
 * forward pointer chain from startIndex (the master slot).
 */
export const findLinkedSlots = (
  card: PS1MemoryCard,
  startIndex: number,
): number[] => card.getSaveLinks(startIndex);

/**
 * Finds the master (first) slot of the linked save that slotIndex belongs to.
 */
export const findParentSlot = (
  card: PS1MemoryCard,
  slotIndex: number,
): number => {
  const saves = card.getSaves();
  const slotType = saves[slotIndex].slotType;

  // Only middle/end link slots belong to another save; every other slot is its
  // own master.
  const isLink =
    slotType === SlotTypes.MiddleLink ||
    slotType === SlotTypes.EndLink ||
    slotType === SlotTypes.DeletedMiddleLink ||
    slotType === SlotTypes.DeletedEndLink;
  if (!isLink) return slotIndex;

  // A link slot resolves to the initial slot whose pointer chain contains it.
  // This mirrors the reference's masterSlot map and correctly handles
  // non-contiguous slot chains (a save whose blocks are not in adjacent slots).
  for (let i = 0; i < saves.length; i++) {
    const type = saves[i].slotType;
    if (type !== SlotTypes.Initial && type !== SlotTypes.DeletedInitial)
      continue;
    if (card.getSaveLinks(i).includes(slotIndex)) return i;
  }

  // Orphaned link with no reachable master: keep it standalone so an action
  // never targets an unrelated save.
  return slotIndex;
};
