// Shared PS2 memory card types (card model level, above the PFS layer).

import type { Ps2IconModel } from "./ps2-icon";

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
  /** icon.sys background corner colors (RGBA, 0..255 per channel). */
  background: [number, number, number, number][];
  /**
   * icon.sys background transparency (0x00 clear … 0x80 opaque). 0 when the
   * save has no icon.sys. Corner X is stored in `background[][3]` and is not
   * used as color (OSDSYS RGB-).
   */
  backgroundTransparency: number;
  /**
   * View-icon filename from icon.sys (`_SCE8` for system config). Empty when
   * the save has no icon.sys. Built-in `_SCE*` names are not files on the card.
   */
  viewIcon: string;
  /**
   * Parsed 3D icon model of the view icon file, or null when the save has no
   * on-card icon file or it is not a valid 3D icon. The UI substitutes
   * OSDSYS ICOBYSYS for `_SCE8` / `B[IEA]DATA-SYSTEM`, otherwise ICOBFBRK.
   */
  iconModel: Ps2IconModel | null;
  /** icon.sys lighting for the 3D icon: three directional lights + ambient. */
  iconLighting: {
    dirs: number[][];
    cols: number[][];
    ambient: number[];
  } | null;
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
 * under the scene `.sdt` extension; the rest wrap the save's whole file set in
 * a PS2 single-save container. Container writers emit the canonical layout for
 * each format (`.psu`, `.sps`, `.xps`, `.cbs`, `.psv`).
 */
export enum Ps2SingleSaveTypes {
  Sdt = 0,
  MaxDrive = 1,
  Ems = 2,
  SharkPort = 3,
  XPort = 4,
  CodeBreaker = 5,
  Psv = 6,
}

/** Get Specs flags bit 0: page has spare ECC. Sony 8 MB `0x2B` includes this. */
export const CF_USE_ECC = 0x01;

/** Physical geometry reported by the PS2 SIO2 Get Specs (0x26) command. */
export interface Ps2CardSpecs {
  /** Flags at MISO [2] (0x2B command-OK on a Sony 8 MB card; 0x52 is the XOR). */
  flags: number;
  /** Page size in bytes (512 on official cards). */
  pageSize: number;
  /** Pages per erase block. */
  blockPages: number;
  /** Total page count (the Get Specs "cardsize" is pages, not bytes). */
  pageCount: number;
}

/**
 * Get Specs outcome: usable specs, a refusal that needs auth (no keyset used),
 * or an error. On a MagicGate error `step` names the failed handshake step
 * (e.g. "F0 0A") so a caller can report which packet the card refused.
 */
export type Ps2SpecsResult =
  | { status: "ok"; specs: Ps2CardSpecs }
  | { status: "needs-auth" }
  | { status: "error"; message: string; step?: string };

/**
 * Full-card dump outcome: the raw image, a needs-auth refusal (no keyset used),
 * or an error. `step` is present when a MagicGate handshake step failed.
 */
export type Ps2CardImageResult =
  | { status: "ok"; image: Uint8Array; specs: Ps2CardSpecs }
  | { status: "needs-auth" }
  | { status: "error"; message: string; step?: string };

/**
 * MagicGate (mechacon) authentication outcome. `ok` carries the derived
 * 8-byte SessionKey; `error` names the step that failed so a caller can report
 * the keyset.
 */
export type Ps2MgAuthResult =
  | { status: "ok"; sessionKey: Uint8Array }
  | { status: "error"; message: string; step: string };
