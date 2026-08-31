import {
  ArrowRightIcon,
  CheckIcon,
  ClipboardPasteIcon,
  CopyIcon,
  DownloadIcon,
  HistoryIcon,
  Redo2Icon,
  SaveIcon,
  TrashIcon,
  Undo2Icon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MemoryCardToolbarProps {
  selectedSlot: number | null;
  selectedPs2Save: string | null;
  selectedCard: number | null;
  cardKind: "ps1" | "ps2";
  hasCopiedSave: boolean;
  isSlotEmpty: boolean;
  isDeletable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  history: string[];
  historyIndex: number;
  onJumpToHistory: (index: number) => void;
  onCopy: () => void;
  onMove: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSave: () => void;
  onExport: () => void;
  onImport: () => void;
}

export const MemoryCardToolbar: React.FC<MemoryCardToolbarProps> = ({
  selectedSlot,
  selectedPs2Save,
  selectedCard,
  cardKind,
  hasCopiedSave,
  isSlotEmpty,
  isDeletable,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  history,
  historyIndex,
  onJumpToHistory,
  onCopy,
  onMove,
  onPaste,
  onDelete,
  onSave,
  onExport,
  onImport,
}) => {
  const isPs2 = cardKind === "ps2";
  // PS1: a real (non-empty) save slot is selected. PS2: a save dir is
  // selected. Copy/Delete/Export gate on this for both kinds.
  const targetSelected = isPs2
    ? selectedPs2Save !== null
    : selectedSlot !== null && isDeletable;

  return (
    <div className="border-border bg-muted/80 flex items-center justify-between border-b p-2">
      <h1 className="text-muted-foreground pl-2 font-light">
        Memory Card Manager{" "}
        <span className="text-xs text-sky-500 dark:text-sky-400">Beta</span>
      </h1>
      <div className="flex space-x-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo"
            >
              <Undo2Icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Undo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo"
            >
              <Redo2Icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Redo</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={selectedCard === null}
              aria-label="History"
            >
              <HistoryIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start" side="bottom">
            <DropdownMenuLabel>History</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {history.map((label, i) => (
              <DropdownMenuItem
                key={i}
                onSelect={() => onJumpToHistory(i)}
                className={cn(
                  "justify-between",
                  i === historyIndex && "bg-accent font-medium",
                )}
              >
                <span className="truncate">{label}</span>
                {i === historyIndex && <CheckIcon className="size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onCopy}
              disabled={!targetSelected}
              aria-label="Copy to buffer"
            >
              <CopyIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy to buffer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onMove}
              disabled={
                isPs2
                  ? selectedPs2Save === null
                  : selectedSlot === null || !isDeletable
              }
              aria-label="Move to buffer"
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Move to buffer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onPaste}
              disabled={
                isPs2
                  ? selectedCard === null || !hasCopiedSave
                  : selectedSlot === null || !hasCopiedSave || !isSlotEmpty
              }
              aria-label="Paste from buffer"
            >
              <ClipboardPasteIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Paste from buffer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={!targetSelected}
              aria-label="Delete save"
            >
              <TrashIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Delete save</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSave}
              disabled={selectedCard === null}
              aria-label="Save memory card"
            >
              <SaveIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Save memory card</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onExport}
              disabled={!targetSelected}
              aria-label="Export save"
            >
              <DownloadIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Export save</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onImport}
              disabled={
                isPs2
                  ? selectedCard === null
                  : selectedSlot === null || !isSlotEmpty
              }
              aria-label="Import save"
            >
              <UploadIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Import save</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};
