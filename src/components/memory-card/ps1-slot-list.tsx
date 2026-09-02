import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SlotTypes } from "@/lib/ps1-memory-card";

import { Ps1Slot, type Ps1SlotAction } from "./ps1-slot";
import type { Ps1SlotRow } from "./ps1-slot-rows";

interface Ps1SlotListProps {
  slots: Ps1SlotRow[];
  selectedSlot: number | null;
  hasTempBuffer: boolean;
  onSlotClick: (index: number) => void;
  onSlotAction: (action: Ps1SlotAction, index: number) => void;
}

export const Ps1SlotList: React.FC<Ps1SlotListProps> = ({
  slots,
  selectedSlot,
  hasTempBuffer,
  onSlotClick,
  onSlotAction,
}) => {
  // A single shared context menu for the whole list instead of one per slot,
  // so switching cards doesn't mount/dispose a context menu per row.
  const [contextSlot, setContextSlot] = useState<number | null>(null);
  const contextSave =
    contextSlot !== null ? slots[contextSlot]?.save : undefined;
  const isFormatted = contextSave?.slotType === SlotTypes.Formatted;
  const isCorrupted = contextSave?.slotType === SlotTypes.Corrupted;
  const canEdit = !!contextSave && !isFormatted && !isCorrupted;

  return (
    <ScrollArea className="bg-card/60 grow overflow-hidden">
      <ContextMenu>
        <ContextMenuTrigger
          render={(props) => (
            <div
              {...props}
              className="min-h-full p-4"
              onContextMenu={(event) => {
                const el = (event.target as HTMLElement).closest(
                  "[data-slot-index]",
                );
                setContextSlot(
                  el ? Number(el.getAttribute("data-slot-index")) : null,
                );
                props.onContextMenu?.(event);
              }}
            >
              {slots.map((row) => (
                <Ps1Slot
                  key={row.index}
                  slot={row.save}
                  index={row.index}
                  isSelected={row.linkedSlots.includes(selectedSlot ?? -1)}
                  onClick={onSlotClick}
                  iconData={row.iconData}
                  iconPalette={row.iconPalette}
                  isSoftware={row.isSoftware}
                />
              ))}
            </div>
          )}
        />
        <ContextMenuContent>
          {contextSlot !== null && (
            <>
              <ContextMenuItem
                disabled={!canEdit}
                onClick={() => onSlotAction("editHeader", contextSlot)}
              >
                Edit header
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canEdit}
                onClick={() => onSlotAction("editComment", contextSlot)}
              >
                Edit comment
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canEdit}
                onClick={() => onSlotAction("info", contextSlot)}
              >
                Information
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canEdit || !hasTempBuffer}
                onClick={() => onSlotAction("compare", contextSlot)}
              >
                Compare with temp buffer
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => onSlotAction("remove", contextSlot)}
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
