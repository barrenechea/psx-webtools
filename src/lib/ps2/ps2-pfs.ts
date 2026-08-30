// PS2 memory card file system (PFS) primitives: superblock, IFC/FAT, FAT
// chains, directory entries, and the format2 blank-card builder. All
// functions operate on a full raw image: consecutive 528-byte pages
// (512 data + 16 spare).

import {
  assembleImagePage,
  ECC_PAGE_DATA_SIZE,
  ECC_PAGE_SIZE,
  pageSpare,
} from "./ps2-ecc";
import { encodeDirentName } from "./ps2-sjis";
import type { Ps2DateTime } from "./ps2-types";

export const PAGE_SIZE = ECC_PAGE_SIZE; // 528
export const PAGE_DATA_SIZE = ECC_PAGE_DATA_SIZE; // 512
export const PAGES_PER_CLUSTER = 2;
export const PAGES_PER_BLOCK = 16;
export const CLUSTER_DATA_SIZE = PAGES_PER_CLUSTER * PAGE_DATA_SIZE; // 1024
export const CLUSTERS_PER_BLOCK = PAGES_PER_BLOCK / PAGES_PER_CLUSTER; // 8

export const PS2_MAGIC = "Sony PS2 Memory Card Format ";
export const PS2_FORMAT_VERSION = "1.2.0.0";

export const FAT_ALLOCATED_BIT = 0x80000000;
export const FAT_EOF = 0xffffffff;
export const FAT_FREE = 0x7fffffff;
export const FAT_BAD = 0xfffffffd;

export const MODE_EXISTS = 0x8000;
export const MODE_HIDDEN = 0x2000;
export const MODE_PSX = 0x1000;
export const MODE_PDA = 0x0800;
export const MODE_DIR = 0x0020;
export const MODE_FILE = 0x0010;

export const ROOT_CLUSTER = 0;
export const SELF_ENTRY = ".";
export const PARENT_ENTRY = "..";

// Injected timestamp for a deterministic blank image. Live format uses the
// current clock (`formatCard` / `format` pass `nowJst()`).
export const FRESH_ROOT_TIME: Ps2DateTime = {
  sec: 41,
  min: 0,
  hour: 6,
  day: 12,
  month: 1,
  year: 2000,
};

// ---------------------------------------------------------------------------
// Low-level page/cluster I/O
// ---------------------------------------------------------------------------

// A cluster's 1024 data bytes span two 528-byte pages: page0[0..511] then
// page1[0..511]. Offset o maps to base + (o < 512 ? o : 528 + (o - 512)).
export function clusterDataOffset(absCluster: number, offset: number): number {
  const base = absCluster * PAGES_PER_CLUSTER * PAGE_SIZE;
  return (
    base +
    (offset < PAGE_DATA_SIZE ? offset : PAGE_SIZE + (offset - PAGE_DATA_SIZE))
  );
}

// Write a 512-byte data area plus its 16-byte spare. All-0xFF data keeps the
// erased all-0xFF spare (an all-FF page is not given a computed code).
function setPageData(
  raw: Uint8Array,
  pageBase: number,
  data: Uint8Array,
): void {
  raw.set(assembleImagePage(data), pageBase);
}

function refreshPageSpare(raw: Uint8Array, pageBase: number): void {
  raw.set(
    assembleImagePage(raw.subarray(pageBase, pageBase + PAGE_DATA_SIZE)),
    pageBase,
  );
}

// Compute Hamming spare even when data is all 0xFF (a programmed all-FF
// page, not NAND-erase). assembleImagePage keeps erased spare for pages
// that were never written.
function programPageSpare(raw: Uint8Array, pageBase: number): void {
  raw.set(
    pageSpare(raw.subarray(pageBase, pageBase + PAGE_DATA_SIZE)),
    pageBase + PAGE_DATA_SIZE,
  );
}

/**
 * Canonicalize a raw dump to 528-byte pages. 528-stride images pass through;
 * a full-card data-only dump (pageCount × 512) is inflated by inserting spare.
 * PFS still addresses 512-byte data pages; 528 is only the image packing.
 */
export function normalizeCardImage(raw: Uint8Array): Uint8Array {
  if (raw.length === 0) {
    throw new Error("Invalid PS2 card image size");
  }
  if (raw.length % PAGE_SIZE === 0) {
    return raw;
  }
  if (raw.length % PAGE_DATA_SIZE !== 0) {
    throw new Error("Invalid PS2 card image size");
  }
  const sb = parseSuperblock(raw);
  const pages = sb.clustersPerCard * PAGES_PER_CLUSTER;
  if (raw.length < pages * PAGE_DATA_SIZE) {
    throw new Error("PS2 card image is truncated");
  }
  if (raw.length !== pages * PAGE_DATA_SIZE) {
    throw new Error("Invalid PS2 card image size");
  }
  const out = new Uint8Array(pages * PAGE_SIZE);
  for (let p = 0; p < pages; p++) {
    setPageData(
      out,
      p * PAGE_SIZE,
      raw.subarray(p * PAGE_DATA_SIZE, (p + 1) * PAGE_DATA_SIZE),
    );
  }
  return out;
}

