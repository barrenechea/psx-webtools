import PS1MemoryCard, { SlotTypes } from "@/lib/ps1-memory-card";

/**
 * Finds all slots that are part of the same (linked) save, following the
 * forward chain from startIndex.
 */
export const findLinkedSlots = (
  card: PS1MemoryCard,
  startIndex: number,
): number[] => {
  const linkedSlots = [startIndex];
  const saves = card.getSaves();
  let currentSlot = startIndex;

  while (true) {
    const nextSlot = saves[currentSlot].slotNumber + 1;
    if (nextSlot >= saves.length) break;

    const nextSave = saves[nextSlot];
    if (
      nextSave.slotType !== SlotTypes.MiddleLink &&
      nextSave.slotType !== SlotTypes.EndLink &&
      nextSave.slotType !== SlotTypes.DeletedMiddleLink &&
      nextSave.slotType !== SlotTypes.DeletedEndLink
    )
      break;

    linkedSlots.push(nextSlot);
    currentSlot = nextSlot;
  }

  return linkedSlots;
};

/**
 * Finds the parent (first) slot of the linked save that slotIndex belongs to.
 */
export const findParentSlot = (
  card: PS1MemoryCard,
  slotIndex: number,
): number => {
  const saves = card.getSaves();
  let currentSlot = slotIndex;

  if (
    saves[currentSlot].slotType === SlotTypes.Initial ||
    saves[currentSlot].slotType === SlotTypes.DeletedInitial ||
    saves[currentSlot].slotType === SlotTypes.Formatted
  )
    return slotIndex;

  while (currentSlot > 0) {
    const prevSave = saves[currentSlot - 1];
    if (
      prevSave.slotType === SlotTypes.Initial ||
      prevSave.slotType === SlotTypes.DeletedInitial
    )
      return currentSlot - 1;
    if (
      prevSave.slotType !== SlotTypes.MiddleLink &&
      prevSave.slotType !== SlotTypes.EndLink &&
      prevSave.slotType !== SlotTypes.DeletedMiddleLink &&
      prevSave.slotType !== SlotTypes.DeletedEndLink
    )
      break;
    currentSlot--;
  }

  return slotIndex;
};
