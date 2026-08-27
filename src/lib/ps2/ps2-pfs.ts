// PS2 memory card file system (PFS) primitives: superblock, IFC/FAT, FAT
// chains, directory entries, and the format2 blank-card builder. All
// functions operate on a full raw image: consecutive 528-byte pages
// (512 data + 16 spare).

import {
  assembleImagePage,
  ECC_PAGE_DATA_SIZE,
  ECC_PAGE_SIZE,
} from "./ps2-ecc";
import type { Ps2DateTime } from "./ps2-types";

export const PAGE_SIZE = ECC_PAGE_SIZE; // 528
export const PAGE_DATA_SIZE = ECC_PAGE_DATA_SIZE; // 512
export const PAGES_PER_CLUSTER = 2;
export const PAGES_PER_BLOCK = 16;
export const CLUSTER_DATA_SIZE = PAGES_PER_CLUSTER * PAGE_DATA_SIZE; // 1024
export const CLUSTERS_PER_BLOCK = PAGES_PER_BLOCK / PAGES_PER_CLUSTER; // 8

export const PS2_MAGIC = "Sony PS2 Memory Card Format ";
export const PS2_FORMAT_VERSION = "1.1.0.0";

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

// Fixed timestamp written to a fresh root cluster (2000-01-12 06:00:41 JST),
// matching a real freshly formatted card.
const FRESH_ROOT_TIME: Ps2DateTime = {
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

/** Parse and validate the superblock on page 0. Throws on non-PS2 images. */
export function parseSuperblock(raw: Uint8Array): Ps2Superblock {
  if (raw.length < PAGE_DATA_SIZE) {
    throw new Error("Not a PS2 memory card image (too small)");
  }
  if (readString(raw, 0, 28) !== PS2_MAGIC) {
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

function writeTime(raw: Uint8Array, off: number, t: Ps2DateTime): void {
  raw[off] = 0;
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
    name: readString(raw, e + 0x40, 32),
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

/** Write one 512-byte directory entry and refresh its page ECC. */
export function writeDirEntry(
  raw: Uint8Array,
  sb: Ps2Superblock,
  relCluster: number,
  slot: 0 | 1,
  f: Ps2DirEntryFields,
): void {
  const e = entryOffset(sb, relCluster, slot);
  raw[e] = f.mode & 0xff;
  raw[e + 1] = (f.mode >> 8) & 0xff;
  raw[e + 2] = 0;
  raw[e + 3] = 0;
  const len = f.length >>> 0;
  raw[e + 4] = len & 0xff;
  raw[e + 5] = (len >> 8) & 0xff;
  raw[e + 6] = (len >> 16) & 0xff;
  raw[e + 7] = (len >> 24) & 0xff;
  writeTime(raw, e + 0x08, f.created);
  const cl = f.cluster >>> 0;
  raw[e + 0x10] = cl & 0xff;
  raw[e + 0x11] = (cl >> 8) & 0xff;
  raw[e + 0x12] = (cl >> 16) & 0xff;
  raw[e + 0x13] = (cl >> 24) & 0xff;
  const de = f.dirEntry >>> 0;
  raw[e + 0x14] = de & 0xff;
  raw[e + 0x15] = (de >> 8) & 0xff;
  raw[e + 0x16] = (de >> 16) & 0xff;
  raw[e + 0x17] = (de >> 24) & 0xff;
  writeTime(raw, e + 0x18, f.modified);
  const at = f.attr >>> 0;
  raw[e + 0x20] = at & 0xff;
  raw[e + 0x21] = (at >> 8) & 0xff;
  raw[e + 0x22] = (at >> 16) & 0xff;
  raw[e + 0x23] = (at >> 24) & 0xff;
  raw.fill(0, e + 0x24, e + 0x40);
  for (let i = 0; i < 32; i++) {
    raw[e + 0x40 + i] = i < f.name.length ? f.name.charCodeAt(i) & 0x7f : 0;
  }
  refreshPageSpare(raw, e - (e % PAGE_SIZE));
}

// Legal names are printable ASCII without `? * /`; an erased cluster reads
// back as mode 0xFFFF (exists set) with a 0x7F "name", so a sane name is part
// of the validity check, not just the exists bit.
function isPlausibleName(name: string): boolean {
  if (name.length === 0) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (
      c < 0x20 ||
      c > 0x7e ||
      name[i] === "?" ||
      name[i] === "*" ||
      name[i] === "/"
    ) {
      return false;
    }
  }
  return true;
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

/**
 * Build a blank format2 card image (528-byte pages) for the given cluster
 * count (8 MB = 8192). Geometry mirrors a retail Sony card: one reserved
 * block, then IFC, then FAT, then allocatable clusters.
 */
export function format2(clustersPerCard: number): Uint8Array {
  if (
    clustersPerCard < 64 ||
    clustersPerCard % (PAGES_PER_BLOCK * PAGES_PER_CLUSTER) !== 0
  ) {
    throw new Error("format2 needs a block-aligned cluster count (>= 64)");
  }
  const pages = clustersPerCard * PAGES_PER_CLUSTER;
  const raw = new Uint8Array(pages * PAGE_SIZE);
  raw.fill(0xff); // erased media

  const blocks = pages / PAGES_PER_BLOCK;
  const backupBlock1 = blocks - 1;
  const backupBlock2 = blocks - 2;
  const fatClusters = Math.ceil(clustersPerCard / 256);
  const ifcClusters = Math.ceil(fatClusters / 256);
  const ifcStart = CLUSTERS_PER_BLOCK;
  const fatStart = ifcStart + ifcClusters;
  const allocOffset = fatStart + fatClusters;
  const allocEnd = backupBlock2 * CLUSTERS_PER_BLOCK - allocOffset;
  if (allocEnd <= 0) {
    throw new Error("format2: card too small for a usable allocation range");
  }
  const maxAlloc = Math.floor(clustersPerCard / 1000) * 1000 + 1;

  // IFC: entry j = absolute cluster of FAT cluster j.
  for (let i = 0; i < ifcClusters; i++) {
    const loc = ifcStart + i;
    for (let j = 0; j < 256; j++) {
      const rel = i * 256 + j;
      if (rel < fatClusters) writeU32AtCluster(raw, loc, j, fatStart + rel);
    }
  }
  // FAT: rel 0 = root end-of-chain, allocatable = free, rest stays erased.
  for (let j = 0; j < fatClusters; j++) {
    const loc = fatStart + j;
    for (let k = 0; k < 256; k++) {
      const rel = j * 256 + k;
      if (rel === 0) writeU32AtCluster(raw, loc, k, FAT_EOF);
      else if (rel < allocEnd) writeU32AtCluster(raw, loc, k, FAT_FREE);
    }
  }
  // Root cluster (relative 0): self + parent entries.
  const sb = builderSuperblock(allocOffset);
  const time = FRESH_ROOT_TIME;
  writeDirEntry(raw, sb, 0, 0, {
    name: SELF_ENTRY,
    mode: 0x8427,
    length: 2,
    cluster: 0,
    dirEntry: 0,
    created: time,
    modified: time,
    attr: 0,
  });
  writeDirEntry(raw, sb, 0, 1, {
    name: PARENT_ENTRY,
    mode: 0xa426,
    length: 0,
    cluster: 0,
    dirEntry: 0,
    created: time,
    modified: time,
    attr: 0,
  });

  // Superblock (page 0). Core fields to 0xD0, bad_block_list stays 0xFF,
  // tail (0x180+) stays erased.
  const sbPage = new Uint8Array(PAGE_SIZE);
  sbPage.fill(0xff);
  sbPage.fill(0, 0, 0xd0);
  const ascii = new TextEncoder();
  sbPage.set(ascii.encode(PS2_MAGIC), 0x00);
  sbPage.set(ascii.encode(PS2_FORMAT_VERSION), 0x1c);
  sbPage[0x28] = 0x00;
  sbPage[0x29] = 0x02; // 512
  sbPage[0x2a] = PAGES_PER_CLUSTER;
  sbPage[0x2c] = PAGES_PER_BLOCK;
  // sbPage[0x2e] stays 0x00; sbPage[0x2f] stays 0xFF -> unused 0xFF00
  writeU32At(sbPage, 0x30, clustersPerCard);
  writeU32At(sbPage, 0x34, allocOffset);
  writeU32At(sbPage, 0x38, allocEnd);
  writeU32At(sbPage, 0x3c, 0);
  writeU32At(sbPage, 0x40, backupBlock1);
  writeU32At(sbPage, 0x44, backupBlock2);
  for (let i = 0; i < ifcClusters; i++) {
    writeU32At(sbPage, 0x50 + i * 4, ifcStart + i);
  }
  sbPage[0x150] = 2;
  sbPage[0x151] = 0x2b;
  // Extended region: unknowns zero, two fields FF, as on a retail card.
  sbPage.fill(0, 0x154, 0x17c);
  writeU32At(sbPage, 0x154, CLUSTER_DATA_SIZE);
  writeU32At(sbPage, 0x158, 256);
  writeU32At(sbPage, 0x15c, CLUSTERS_PER_BLOCK);
  sbPage.fill(0xff, 0x160, 0x164); // card form "not initialized"
  writeU32At(sbPage, 0x170, maxAlloc);
  sbPage.fill(0xff, 0x17c, 0x180);
  raw.set(sbPage, 0);
  refreshPageSpare(raw, 0);
  return raw;
}
