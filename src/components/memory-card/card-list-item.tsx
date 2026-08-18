import { FileIcon, MemoryStickIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CardListItemProps {
  name: string;
  type: "file" | "device";
  changed: boolean;
  isSelected: boolean;
  onClick: () => void;
}

export const CardListItem: React.FC<CardListItemProps> = ({
  name,
  type,
  changed,
  isSelected,
  onClick,
}) => (
  <Button
    variant="ghost"
    className={`mb-1 w-full justify-start ${
      isSelected
        ? "bg-card hover:bg-card cursor-default"
        : "bg-card/40 hover:bg-card/80 border-transparent"
    }`}
    onClick={onClick}
  >
    {type === "device" ? (
      <MemoryStickIcon className="size-4" />
    ) : (
      <FileIcon className="size-4" />
    )}
    <span className="max-w-44 truncate">{name}</span>
    {changed && (
      <span
        title="Unsaved changes"
        aria-label="Unsaved changes"
        className="ml-auto size-2 shrink-0 rounded-full bg-amber-500"
      />
    )}
  </Button>
);
