import { useRef, useState } from "react";

import PS1MemoryCard, {
  type IconPalette,
  type SaveInfo,
  type SlotIconData,
} from "@/lib/ps1-memory-card";
import { PS2MemoryCard, type Ps2SaveSnapshot } from "@/lib/ps2/ps2-card";
import { isPs2ConquestCard } from "@/lib/ps2/ps2-conquest";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";

export interface MemoryCard {
  id: number;
  name: string;
  type: "file" | "device" | "new";
  source: string;
  card: PS1MemoryCard | PS2MemoryCard;
}

export const isPs2Card = (card: MemoryCard["card"]): card is PS2MemoryCard =>
  card.kind === "ps2";

export type CardCommit = (
  cardId: number,
  label: string | readonly string[],
  mutate: () => boolean | void,
) => boolean;

export type CardCommitAsync = (
  cardId: number,
  label: string | readonly string[],
  mutate: () => Promise<boolean | void>,
) => Promise<boolean>;

type Ps1CopiedIcon = {
  data: SlotIconData;
  palette: IconPalette;
  frameCount: number;
};

export type TempBuffer =
  | { kind: "ps1"; bytes: Uint8Array; slots: SaveInfo[]; icon: Ps1CopiedIcon }
  | { kind: "ps2"; info: Ps2SaveInfo; snapshot: Ps2SaveSnapshot }
  | null;

function cardStatus(entry: MemoryCard | undefined): string {
  if (entry === undefined) return "No memory card selected";
  if (isPs2Card(entry.card)) {
    const n = entry.card.getSaves().length;
    return `${n} ${n === 1 ? "save" : "saves"}`;
  }
  return "15 slots";
}

let lastCardId = 0;
const nextCardId = (): number => ++lastCardId;

function asLabels(label: string | readonly string[]): readonly string[] {
  return typeof label === "string" ? [label] : label;
}

export function useMemoryCardWorkspace() {
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [tempBuffer, setTempBuffer] = useState<TempBuffer>(null);
  const [historyLabels, setHistoryLabels] = useState<Record<number, string[]>>(
    {},
  );
  const cardsRef = useRef<MemoryCard[]>([]);
  const selectedCardRef = useRef<number | null>(null);

  const replaceCards = (next: MemoryCard[]) => {
    cardsRef.current = next;
    setMemoryCards(next);
  };

  const selectCard = (id: number | null) => {
    selectedCardRef.current = id;
    setSelectedCard(id);
  };

  const cardById = (id: number | null) =>
    id === null ? undefined : cardsRef.current.find((c) => c.id === id)?.card;

  const appendHistoryLabel = (
    cardId: number,
    rowBefore: number,
    label: string,
  ) => {
    setHistoryLabels((prev) => {
      const name =
        cardsRef.current.find((c) => c.id === cardId)?.name ?? "Card";
      const current = prev[cardId] ?? [name];
      return { ...prev, [cardId]: [...current.slice(0, rowBefore + 1), label] };
    });
  };

  const bump = () => {
    replaceCards([...cardsRef.current]);
  };

  const recordCommit = (
    cardId: number,
    rowBefore: number,
    label: string | readonly string[],
  ) => {
    asLabels(label).forEach((text, i) => {
      appendHistoryLabel(cardId, rowBefore + i, text);
    });
    bump();
  };

  const afterMutate = (
    cardId: number,
    label: string | readonly string[],
    rowBefore: number,
    ok: boolean | void,
  ): boolean => {
    if (ok === false) return false;
    recordCommit(cardId, rowBefore, label);
    return true;
  };

  const commit = (
    cardId: number,
    label: string | readonly string[],
    mutate: () => boolean | void,
  ): boolean => {
    const card = cardById(cardId);
    if (!card) return false;
    return afterMutate(cardId, label, card.undoCount, mutate());
  };

  const commitAsync = async (
    cardId: number,
    label: string | readonly string[],
    mutate: () => Promise<boolean | void>,
  ): Promise<boolean> => {
    const card = cardById(cardId);
    if (!card) return false;
    return afterMutate(cardId, label, card.undoCount, await mutate());
  };

  const addCard = (entry: Omit<MemoryCard, "id">): number => {
    const id = nextCardId();
    replaceCards([...cardsRef.current, { ...entry, id }]);
    return id;
  };

  const addCards = (entries: Omit<MemoryCard, "id">[]): number | null => {
    if (entries.length === 0) return null;
    const opened: MemoryCard[] = entries.map((entry) => ({
      ...entry,
      id: nextCardId(),
    }));
    replaceCards([...cardsRef.current, ...opened]);
    return opened[opened.length - 1].id;
  };

  const removeCard = (id: number) => {
    replaceCards(cardsRef.current.filter((c) => c.id !== id));
    setHistoryLabels((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedCardRef.current === id) selectCard(null);
  };

  const jumpToHistory = (index: number) => {
    const card = cardById(selectedCardRef.current);
    if (!card) return;
    const current = card.undoCount;
    if (index < current) {
      for (let i = 0; i < current - index; i++) card.undo();
    } else {
      for (let i = 0; i < index - current; i++) card.redo();
    }
    bump();
  };

  const undo = () => {
    cardById(selectedCardRef.current)?.undo();
    bump();
  };

  const redo = () => {
    cardById(selectedCardRef.current)?.redo();
    bump();
  };

  const openFiles = async (
    files: File[],
    fixCorrupted: boolean,
  ): Promise<string | null> => {
    if (files.length === 0) return null;
    const opened: Omit<MemoryCard, "id">[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ps2 = PS2MemoryCard.tryFromBytes(bytes);
      let card: MemoryCard["card"] | null = null;
      let openError: string | null = null;
      if (ps2) {
        card = ps2;
      } else if (isPs2ConquestCard(bytes)) {
        openError =
          "PS2 Conquest card (SoulCalibur II); it has no PFS filesystem, so it cannot be loaded, formatted, or written.";
      } else {
        const ps1 = new PS1MemoryCard();
        let loadError: unknown = null;
        try {
          await ps1.loadFromFile(file, fixCorrupted);
        } catch (err) {
          loadError = err;
        }
        if (loadError !== null) {
          openError = (loadError as Error).message;
        } else {
          card = ps1;
        }
      }
      if (card) {
        opened.push({
          name: file.name,
          type: "file",
          source: file.name,
          card,
        });
      } else {
        errors.push(
          `${file.name}: ${openError ?? "could not be read as a card."}`,
        );
      }
    }

    if (opened.length > 0) {
      const id = addCards(opened);
      if (id !== null) selectCard(id);
    }
    return errors.length > 0
      ? `Error opening file: ${errors.join("; ")}`
      : null;
  };

  const addNewPs1Card = () => {
    const card = new PS1MemoryCard();
    card.formatCard();
    selectCard(addCard({ name: "New Card", type: "new", source: "", card }));
  };

  const addNewPs2Card = (sizeMb: number) => {
    selectCard(
      addCard({
        name: "New PS2 Card",
        type: "new",
        source: "",
        card: PS2MemoryCard.format(sizeMb * 1024),
      }),
    );
  };

  const selectedEntry =
    selectedCard === null
      ? undefined
      : memoryCards.find((c) => c.id === selectedCard);

  return {
    memoryCards,
    selectedCard,
    tempBuffer,
    historyLabels,
    selectedEntry,
    selectedStatus: cardStatus(selectedEntry),
    selectCard,
    setTempBuffer,
    commit,
    commitAsync,
    bump,
    addCard,
    addNewPs1Card,
    addNewPs2Card,
    removeCard,
    jumpToHistory,
    undo,
    redo,
    openFiles,
  };
}
