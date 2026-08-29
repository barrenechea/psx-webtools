import PS1MemoryCard, {
  DataTypes,
  type IconPalette,
  type SaveInfo,
  type SlotIconData,
} from "@/lib/ps1-memory-card";

// Card-derived display data for one slot, built by derivePs1SlotRows and passed
// to the list so it stays a pure function of its props. The manager rebuilds
// this array every render, so it stays fresh after undo/redo even though the
// card is mutated in place (the React Compiler would otherwise memoize a card
// read on the stable card reference).
export interface Ps1SlotRow {
  index: number;
  save: SaveInfo;
  linkedSlots: number[];
  iconData: SlotIconData;
  iconPalette: IconPalette;
  isSoftware: boolean;
}

export const derivePs1SlotRows = (card: PS1MemoryCard): Ps1SlotRow[] =>
  card.getSaves().map((save, index) => ({
    index,
    save,
    linkedSlots: card.getSaveLinks(card.getMasterLinkForSlot(index)),
    iconData: card.getIconData(index),
    iconPalette: card.getIconPalette(index),
    isSoftware: card.getSaveDataType(index) === DataTypes.Software,
  }));
