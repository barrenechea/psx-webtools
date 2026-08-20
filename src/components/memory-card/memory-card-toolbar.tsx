import {
  ArrowRightIcon,
  ClipboardPasteIcon,
  CopyIcon,
  DownloadIcon,
  Redo2Icon,
  SaveIcon,
  TrashIcon,
  Undo2Icon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// enable copy/move/delete functionality for testing
const alphaDisabled = false;

interface MemoryCardToolbarProps {
  selectedSlot: number | null;
  selectedCard: number | null;
  hasCopiedSave: boolean;
  isSlotEmpty: boolean;
  isDeletable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
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
  selectedCard,
  hasCopiedSave,
  isSlotEmpty,
  isDeletable,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCopy,
  onMove,
  onPaste,
  onDelete,
  onSave,
  onExport,
  onImport,
}) => (
  <div className="border-border bg-muted/80 flex items-center justify-between border-b p-2">
    <h1 className="text-muted-foreground pl-2 font-light">
      Memory Card Manager{" "}
      <span className="text-destructive text-xs dark:text-red-400">Alpha</span>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCopy}
            disabled={selectedSlot === null || !isDeletable || alphaDisabled}
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
            disabled={selectedSlot === null || !isDeletable || alphaDisabled}
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
              selectedSlot === null ||
              !hasCopiedSave ||
              !isSlotEmpty ||
              alphaDisabled
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
            disabled={selectedSlot === null || !isDeletable || alphaDisabled}
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
            disabled={selectedSlot === null || !isDeletable}
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
            disabled={selectedSlot === null || !isSlotEmpty}
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
