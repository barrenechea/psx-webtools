import { ScrollArea } from "@/components/ui/scroll-area";
import { SlotTypes } from "@/lib/ps1-memory-card";

import { Ps1Slot, type Ps1SlotAction } from "./ps1-slot";
import type { Ps1SlotRow } from "./ps1-slot-rows";
import { SaveListMenu } from "./save-list-menu";

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
}) => (
  <ScrollArea className="grow overflow-hidden bg-card/60">
    <SaveListMenu
      rowSelector="[data-slot-index]"
      parseRow={(el) => {
        const index = Number(el.getAttribute("data-slot-index"));
        return Number.isInteger(index) ? index : null;
      }}
      itemsFor={(index) => {
        const save = slots[index]?.save;
        const isFormatted = save?.slotType === SlotTypes.Formatted;
        const isCorrupted = save?.slotType === SlotTypes.Corrupted;
        const canEdit = !!save && !isFormatted && !isCorrupted;
        return [
          {
            label: "Edit header",
            disabled: !canEdit,
            onClick: () => onSlotAction("editHeader", index),
          },
          {
            label: "Edit comment",
            disabled: !canEdit,
            onClick: () => onSlotAction("editComment", index),
          },
          {
            label: "Compare with temp buffer",
            disabled: !canEdit || !hasTempBuffer,
            onClick: () => onSlotAction("compare", index),
          },
          {
            label: "Erase slot data",
            destructive: true,
            separatorBefore: true,
            onClick: () => onSlotAction("remove", index),
          },
        ];
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
    </SaveListMenu>
  </ScrollArea>
);
