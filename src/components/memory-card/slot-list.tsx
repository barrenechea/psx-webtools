import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type PS1MemoryCard from "@/lib/ps1-memory-card";
import { DataTypes, SlotTypes } from "@/lib/ps1-memory-card";

import { MemoryCardSlot, type SlotAction } from "./memory-card-slot";

interface SlotListProps {
  card: PS1MemoryCard;
  selectedSlot: number | null;
  onSlotClick: (index: number) => void;
  onSlotAction: (action: SlotAction, index: number) => void;
}

export const SlotList: React.FC<SlotListProps> = ({
  card,
  selectedSlot,
  onSlotClick,
  onSlotAction,
}) => {
  // A single shared context menu for the whole list instead of one per slot,
  // so switching cards doesn't mount/dispose a radix context menu per row.
  const [contextSlot, setContextSlot] = useState<number | null>(null);
  const saves = card.getSaves();
  const contextSave = contextSlot !== null ? saves[contextSlot] : undefined;
  const isFormatted = contextSave?.slotType === SlotTypes.Formatted;
  const isCorrupted = contextSave?.slotType === SlotTypes.Corrupted;
  const canEdit = !!contextSave && !isFormatted && !isCorrupted;

  return (
    <ScrollArea className="grow overflow-hidden" type="always">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="bg-card/60 p-4"
            onContextMenu={(event) => {
              const el = (event.target as HTMLElement).closest(
                "[data-slot-index]",
              );
              setContextSlot(
                el ? Number(el.getAttribute("data-slot-index")) : null,
              );
            }}
          >
            {saves.map((save, index) => {
              const parentSlot = card.getMasterLinkForSlot(index);
              const linkedSlots = card.getSaveLinks(parentSlot);
              const isSelected = linkedSlots.includes(selectedSlot ?? -1);
              const isSoftware =
                card.getSaveDataType(index) === DataTypes.Software;
              return (
                <MemoryCardSlot
                  key={index}
                  slot={save}
                  index={index}
                  isSelected={isSelected}
                  onClick={onSlotClick}
                  iconData={card.getIconData(index)}
                  iconPalette={card.getIconPalette(index)}
                  isSoftware={isSoftware}
                />
              );
            })}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {contextSlot !== null && (
            <>
              <ContextMenuItem
                disabled={!canEdit}
                onSelect={() => onSlotAction("editHeader", contextSlot)}
              >
                Edit header
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canEdit}
                onSelect={() => onSlotAction("editComment", contextSlot)}
              >
                Edit comment
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canEdit}
                onSelect={() => onSlotAction("info", contextSlot)}
              >
                Information
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onSlotAction("remove", contextSlot)}
              >
                Erase slot data
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </ScrollArea>
  );
};
