import { FileIcon, FilePlusIcon, MemoryStickIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CardListItemProps {
  name: string;
  type: "file" | "device" | "new";
  kind: "ps1" | "ps2";
  changed: boolean;
  isSelected: boolean;
  onClick: () => void;
  onClose: () => void;
}

export const CardListItem: React.FC<CardListItemProps> = ({
  name,
  type,
  kind,
  changed,
  isSelected,
  onClick,
  onClose,
}) => (
  <div className="group relative mb-1 min-w-0 contain-inline-size">
    <Button
      variant="ghost"
      className={`w-full min-w-0 justify-start overflow-hidden pr-6 ${
        isSelected
          ? "bg-card hover:bg-card cursor-default"
          : "bg-card/40 hover:bg-card/80 border-transparent"
      }`}
      onClick={onClick}
    >
      {type === "device" ? (
        <MemoryStickIcon className="size-4" />
      ) : type === "new" ? (
        <FilePlusIcon className="size-4" />
      ) : (
        <FileIcon className="size-4" />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <Badge
        variant="outline"
        className="text-muted-foreground ml-2 shrink-0 text-[10px]"
      >
        {kind === "ps2" ? "PS2" : "PS1"}
      </Badge>
      {changed && (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <span
                {...props}
                aria-label="Unsaved changes"
                className="ml-auto size-2 shrink-0 rounded-full bg-amber-500"
              />
            )}
          />
          <TooltipContent>Unsaved changes</TooltipContent>
        </Tooltip>
      )}
    </Button>
    <button
      type="button"
      aria-label="Close card"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="text-muted-foreground hover:bg-accent hover:text-accent-foreground absolute top-1/2 right-1 hidden -translate-y-1/2 rounded p-0.5 group-hover:block"
    >
      <XIcon className="size-3.5" />
    </button>
  </div>
);