/**
 * Inverse of {@link normalizeCardImage}: drop each 528-byte page's 16-byte
 * spare, yielding a data-only (512-byte stride) image for no-ECC export.
 */
export function stripImageSpares(raw: Uint8Array): Uint8Array {
  const pages = Math.floor(raw.length / PAGE_SIZE);
  const out = new Uint8Array(pages * PAGE_DATA_SIZE);
  for (let p = 0; p < pages; p++) {
    out.set(
      raw.subarray(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_DATA_SIZE),
      p * PAGE_DATA_SIZE,
    );
  }
  return out;
}

/** Read one cluster's 1024 data bytes (joined data of its two pages). */
export function readClusterData(
  raw: Uint8Array,
  absCluster: number,
  out = new Uint8Array(CLUSTER_DATA_SIZE),
): Uint8Array {
  const base = absCluster * PAGES_PER_CLUSTER * PAGE_SIZE;
  out.set(raw.subarray(base, base + PAGE_DATA_SIZE));
  out.set(
    raw.subarray(base + PAGE_SIZE, base + PAGE_SIZE + PAGE_DATA_SIZE),
    PAGE_DATA_SIZE,
  );
  return out;
}

/** Write 1024 data bytes to a cluster and refresh both pages' ECC. */
export function writeClusterData(
  raw: Uint8Array,
  absCluster: number,
  data: Uint8Array,
): void {
  const base = absCluster * PAGES_PER_CLUSTER * PAGE_SIZE;
  setPageData(raw, base, data.subarray(0, PAGE_DATA_SIZE));
  setPageData(raw, base + PAGE_SIZE, data.subarray(PAGE_DATA_SIZE));
}

function readU32AtCluster(
  raw: Uint8Array,
  absCluster: number,
  index: number,
): number {
  const p = clusterDataOffset(absCluster, index * 4);
  return (
    (raw[p] | (raw[p + 1] << 8) | (raw[p + 2] << 16) | (raw[p + 3] << 24)) >>> 0
  );
}

function writeU32AtCluster(
  raw: Uint8Array,
  absCluster: number,
  index: number,
  value: number,
): void {
  const p = clusterDataOffset(absCluster, index * 4);
  raw[p] = value & 0xff;
  raw[p + 1] = (value >>> 8) & 0xff;
  raw[p + 2] = (value >>> 16) & 0xff;
  raw[p + 3] = (value >>> 24) & 0xff;
  refreshPageSpare(raw, p - (p % PAGE_SIZE));
}

// ---------------------------------------------------------------------------
// Superblock
// ---------------------------------------------------------------------------

export interface Ps2Superblock {
  version: string;
  pageSize: number;
  pagesPerCluster: number;
  pagesPerBlock: number;
  clustersPerCard: number;
  /** First allocatable cluster; FAT/dir cluster values are relative to it. */
  allocOffset: number;
  /** Count of allocatable clusters (relative range `[0, allocEnd)`). */
  allocEnd: number;
  rootdirCluster: number;
  backupBlock1: number;
  backupBlock2: number;
  /** Absolute cluster of each indirect FAT cluster (0 = unused). */
  ifcList: number[];
  /** Erase blocks with errors (0xFFFFFFFF = none). */
  badBlockList: number[];
  cardType: number;
  cardFlags: number;
  clusterSize: number;
  fatEntriesPerCluster: number;
  clustersPerBlock: number;
  cardForm: number;
  rootdirCluster2: number;
  maxAllocatableClusters: number;
}

function readString(raw: Uint8Array, start: number, length: number): string {
  let end = 0;
  while (end < length && raw[start + end] !== 0) end++;
  let s = "";
  for (let i = 0; i < end; i++) s += String.fromCharCode(raw[start + i] & 0x7f);
  return s;
}

function readDirentName(
  raw: Uint8Array,
  start: number,
  length: number,
): string {
  let end = 0;
  while (end < length && raw[start + end] !== 0) end++;
  let s = "";
  for (let i = 0; i < end; i++) s += String.fromCharCode(raw[start + i]);
  return s;
}

