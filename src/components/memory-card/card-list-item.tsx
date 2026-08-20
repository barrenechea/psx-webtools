import { FileIcon, FilePlusIcon, MemoryStickIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CardListItemProps {
  name: string;
  type: "file" | "device" | "new";
  changed: boolean;
  isSelected: boolean;
  onClick: () => void;
  onClose: () => void;
}

export const CardListItem: React.FC<CardListItemProps> = ({
  name,
  type,
  changed,
  isSelected,
  onClick,
  onClose,
}) => (
  <div className="group relative mb-1">
    <Button
      variant="ghost"
      className={`w-full justify-start pr-6 ${
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
      <span className="max-w-40 truncate">{name}</span>
      {changed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label="Unsaved changes"
              className="ml-auto size-2 shrink-0 rounded-full bg-amber-500"
            />
          </TooltipTrigger>
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
