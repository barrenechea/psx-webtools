import {
  derivePs1SlotRows,
  type Ps1SlotRow,
} from "@/components/memory-card/ps1-slot-rows";
import PS1MemoryCard, {
  type CardTypes,
  type SaveInfo,
} from "@/lib/ps1-memory-card";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";

type CardViewBase = {
  changed: boolean;
  undoCount: number;
  redoCount: number;
  checksum: string;
  status: string;
};

export type Ps1CardView = CardViewBase & {
  kind: "ps1";
  saves: SaveInfo[];
  slots: Ps1SlotRow[];
  cardType: CardTypes;
};

export type Ps2CardView = CardViewBase & {
  kind: "ps2";
  saves: Ps2SaveInfo[];
  badBlocks: number[];
  ecc: boolean;
};

export type MemoryCardView = Ps1CardView | Ps2CardView;

export function snapshotMemoryCard(card: PS1MemoryCard): Ps1CardView;
export function snapshotMemoryCard(card: PS2MemoryCard): Ps2CardView;
export function snapshotMemoryCard(
  card: PS1MemoryCard | PS2MemoryCard,
): MemoryCardView {
  const changed = card.changed;
  const undoCount = card.undoCount;
  const redoCount = card.redoCount;
  const checksum = card.getRawChecksum();
  if (card.kind === "ps2") {
    const saves = card.getSaves();
    const n = saves.length;
    return {
      kind: "ps2",
      changed,
      undoCount,
      redoCount,
      checksum,
      status: `${n} ${n === 1 ? "save" : "saves"}`,
      saves: saves.slice(),
      badBlocks: card.getOccupiedBadBlocks().slice(),
      ecc: card.getLoadedEcc(),
    };
  }
  return {
    kind: "ps1",
    changed,
    undoCount,
    redoCount,
    checksum,
    status: "15 slots",
    saves: card.getSaves().slice(), // PS1 returns the live buffer; copy so view identity changes
    slots: derivePs1SlotRows(card),
    cardType: card.getCardType(),
  };
}