/** First 27 bytes of the superblock magic (mount ignores the trailing space). */
function superblockMagicMatches(raw: Uint8Array): boolean {
  if (raw.length < 27) return false;
  for (let i = 0; i < 27; i++) {
    if (raw[i] !== PS2_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** Parse and validate the superblock on page 0. Throws on non-PS2 images. */
export function parseSuperblock(raw: Uint8Array): Ps2Superblock {
  if (raw.length < PAGE_DATA_SIZE) {
    throw new Error("Not a PS2 memory card image (too small)");
  }
  if (!superblockMagicMatches(raw)) {
    throw new Error("Not a PS2 memory card image (bad magic)");
  }
  const version = readString(raw, 0x1c, 12);
  const parts = version.split(".");
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (major !== 1 || (minor !== 1 && minor !== 2)) {
    throw new Error(`Unsupported PS2 card format version "${version}"`);
  }
  const u16 = (o: number) => raw[o] | (raw[o + 1] << 8);
  const u32 = (o: number) =>
    (raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16) | (raw[o + 3] << 24)) >>>
    0;
  const pageSize = u16(0x28);
  const pagesPerCluster = u16(0x2a);
  const pagesPerBlock = u16(0x2c);
  const clustersPerCard = u32(0x30);
  const allocOffset = u32(0x34);
  const allocEnd = u32(0x38);
  const rootdirCluster = u32(0x3c);
  const cardType = raw[0x150];
  if (pageSize !== 512 || pagesPerCluster !== 2 || pagesPerBlock !== 16) {
    throw new Error("Unsupported PS2 card geometry");
  }
  if (clustersPerCard % (PAGES_PER_BLOCK * PAGES_PER_CLUSTER) !== 0) {
    throw new Error("Unsupported PS2 card size");
  }
  if (cardType !== 2) {
    throw new Error("Not a PS2 memory card image (bad card type)");
  }
  if (rootdirCluster !== 0) {
    throw new Error("Invalid PS2 card (rootdir_cluster must be 0)");
  }
  if (allocOffset === 0 || allocOffset >= clustersPerCard || allocEnd <= 0) {
    throw new Error("Invalid PS2 card (allocation range)");
  }
  const ifcList: number[] = [];
  for (let i = 0; i < 32; i++) ifcList.push(u32(0x50 + i * 4));
  const badBlockList: number[] = [];
  for (let i = 0; i < 32; i++) badBlockList.push(u32(0xd0 + i * 4));
  return {
    version,
    pageSize,
    pagesPerCluster,
    pagesPerBlock,
    clustersPerCard,
    allocOffset,
    allocEnd,
    rootdirCluster,
    backupBlock1: u32(0x40),
    backupBlock2: u32(0x44),
    ifcList,
    badBlockList,
    cardType,
    cardFlags: raw[0x151],
    clusterSize: u32(0x154),
    fatEntriesPerCluster: u32(0x158),
    clustersPerBlock: u32(0x15c),
    cardForm: u32(0x160),
    rootdirCluster2: u32(0x164),
    maxAllocatableClusters: u32(0x170),
  };
}

// ---------------------------------------------------------------------------
// IFC / FAT
// ---------------------------------------------------------------------------

/** Absolute cluster holding the FAT cluster's 256 entries (0 if unmapped). */
function fatClusterLocation(
  raw: Uint8Array,
  sb: Ps2Superblock,
  fatIndex: number,
): number {
  const ifcLoc = sb.ifcList[fatIndex >> 8];
  if (ifcLoc === 0 || ifcLoc === FAT_EOF) return 0;
  return readU32AtCluster(raw, ifcLoc, fatIndex & 0xff);
}

/** Raw FAT value for a relative cluster (0 if the mapping is missing). */
export function fatGet(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
): number {
  const fatLoc = fatClusterLocation(raw, sb, relCluster >> 8);
  if (fatLoc === 0 || fatLoc === FAT_EOF) return 0;
  return readU32AtCluster(raw, fatLoc, relCluster & 0xff);
}

/**
 * Clear the allocated bit on each FAT slot in a chain. EOF (0xFFFFFFFF)
 * becomes 0x7FFFFFFF; a next-link keeps the cluster index without 0x80000000.
 * `cluster === 0xFFFFFFFF` (empty file, never written) is a no-op.
 */
export function releaseFatChain(
  raw: Uint8Array,
  sb: Ps2Superblock,
  firstRel: number,
): void {
  if (firstRel === FAT_EOF) return;
  let cur = firstRel >>> 0;
  for (;;) {
    const v = fatGet(raw, sb, cur);
    if (v === FAT_BAD || (v | 0) >= 0) break;
    fatSet(raw, sb, cur, (v + FAT_ALLOCATED_BIT) >>> 0);
    if (v === FAT_EOF) break;
    cur = v & 0x7fffffff;
  }
}

export function fatSet(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
  value: number,
): void {
  const fatLoc = fatClusterLocation(raw, sb, relCluster >> 8);
  if (fatLoc === 0 || fatLoc === FAT_EOF) {
    throw new Error("FAT entry not mapped");
  }
  writeU32AtCluster(raw, fatLoc, relCluster & 0xff, value);
}

/**
 * Absolute page index holding a relative cluster's FAT entry (-1 if the
 * mapping is missing). Used to snapshot FAT state for undo/redo.
 */
export function fatEntryPage(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
): number {
  const fatLoc = fatClusterLocation(raw, sb, relCluster >> 8);
  if (fatLoc === 0 || fatLoc === FAT_EOF) return -1;
  const off = (relCluster & 0xff) * 4;
  return fatLoc * PAGES_PER_CLUSTER + (off < PAGE_DATA_SIZE ? 0 : 1);
}

/** Follow an allocated chain from a relative cluster (inclusive). */
export function clusterChain(
  raw: Uint8Array,
  sb: Ps2Superblock,
  firstRel: number,
): number[] {
  const out = [firstRel];
  let cur = firstRel;
  for (let guard = 0; guard <= sb.clustersPerCard; guard++) {
    const v = fatGet(raw, sb, cur);
    if (v === FAT_EOF || !(v & FAT_ALLOCATED_BIT)) break;
    cur = v & 0x7fffffff;
    out.push(cur);
    if (out.length > sb.clustersPerCard) {
      throw new Error("FAT chain cycle");
    }
  }
  return out;
}

/** First free relative cluster in `[1, allocEnd)`, or null when full. */
export function findFreeCluster(
  raw: Uint8Array,
  sb: Ps2Superblock,
): number | null {
  for (let rel = 1; rel < sb.allocEnd; rel++) {
    // MSB clear = free (real cards show 0x7FFFFFFF and 0x00000000).
    if (!(fatGet(raw, sb, rel) & FAT_ALLOCATED_BIT)) return rel;
  }
  return null;
}

/** Concatenated file data across a cluster chain, truncated to length. */
export function readChainBytes(
  raw: Uint8Array,
  sb: Ps2Superblock,
  firstRel: number,
  length: number,
): Uint8Array {
  const out = new Uint8Array(length);
  let off = 0;
  for (const rel of clusterChain(raw, sb, firstRel)) {
    const data = readClusterData(raw, sb.allocOffset + rel);
    const n = Math.min(CLUSTER_DATA_SIZE, length - off);
    out.set(data.subarray(0, n), off);
    off += n;
    if (off >= length) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Directory entries
// ---------------------------------------------------------------------------

export interface Ps2DirEntry {
  name: string;
  mode: number;
  exists: boolean;
  isDir: boolean;
  isFile: boolean;
  hidden: boolean;
  ps1: boolean;
  pocketStation: boolean;
  /** File size in bytes, or entry count for a directory. */
  length: number;
  /** First data cluster, relative (0 for "." / ".."). */
  cluster: number;
  /** Entry index in the parent directory ("." entries only). */
  dirEntry: number;
  created: Ps2DateTime;
  modified: Ps2DateTime;
  attr: number;
  relCluster: number;
  slot: 0 | 1;
  /** Ordinal position within the directory (0-based, across chain slots). */
  index: number;
}

// Entry i of relative cluster c starts at the data area of page (2c + i).
function entryOffset(
  sb: Ps2Superblock,
  relCluster: number,
  slot: 0 | 1,
): number {
  return ((sb.allocOffset + relCluster) * PAGES_PER_CLUSTER + slot) * PAGE_SIZE;
}

function readTime(raw: Uint8Array, off: number): Ps2DateTime {
  return {
    sec: raw[off + 1],
    min: raw[off + 2],
    hour: raw[off + 3],
    day: raw[off + 4],
    month: raw[off + 5],
    year: raw[off + 6] | (raw[off + 7] << 8),
  };
}

// Write a dirent clock. Fresh slots zero `resv`; updates leave a non-zero
// `resv` byte alone (modified-only overlays never rewrite it).
function writeTime(
  raw: Uint8Array,
  off: number,
  t: Ps2DateTime,
  keepResv = false,
): void {
  if (!keepResv) raw[off] = 0;
  raw[off + 1] = t.sec;
  raw[off + 2] = t.min;
  raw[off + 3] = t.hour;
  raw[off + 4] = t.day;
  raw[off + 5] = t.month;
  raw[off + 6] = t.year & 0xff;
  raw[off + 7] = (t.year >> 8) & 0xff;
}

/** Read one 512-byte directory entry (may have `exists` false). */
export function readDirEntry(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
  slot: 0 | 1,
): Ps2DirEntry {
  const e = entryOffset(sb, relCluster, slot);
  const u16 = (o: number) => raw[e + o] | (raw[e + o + 1] << 8);
  const u32 = (o: number) =>
    (raw[e + o] |
      (raw[e + o + 1] << 8) |
      (raw[e + o + 2] << 16) |
      (raw[e + o + 3] << 24)) >>>
    0;
  const mode = u16(0x00);
  const kind = mode & (MODE_FILE | MODE_DIR | MODE_EXISTS);
  return {
    name: readDirentName(raw, e + 0x40, 32),
    mode,
    exists: (mode & MODE_EXISTS) !== 0,
    isDir: kind === (MODE_DIR | MODE_EXISTS),
    isFile: kind === (MODE_FILE | MODE_EXISTS),
    hidden: (mode & MODE_HIDDEN) !== 0,
    ps1: (mode & MODE_PSX) !== 0,
    pocketStation: (mode & MODE_PDA) !== 0,
    length: u32(0x04),
    cluster: u32(0x10),
    dirEntry: u32(0x14),
    created: readTime(raw, e + 0x08),
    modified: readTime(raw, e + 0x18),
    attr: u32(0x20),
    relCluster,
    slot,
    index: -1,
  };
}

export interface Ps2DirEntryFields {
  name: string;
  mode: number;
  length: number;
  cluster: number;
  dirEntry: number;
  created: Ps2DateTime;
  modified: Ps2DateTime;
  attr: number;
}

export interface Ps2DirEntryPatch {
  mode?: number;
  length?: number;
  cluster?: number;
  dirEntry?: number;
  created?: Ps2DateTime;
  modified?: Ps2DateTime;
  attr?: number;
  name?: string;
}

function writeU16(raw: Uint8Array, off: number, value: number): void {
  raw[off] = value & 0xff;
  raw[off + 1] = (value >>> 8) & 0xff;
}

function writeU32(raw: Uint8Array, off: number, value: number): void {
  raw[off] = value & 0xff;
  raw[off + 1] = (value >>> 8) & 0xff;
  raw[off + 2] = (value >>> 16) & 0xff;
  raw[off + 3] = (value >>> 24) & 0xff;
}

function writeNameField(raw: Uint8Array, e: number, name: string): void {
  const nameBytes = encodeDirentName(name) ?? new Uint8Array();
  for (let i = 0; i < 32; i++) {
    raw[e + 0x40 + i] = i < nameBytes.length ? nameBytes[i] : 0;
  }
}

/**
 * Write one 512-byte directory entry and refresh its page ECC.
 * `fresh` zeros the 512-byte data page first (new clusters / new dirents).
 * Updates that must keep name / created / unused use `patchDirEntry`.
 */
export function writeDirEntry(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
  slot: 0 | 1,
  f: Ps2DirEntryFields,
  fresh = false,
): void {
  const e = entryOffset(sb, relCluster, slot);
  if (fresh) {
    raw.fill(0, e, e + PAGE_DATA_SIZE);
  }
  writeU16(raw, e, f.mode);
  if (fresh) {
    raw[e + 2] = 0;
    raw[e + 3] = 0;
  }
  writeU32(raw, e + 4, f.length);
  writeTime(raw, e + 0x08, f.created, !fresh);
  writeU32(raw, e + 0x10, f.cluster);
  writeU32(raw, e + 0x14, f.dirEntry);
  writeTime(raw, e + 0x18, f.modified, !fresh);
  writeU32(raw, e + 0x20, f.attr);
  if (fresh) raw.fill(0, e + 0x24, e + 0x40);
  writeNameField(raw, e, f.name);
  refreshPageSpare(raw, e - (e % PAGE_SIZE));
}

/**
 * Overlay selected fields on an existing 512-byte dirent. Unspecified
 * fields, unused (+0x02), `resv`, and 0x24–0x3F stay as read.
 */
export function patchDirEntry(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
  slot: 0 | 1,
  patch: Ps2DirEntryPatch,
): void {
  const e = entryOffset(sb, relCluster, slot);
  if (patch.mode !== undefined) writeU16(raw, e, patch.mode);
  if (patch.length !== undefined) writeU32(raw, e + 4, patch.length);
  if (patch.created !== undefined)
    writeTime(raw, e + 0x08, patch.created, true);
  if (patch.cluster !== undefined) writeU32(raw, e + 0x10, patch.cluster);
  if (patch.dirEntry !== undefined) writeU32(raw, e + 0x14, patch.dirEntry);
  if (patch.modified !== undefined) {
    writeTime(raw, e + 0x18, patch.modified, true);
  }
  if (patch.attr !== undefined) writeU32(raw, e + 0x20, patch.attr);
  if (patch.name !== undefined) writeNameField(raw, e, patch.name);
  refreshPageSpare(raw, e - (e % PAGE_SIZE));
}

// List filter (not create): empty, control bytes, ASCII `/`, and erased NAND
// (all-0xFF or all-0x7F) stay invisible. SJIS pairs are allowed.
function isPlausibleName(name: string): boolean {
  if (name.length === 0) return false;
  let allFf = true;
  let all7f = true;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i) & 0xff;
    if (c <= 0x1f || c === 0x2f) return false;
    if (c !== 0xff) allFf = false;
    if (c !== 0x7f) all7f = false;
  }
  return !allFf && !all7f;
}

/**
 * Existing entries of a directory, in chain order (`.`, `..`, files...).
 * When `entryCount` is given, at most that many slots are examined: the
 * console never trims a directory's cluster chain, so slots past the
 * declared count can still hold stale entries that must not be listed.
 */
export function readDirectory(
  raw: Uint8Array,
  sb: Ps2Superblock,
  firstRel: number,
  entryCount?: number,
): Ps2DirEntry[] {
  const out: Ps2DirEntry[] = [];
  let slots = 0;
  for (const rel of clusterChain(raw, sb, firstRel)) {
    for (const slot of [0, 1] as const) {
      if (entryCount !== undefined && slots >= entryCount) break;
      slots++;
      const entry = readDirEntry(raw, sb, rel, slot);
      if (entry.exists && isPlausibleName(entry.name)) {
        entry.index = out.length;
        out.push(entry);
      }
    }
    if (entryCount !== undefined && slots >= entryCount) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// format2 (blank card builder)
// ---------------------------------------------------------------------------

function writeU16At(raw: Uint8Array, off: number, value: number): void {
  raw[off] = value & 0xff;
  raw[off + 1] = (value >>> 8) & 0xff;
}

function writeU32At(raw: Uint8Array, off: number, value: number): void {
  raw[off] = value & 0xff;
  raw[off + 1] = (value >>> 8) & 0xff;
  raw[off + 2] = (value >>> 16) & 0xff;
  raw[off + 3] = (value >>> 24) & 0xff;
}

// writeDirEntry keys offsets off the superblock's alloc_offset only; the
// builder supplies a stub before the superblock page is written.
function builderSuperblock(allocOffset: number): Ps2Superblock {
  return {
    version: PS2_FORMAT_VERSION,
    pageSize: 512,
    pagesPerCluster: PAGES_PER_CLUSTER,
    pagesPerBlock: PAGES_PER_BLOCK,
    clustersPerCard: 0,
    allocOffset,
    allocEnd: 0,
    rootdirCluster: 0,
    backupBlock1: 0,
    backupBlock2: 0,
    ifcList: [],
    badBlockList: [],
    cardType: 2,
    cardFlags: 0x2b,
    clusterSize: CLUSTER_DATA_SIZE,
    fatEntriesPerCluster: 256,
    clustersPerBlock: CLUSTERS_PER_BLOCK,
    cardForm: FAT_EOF,
    rootdirCluster2: 0,
    maxAllocatableClusters: 0,
  };
}

const BAD_BLOCK_SLOTS = 32;

/**
 * IFC and FAT cluster counts: `fat = ceil(clusters / 256)`,
 * `ifc = ceil(fat / 256)`. If `ifc > 32`, cap at `ifc = 32` and `fat = 0x2000`.
 */
export function ifcFatCounts(clustersPerCard: number): {
  fat: number;
  ifc: number;
} {
  const n = clustersPerCard >>> 0;
  let fat = ((((n & 0x3fffffff) * 4 - 1) >>> 0) >>> 10) + 1;
  const t = (fat * 4 - 1) | 0;
  let ifc = (t >> 10) + (t < 0 && (t & 0x3ff) !== 0 ? 1 : 0) + 1;
  if (ifc > 32) {
    ifc = 32;
    fat = 0x2000;
  }
  return { fat, ifc };
}

function packBadBlockList(badBlocks?: readonly number[]): number[] {
  const list = new Array<number>(BAD_BLOCK_SLOTS).fill(0xffffffff);
  if (badBlocks !== undefined) {
    const n = Math.min(badBlocks.length, BAD_BLOCK_SLOTS);
    for (let i = 0; i < n; i++) list[i] = badBlocks[i] >>> 0;
  }
  return list;
}

/** True if `eraseBlock` is in the 32-slot bad-block list. */
function isListedEraseBlock(
  list: readonly number[],
  eraseBlock: number,
): boolean {
  for (let i = 0; i < BAD_BLOCK_SLOTS; i++) {
    if (list[i] === eraseBlock) return true;
  }
  return false;
}

/** True if this absolute cluster sits in a listed erase block. */
function isListedAbsCluster(
  list: readonly number[],
  absCluster: number,
): boolean {
  const eraseBlock = Math.floor(
    (absCluster * PAGES_PER_CLUSTER) / PAGES_PER_BLOCK,
  );
  return isListedEraseBlock(list, eraseBlock);
}

function nextGoodAbs(
  list: readonly number[],
  abs: number,
  clustersPerCard: number,
): number {
  while (abs < clustersPerCard && isListedAbsCluster(list, abs)) abs++;
  if (abs >= clustersPerCard) {
    throw new Error("format2: no good cluster for IFC/FAT");
  }
  return abs;
}

function pageSpareHasNonFF(raw: Uint8Array, page: number): boolean {
  const off = page * PAGE_SIZE + PAGE_DATA_SIZE;
  const end = off + (PAGE_SIZE - PAGE_DATA_SIZE);
  if (end > raw.length) return false;
  for (let i = off; i < end; i++) {
    if (raw[i] !== 0xff) return true;
  }
  return false;
}

/**
 * Scan erase blocks 1 … n-1 (not 0), at most 14 hits. A block is bad if
 * page 0 or page 1 has any spare byte ≠ 0xFF. Block 0 is skipped so a
 * programmed superblock Hamming spare is not treated as a defect.
 */
function scanBadEraseBlocks(
  raw: Uint8Array,
  clustersPerCard: number,
): number[] {
  const list = new Array<number>(BAD_BLOCK_SLOTS).fill(0xffffffff);
  const blocks = (clustersPerCard * PAGES_PER_CLUSTER) / PAGES_PER_BLOCK;
  let hits = 0;
  for (let b = 1; b < blocks && hits < 14; b++) {
    const page0 = b * PAGES_PER_BLOCK;
    if (pageSpareHasNonFF(raw, page0) || pageSpareHasNonFF(raw, page0 + 1)) {
      list[hits++] = b;
    }
  }
  return list;
}

function readOnDiskBadBlockList(raw: Uint8Array): number[] {
  const list: number[] = [];
  for (let i = 0; i < BAD_BLOCK_SLOTS; i++) {
    const o = 0xd0 + i * 4;
    list.push(
      (raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16) | (raw[o + 3] << 24)) >>>
        0,
    );
  }
  return list;
}

export interface Format2Options {
  /** Erase-block indices at 0xD0 (skips the spare scan). */
  badBlocks?: readonly number[];
  /**
   * Existing image to reformat. Matching 27-byte magic keeps the on-disk
   * bad-block list at 0xD0; otherwise spares are scanned. Size must match
   * the cluster count (528-byte pages).
   */
  fromRaw?: Uint8Array;
}

function parseFormat2Opts(
  v?: readonly number[] | Format2Options,
): Format2Options {
  if (v === undefined) return {};
  if (Array.isArray(v)) return { badBlocks: v };
  return v as Format2Options;
}

/**
 * Build a blank format2 card image (528-byte pages) for the given cluster
 * count (8 MB = 8192). Geometry mirrors a retail Sony card: one reserved
 * block, then IFC, then FAT, then allocatable clusters. `time` is the
 * root `.` / `..` clock; omit it for a deterministic test image.
 * `badBlocks` are erase-block indices written at 0xD0 (inject, skip scan).
 * Pass `{ fromRaw }` to scan or keep an existing bad-block list.
 */
export function format2(
  clustersPerCard: number,
  time: Ps2DateTime = FRESH_ROOT_TIME,
  badBlocksOrOpts?: readonly number[] | Format2Options,
): Uint8Array {
  if (
    clustersPerCard < 64 ||
    clustersPerCard % (PAGES_PER_BLOCK * PAGES_PER_CLUSTER) !== 0
  ) {
    throw new Error("format2 needs a block-aligned cluster count (>= 64)");
  }
  const pages = clustersPerCard * PAGES_PER_CLUSTER;
  const opts = parseFormat2Opts(badBlocksOrOpts);
  const raw = new Uint8Array(pages * PAGE_SIZE);
  if (opts.fromRaw !== undefined) {
    if (opts.fromRaw.length !== raw.length) {
      throw new Error("format2 fromRaw size does not match cluster count");
    }
    raw.set(opts.fromRaw);
  } else {
    raw.fill(0xff);
  }

  const list =
    opts.badBlocks !== undefined
      ? packBadBlockList(opts.badBlocks)
      : superblockMagicMatches(raw)
        ? readOnDiskBadBlockList(raw)
        : scanBadEraseBlocks(raw, clustersPerCard);
  const blocks = pages / PAGES_PER_BLOCK;
  let backupBlock1 = blocks - 1;
  while (isListedEraseBlock(list, backupBlock1)) backupBlock1--;
  let backupBlock2 = backupBlock1 - 1;
  while (isListedEraseBlock(list, backupBlock2)) backupBlock2--;

  const { fat: fatClusters, ifc: ifcClusters } = ifcFatCounts(clustersPerCard);
  // first_candidate = ppb * pagesize / 1024 (8 on Sony).
  let abs = Math.floor((PAGES_PER_BLOCK * PAGE_DATA_SIZE) / CLUSTER_DATA_SIZE);
  const ifcLocs: number[] = [];
  for (let i = 0; i < ifcClusters; i++) {
    abs = nextGoodAbs(list, abs, clustersPerCard);
    ifcLocs.push(abs);
    abs++;
  }
  const fatLocs: number[] = [];
  for (let j = 0; j < fatClusters; j++) {
    abs = nextGoodAbs(list, abs, clustersPerCard);
    fatLocs.push(abs);
    abs++;
  }

  // IFC: entry j = absolute cluster of FAT cluster j. Flush programs both
  // pages; unused slots stay 0xFFFFFFFF with Hamming spare, not NAND-erase.
  for (let i = 0; i < ifcClusters; i++) {
    const loc = ifcLocs[i];
    for (let j = 0; j < 256; j++) {
      const rel = i * 256 + j;
      if (rel < fatClusters) writeU32AtCluster(raw, loc, j, fatLocs[rel]);
    }
    const base = loc * PAGES_PER_CLUSTER * PAGE_SIZE;
    programPageSpare(raw, base);
    programPageSpare(raw, base + PAGE_SIZE);
  }

  let allocOffset = abs;
  let allocEnd = backupBlock2 * CLUSTERS_PER_BLOCK - allocOffset;
  if (allocEnd <= 0) {
    throw new Error("format2: card too small for a usable allocation range");
  }
  const maxAllocTarget = Math.floor(clustersPerCard / 1000) * 1000 + 1;
  let good = 0;
  let maxAlloc = 0;
  let walkAbs = abs;
  for (let i = 0; i < allocEnd; i++) {
    if (good === maxAllocTarget) {
      maxAlloc = walkAbs - allocOffset;
    }
    const firstGood = good === 0;
    if (isListedAbsCluster(list, walkAbs)) {
      writeU32AtCluster(raw, fatLocs[i >> 8], i & 0xff, FAT_BAD);
    } else {
      good++;
      if (firstGood) allocOffset = walkAbs;
      writeU32AtCluster(raw, fatLocs[i >> 8], i & 0xff, FAT_FREE);
    }
    walkAbs++;
  }
  if (good < maxAllocTarget) {
    throw new Error("format2: not enough good clusters");
  }
  allocEnd = backupBlock2 * CLUSTERS_PER_BLOCK - allocOffset;
  // Relative 0 must still be free so the root cluster can occupy it.
  const fat0 = clusterDataOffset(fatLocs[0], 0);
  const firstFat =
    (raw[fat0] |
      (raw[fat0 + 1] << 8) |
      (raw[fat0 + 2] << 16) |
      (raw[fat0 + 3] << 24)) >>>
    0;
  if (firstFat !== FAT_FREE) {
    throw new Error("format2: not enough good clusters");
  }

  // Root cluster (relative 0): self + parent entries. Each page is zeroed
  // first so unused 0x60–0x1FF is 0, not erase-fill.
  const sb = builderSuperblock(allocOffset);
  writeDirEntry(
    raw,
    sb,
    0,
    0,
    {
      name: SELF_ENTRY,
      mode: 0x8427,
      length: 2,
      cluster: 0,
      dirEntry: 0,
      created: time,
      modified: time,
      attr: 0,
    },
    true,
  );
  writeDirEntry(
    raw,
    sb,
    0,
    1,
    {
      name: PARENT_ENTRY,
      mode: 0xa426,
      length: 0,
      cluster: 0,
      dirEntry: 0,
      created: time,
      modified: time,
      attr: 0,
    },
    true,
  );
  writeU32AtCluster(raw, fatLocs[0], 0, FAT_EOF);
  // Both pages of each FAT cluster get Hamming spare after the table is
  // patched (unused all-FF pages included, not left as NAND-erase).
  for (const loc of fatLocs) {
    const base = loc * PAGES_PER_CLUSTER * PAGE_SIZE;
    programPageSpare(raw, base);
    programPageSpare(raw, base + PAGE_SIZE);
  }

  // Superblock (page 0): start from erase-fill and overlay serialized fields.
  // True leftovers (0x152–0x153, 0x184+) stay 0xFF. 0x24–0x27 are in-RAM
  // zeros copied by the 40-byte magic/version write, not erase-fill.
  const sbPage = new Uint8Array(PAGE_SIZE);
  sbPage.fill(0xff);
  const ascii = new TextEncoder();
  sbPage.set(ascii.encode(PS2_MAGIC), 0x00);
  sbPage.set(ascii.encode(PS2_FORMAT_VERSION), 0x1c);
  sbPage[0x23] = 0;
  sbPage.fill(0, 0x24, 0x28);
  writeU16At(sbPage, 0x28, 512);
  writeU16At(sbPage, 0x2a, PAGES_PER_CLUSTER);
  writeU16At(sbPage, 0x2c, PAGES_PER_BLOCK);
  writeU16At(sbPage, 0x2e, 0xff00);
  writeU32At(sbPage, 0x30, clustersPerCard);
  writeU32At(sbPage, 0x34, allocOffset);
  writeU32At(sbPage, 0x38, allocEnd);
  writeU32At(sbPage, 0x3c, 0);
  writeU32At(sbPage, 0x40, backupBlock1);
  writeU32At(sbPage, 0x44, backupBlock2);
  writeU32At(sbPage, 0x48, 0);
  writeU32At(sbPage, 0x4c, 0);
  sbPage.fill(0, 0x50, 0xd0);
  for (let i = 0; i < ifcClusters; i++) {
    writeU32At(sbPage, 0x50 + i * 4, ifcLocs[i]);
  }
  for (let i = 0; i < BAD_BLOCK_SLOTS; i++) {
    writeU32At(sbPage, 0xd0 + i * 4, list[i]);
  }
  sbPage[0x150] = 2;
  sbPage[0x151] = 0x2b;
  writeU32At(sbPage, 0x154, CLUSTER_DATA_SIZE);
  writeU32At(sbPage, 0x158, 256);
  writeU32At(sbPage, 0x15c, CLUSTERS_PER_BLOCK);
  writeU32At(sbPage, 0x160, FAT_EOF);
  writeU32At(sbPage, 0x164, 0);
  writeU32At(sbPage, 0x168, 0);
  writeU32At(sbPage, 0x16c, 0);
  writeU32At(sbPage, 0x170, maxAlloc);
  writeU32At(sbPage, 0x174, FAT_EOF);
  writeU32At(sbPage, 0x178, FAT_EOF);
  writeU32At(sbPage, 0x17c, FAT_EOF);
  writeU32At(sbPage, 0x180, FAT_EOF);
  raw.set(sbPage, 0);
  refreshPageSpare(raw, 0);
  return raw;
}
