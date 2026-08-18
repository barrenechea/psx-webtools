import type PS1MemoryCard from "@/lib/ps1-memory-card";

export interface MemoryCard {
  id: number;
  name: string;
  type: "file" | "device";
  source: string;
  card: PS1MemoryCard;
}
