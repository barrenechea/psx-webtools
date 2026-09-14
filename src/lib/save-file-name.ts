// File-name helpers for save/export dialogs. Known extensions include both
// PS1 and PS2 suffixes so stacked names like "card.ps2.mcd" collapse to one.

import {
  CardExtensions,
  RAW_EXTENSIONS,
  SingleSaveExtensions,
} from "@/lib/ps1-memory-card";
import {
  PS2_RAW_EXTENSIONS,
  PS2_SINGLE_SAVE_EXTENSIONS,
} from "@/lib/ps2/ps2-types";

/** Import-only suffixes that are not card or single-save export maps. */
const PS1_IMPORT_ONLY_EXTENSIONS = [
  ".ps1",
  ".mem",
  ".mc1",
  ".mc2",
  ".pda",
  ".psx",
] as const;

const PS2_CONTAINER_EXTENSIONS = [
  ".psu",
  ".max",
  ".sps",
  ".xps",
  ".cbs",
  ".npo",
] as const;

const KNOWN_FILE_EXTENSIONS = Array.from(
  new Set([
    ...Object.values(CardExtensions),
    ...Object.values(SingleSaveExtensions),
    ...RAW_EXTENSIONS,
    ...PS1_IMPORT_ONLY_EXTENSIONS,
    ...PS2_RAW_EXTENSIONS,
    ...PS2_SINGLE_SAVE_EXTENSIONS,
    ...PS2_CONTAINER_EXTENSIONS,
  ]),
);

/**
 * Strips any stacked known extensions from a file name and appends the target
 * extension exactly once, so the result always ends with a single, correct
 * extension (e.g. "card.mcr.mcr" + ".gme" -> "card.gme").
 */
export function withSingleExtension(
  fileName: string,
  targetExtension: string,
): string {
  let name = fileName.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const lower = name.toLowerCase();
    for (const ext of KNOWN_FILE_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        name = name.slice(0, name.length - ext.length);
        changed = true;
        break;
      }
    }
  }
  if (!name.toLowerCase().endsWith(targetExtension.toLowerCase())) {
    name += targetExtension;
  }
  return name;
}

export function getFileExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot >= base.length - 1) return "";
  return base.slice(lastDot).toLowerCase();
}
