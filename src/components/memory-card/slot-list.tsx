import { ScrollArea } from "@/components/ui/scroll-area";
import { findLinkedSlots, findParentSlot } from "@/lib/memory-card-slots";
import type PS1MemoryCard from "@/lib/ps1-memory-card";

import { MemoryCardSlot } from "./memory-card-slot";

interface SlotListProps {
  card: PS1MemoryCard;
  selectedSlot: number | null;
  onSlotClick: (index: number) => void;
}

export const SlotList: React.FC<SlotListProps> = ({
  card,
  selectedSlot,
  onSlotClick,
}) => (
  <ScrollArea className="grow overflow-hidden" type="always">
    <div className="bg-card/60 p-4">
      {card.getSaves().map((save, index) => {
        const parentSlot = findParentSlot(card, index);
        const linkedSlots = findLinkedSlots(card, parentSlot);
        const isSelected = linkedSlots.includes(selectedSlot ?? -1);
        return (
          <MemoryCardSlot
            key={index}
            slot={save}
            index={index}
            isSelected={isSelected}
            onClick={onSlotClick}
            iconData={card.getIconData(index)}
            iconPalette={card.getIconPalette(index)}
          />
        );
      })}
    </div>
  </ScrollArea>
);
