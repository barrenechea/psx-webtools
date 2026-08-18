import {
  ArrowRightIcon,
  ClipboardPasteIcon,
  CopyIcon,
  DownloadIcon,
  SaveIcon,
  TrashIcon,
  UploadIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// enable copy/move/delete functionality for testing
const alphaDisabled = false;

interface MemoryCardToolbarProps {
  selectedSlot: number | null;
  selectedCard: number | null;
  hasCopiedSave: boolean;
  isSlotEmpty: boolean;
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
    <TooltipProvider>
      <div className="flex space-x-2">
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onCopy}
              disabled={selectedSlot === null || alphaDisabled}
              aria-label="Copy to buffer"
            >
              <CopyIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy to buffer</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onMove}
              disabled={selectedSlot === null || alphaDisabled}
              aria-label="Move to buffer"
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Move to buffer</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onPaste}
              disabled={
                selectedSlot === null || !hasCopiedSave || alphaDisabled
              }
              aria-label="Paste from buffer"
            >
              <ClipboardPasteIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Paste from buffer</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={selectedSlot === null || alphaDisabled}
              aria-label="Delete save"
            >
              <TrashIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Delete save</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
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
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onExport}
              disabled={selectedSlot === null || isSlotEmpty}
              aria-label="Export save"
            >
              <DownloadIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Export save</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={100}>
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
    </TooltipProvider>
  </div>
);
