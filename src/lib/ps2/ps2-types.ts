// Shared PS2 memory card types (card model level, above the PFS layer).

/** File-system date/time as stored in directory entries (Japan Standard Time). */
export interface Ps2DateTime {
  sec: number;
  min: number;
  hour: number;
  day: number;
  month: number;
  year: number;
}

export interface Ps2FileInfo {
  name: string;
  size: number;
}

export interface Ps2SaveInfo {
  /** Directory name (e.g. `BASLUS-21590GTA40001`). */
  name: string;
  /** Title decoded from icon.sys (falls back to the directory name). */
  title: string;
  /** icon.sys `MCICON_TYPES` id (0 saved data, 1 software PS2, ...). */
  iconType: number;
  created: Ps2DateTime;
  modified: Ps2DateTime;
  /** Entry count reported by the root entry (includes deleted slots). */
  entryCount: number;
  /** First cluster of the save directory, relative to alloc_offset. */
  dataCluster: number;
  hidden: boolean;
  ps1: boolean;
  pocketStation: boolean;
  /** Total bytes of user-data files (icons and icon.sys excluded). */
  totalSize: number;
  files: Ps2FileInfo[];
  /** icon.sys background corner colors (RGBA, 0..0x80 per channel). */
  background: [number, number, number, number][];
}

/** Raw card image extensions (detection is by size/528 + magic, not name). */
export const PS2_RAW_EXTENSIONS: readonly string[] = [".mcd", ".bin", ".ps2"];

/** Single-save export: the user-data file bytes (open item: scene extension). */
export const PS2_SINGLE_SAVE_EXTENSIONS: readonly string[] = [".sdt"];

/**
 * Card-image save formats. There is a single raw image format; the numeric
 * value exists so the format fits `SaveFormatOption<T>` typing like PS1's
 * `CardTypes`.
 */
export enum Ps2CardFormats {
  Raw = 0,
}

/**
 * Single-save export formats. `Sdt` carries the save's user-data file bytes
 * under the scene `.sdt` extension.
 */
export enum Ps2SingleSaveTypes {
  Sdt = 0,
}
