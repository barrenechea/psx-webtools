import PS1MemoryCard, {
  DataTypes,
  type IconPalette,
  type SaveInfo,
  type SlotIconData,
} from "@/lib/ps1-memory-card";

// Card-derived display data for one slot, built when the workspace snapshots
// the card after an in-place edit so compiled panes receive a new `view`.
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
