import { useLayoutEffect, useRef, type RefObject } from "react";

import {
  EMPTY_FAMILY_CAPS,
  NOOP_FAMILY_HANDLERS,
  type FamilyToolbarCaps,
  type FamilyToolbarHandlers,
} from "./types";

function sameFamilyCaps(a: FamilyToolbarCaps, b: FamilyToolbarCaps): boolean {
  return (
    a.canCopy === b.canCopy &&
    a.canMove === b.canMove &&
    a.canPaste === b.canPaste &&
    a.canDelete === b.canDelete &&
    a.canExport === b.canExport &&
    a.canImport === b.canImport &&
    a.canSave === b.canSave &&
    a.deleteLabel === b.deleteLabel
  );
}

/** Publish pane family handlers (ref) and caps (layout) to the shared toolbar. */
export function useFamilyToolbarPublish(
  ref: RefObject<FamilyToolbarHandlers>,
  handlers: FamilyToolbarHandlers,
  caps: FamilyToolbarCaps,
  onCapsChange: (caps: FamilyToolbarCaps) => void,
): void {
  const lastCaps = useRef<FamilyToolbarCaps | null>(null);
  useLayoutEffect(() => {
    ref.current = handlers;
  }, [handlers, ref]);
  useLayoutEffect(() => {
    if (lastCaps.current !== null && sameFamilyCaps(lastCaps.current, caps)) {
      return;
    }
    lastCaps.current = caps;
    onCapsChange(caps);
  }, [caps, onCapsChange]);
  useLayoutEffect(
    () => () => {
      lastCaps.current = null;
      ref.current = NOOP_FAMILY_HANDLERS;
      onCapsChange(EMPTY_FAMILY_CAPS);
    },
    [onCapsChange, ref],
  );
}
