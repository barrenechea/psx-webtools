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
import type { ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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

import {
  type FamilyToolbarHandlers,
  type MemoryCardToolbarCaps,
} from "./types";

interface MemoryCardToolbarProps {
  caps: MemoryCardToolbarCaps;
  familyRef: RefObject<FamilyToolbarHandlers>;
  onUndo: () => void;
  onRedo: () => void;
  onJumpToHistory: (index: number) => void;
}

function ToolbarIcon({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            variant="ghost"
            size="icon"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          >
            {children}
          </Button>
        )}
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export const MemoryCardToolbar: React.FC<MemoryCardToolbarProps> = ({
  caps,
  familyRef,
  onUndo,
  onRedo,
  onJumpToHistory,
}) => (
  <div className="flex items-center justify-between border-b border-border bg-muted/80 p-2">
    <h1 className="pl-2 font-light text-muted-foreground">
      Memory Card Manager{" "}
      <span className="text-xs text-sky-500 dark:text-sky-400">Beta</span>
    </h1>
    <div className="flex space-x-2">
      <ToolbarIcon label="Undo" disabled={!caps.canUndo} onClick={onUndo}>
        <Undo2Icon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon label="Redo" disabled={!caps.canRedo} onClick={onRedo}>
        <Redo2Icon className="size-4" />
      </ToolbarIcon>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={(props) => (
            <Button
              {...props}
              variant="ghost"
              size="icon"
              disabled={!caps.canHistory}
              aria-label="History"
            >
              <HistoryIcon className="size-4" />
            </Button>
          )}
        />
        <DropdownMenuContent className="w-64" align="start" side="bottom">
          <DropdownMenuGroup>
            <DropdownMenuLabel>History</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {caps.history.map((label, i) => (
              <DropdownMenuItem
                key={i}
                onClick={() => onJumpToHistory(i)}
                className={cn(
                  "justify-between",
                  i === caps.historyIndex && "bg-accent font-medium",
                )}
              >
                <span className="truncate">{label}</span>
                {i === caps.historyIndex && <CheckIcon className="size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarIcon
        label="Copy to buffer"
        disabled={!caps.canCopy}
        onClick={() => familyRef.current.copy()}
      >
        <CopyIcon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon
        label="Move to buffer"
        disabled={!caps.canMove}
        onClick={() => familyRef.current.move()}
      >
        <ArrowRightIcon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon
        label="Paste from buffer"
        disabled={!caps.canPaste}
        onClick={() => familyRef.current.paste()}
      >
        <ClipboardPasteIcon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon
        label={caps.deleteLabel}
        disabled={!caps.canDelete}
        onClick={() => familyRef.current.deleteSave()}
      >
        <TrashIcon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon
        label="Save memory card"
        disabled={!caps.canSave}
        onClick={() => familyRef.current.saveCard()}
      >
        <SaveIcon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon
        label="Export save"
        disabled={!caps.canExport}
        onClick={() => familyRef.current.exportSave()}
      >
        <DownloadIcon className="size-4" />
      </ToolbarIcon>
      <ToolbarIcon
        label="Import save"
        disabled={!caps.canImport}
        onClick={() => familyRef.current.importSave()}
      >
        <UploadIcon className="size-4" />
      </ToolbarIcon>
    </div>
  </div>
);
