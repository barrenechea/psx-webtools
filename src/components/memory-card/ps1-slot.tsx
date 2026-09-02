import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import PS1BlockIcon from "@/components/ui/ps1-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type IconPalette,
  type SaveInfo,
  type SlotIconData,
  SlotTypes,
} from "@/lib/ps1-memory-card";
import { cn } from "@/lib/utils";

export type Ps1SlotAction =
  "editHeader" | "editComment" | "info" | "remove" | "compare";

interface Ps1SlotProps {
  slot: SaveInfo;
  index: number;
  isSelected: boolean;
  onClick: (index: number) => void;
  iconData: SlotIconData;
  iconPalette: IconPalette;
  isSoftware: boolean;
}

const getSlotTypeBadge = (slotType: SlotTypes) => {
  switch (slotType) {
    case SlotTypes.DeletedInitial:
    case SlotTypes.DeletedMiddleLink:
    case SlotTypes.DeletedEndLink:
      return (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Badge variant="destructive" {...props}>
                Deleted
              </Badge>
            )}
          />
          <TooltipContent>
            <p>This save has been deleted but can be recovered</p>
          </TooltipContent>
        </Tooltip>
      );
    case SlotTypes.Corrupted:
      return (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Badge variant="outline" {...props}>
                Corrupted
              </Badge>
            )}
          />
          <TooltipContent>
            <p>This save data is corrupted and may not be readable</p>
          </TooltipContent>
        </Tooltip>
      );
    default:
      return null;
  }
};

export const Ps1Slot: React.FC<Ps1SlotProps> = ({
  slot,
  index,
  isSelected,
  onClick,
  iconData,
  iconPalette,
  isSoftware,
}) => {
  const isFormatted = slot.slotType === SlotTypes.Formatted;
  const isLink =
    slot.slotType === SlotTypes.MiddleLink ||
    slot.slotType === SlotTypes.DeletedMiddleLink ||
    slot.slotType === SlotTypes.EndLink ||
    slot.slotType === SlotTypes.DeletedEndLink;

  return (
    <Card
      data-slot-index={index}
      className={cn(
        "mb-2 cursor-pointer border-none py-0",
        isSelected ? "bg-card" : "bg-card/40 hover:bg-card/80",
        isLink && "ml-4",
      )}
      onClick={() => onClick(index)}
    >
      <CardContent className="flex-row items-center gap-0 p-3">
        <div className="text-muted-foreground mr-2 w-6 text-xs">
          {(index + 1).toString().padStart(2, "0")}
        </div>
        {!isFormatted ? (
          <>
            {!isLink && (
              <PS1BlockIcon
                iconData={iconData}
                iconPalette={iconPalette}
                iconFrameCount={slot.iconFrameCount}
              />
            )}
            <div className="min-w-0 grow">
              <h3 className="text-foreground truncate text-sm font-medium">
                {isLink ? "Linked Save Data" : slot.name}
              </h3>
              <p className="text-muted-foreground truncate text-xs">
                {isLink ? "Part of a multi-block save" : slot.productCode}
              </p>
            </div>
            <div className="ml-2 flex flex-wrap gap-1">
              {!isLink && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={(props) => (
                        <Badge variant="secondary" {...props}>
                          {slot.identifier}
                        </Badge>
                      )}
                    />
                    <TooltipContent>
                      <p>Save identifier</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={(props) => (
                        <Badge variant="secondary" {...props}>
                          {slot.region}
                        </Badge>
                      )}
                    />
                    <TooltipContent>
                      <p>Game region</p>
                    </TooltipContent>
                  </Tooltip>
                  {isSoftware && (
                    <Tooltip>
                      <TooltipTrigger
                        render={(props) => (
                          <Badge variant="outline" {...props}>
                            Software
                          </Badge>
                        )}
                      />
                      <TooltipContent>
                        <p>PocketStation software save</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
              {getSlotTypeBadge(slot.slotType)}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">Empty Slot</span>
        )}
      </CardContent>
    </Card>
  );
};
