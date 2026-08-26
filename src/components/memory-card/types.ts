import type PS1MemoryCard from "@/lib/ps1-memory-card";
import type { PS2MemoryCard } from "@/lib/ps2/ps2-card";

export type MemoryCardKind = "ps1" | "ps2";

export interface MemoryCard {
  id: number;
  name: string;
  type: "file" | "device" | "new";
  source: string;
  card: PS1MemoryCard | PS2MemoryCard;
}

export const isPs2Card = (card: MemoryCard["card"]): card is PS2MemoryCard =>
  card.kind === "ps2";
