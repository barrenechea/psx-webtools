import { Fragment, useState, type ReactNode } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export interface SaveListMenuItem {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  onClick: () => void;
}

interface SaveListMenuProps<T> {
  rowSelector: string;
  parseRow: (el: Element) => T | null;
  itemsFor: (target: T) => readonly SaveListMenuItem[];
  children: ReactNode;
  className?: string;
}

// One shared context menu for a list of rows (not one menu per row), so
// switching cards does not mount/dispose a menu instance per item.
export function SaveListMenu<T>({
  rowSelector,
  parseRow,
  itemsFor,
  children,
  className,
}: SaveListMenuProps<T>) {
  const [target, setTarget] = useState<T | null>(null);
  const items = target !== null ? itemsFor(target) : [];

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={(props) => (
          <div
            {...props}
            className={cn("min-h-full p-4", className)}
            onContextMenu={(event) => {
              const el = (event.target as HTMLElement).closest(rowSelector);
              setTarget(el ? parseRow(el) : null);
              props.onContextMenu?.(event);
            }}
          >
            {children}
          </div>
        )}
      />
      <ContextMenuContent>
        {items.map((item, index) => (
          <Fragment key={`${item.label}:${index}`}>
            {item.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem
              disabled={item.disabled}
              variant={item.destructive ? "destructive" : "default"}
              onClick={item.onClick}
            >
              {item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
