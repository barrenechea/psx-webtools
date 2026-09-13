import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { isPs2ConquestCard } from "@/lib/ps2/ps2-conquest";
import {
  eraseBlockCount,
  format2,
  occupiedBadBlocks,
  PAGE_SIZE,
  PAGES_PER_BLOCK,
  PAGES_PER_CLUSTER,
  readBadBlockListFromPage,
  sameOccupiedBadBlocks,
} from "@/lib/ps2/ps2-pfs";
import { scanSpareMarkedEraseBlocksAsync } from "@/lib/ps2/ps2-spare-scan";
import type { Ps2CardImageResult, Ps2CardSpecs } from "@/lib/ps2/ps2-types";

export type Ps2DestNand = {
  readPage: (page: number) => Promise<Uint8Array | null>;
  writePage: (page: number, data: Uint8Array) => Promise<boolean>;
  eraseBlock: (block: number) => Promise<boolean>;
};

type DestResult<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; result: Ps2CardImageResult };

export type PreparePs2ImageResult =
  | { ok: true; image: Uint8Array; blocks: number[] }
  | { ok: false; message: string };

function ps2DestGeometryError(specs: Ps2CardSpecs): Ps2CardImageResult | null {
  if (specs.pageSize !== 512) {
    return {
      status: "error",
      message: "Only 512-byte-page PS2 cards are supported on this device.",
    };
  }
  if (specs.pageCount % PAGES_PER_BLOCK !== 0) {
    return {
      status: "error",
      message: "The PS2 card does not contain complete 16-page blocks.",
    };
  }
  return null;
}

function pageIsErased(image: Uint8Array, page: number): boolean {
  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  for (let i = start; i < end; i++) {
    if (image[i] !== 0xff) return false;
  }
  return true;
}

function blockHasProgrammedPage(image: Uint8Array, block: number): boolean {
  const first = block * PAGES_PER_BLOCK;
  for (let page = first; page < first + PAGES_PER_BLOCK; page++) {
    if (!pageIsErased(image, page)) return true;
  }
  return false;
}

function superblockLast(blocks: readonly number[]): number[] {
  const rest = blocks.filter((b) => b !== 0);
  return blocks.includes(0) ? [...rest, 0] : rest;
}

/** Unlisted erase-block indices in card order (block 0 first when present). */
export function unlistedEraseBlocks(
  blockCount: number,
  skip: readonly number[],
): number[] {
  const skipSet = new Set(skip);
  const out: number[] = [];
  for (let block = 0; block < blockCount; block++) {
    if (!skipSet.has(block)) out.push(block);
  }
  return out;
}

/**
 * Every unlisted erase block, with block 0 last. Used for an unparseable 1:1
 * dump restore.
 */
export function destAllBlocks(
  blockCount: number,
  skip: readonly number[],
): number[] {
  return superblockLast(unlistedEraseBlocks(blockCount, skip));
}

/**
 * Erase-block indices that must be programmed from `image`. Listed dest
 * blocks are omitted. A block is picked when any of its pages is not 0xFF.
 * Block 0 is last so the superblock is written after IFC/FAT/root.
 */
export function destWriteBlocks(
  image: Uint8Array,
  skip: readonly number[],
): number[] {
  const blockCount = image.length / PAGE_SIZE / PAGES_PER_BLOCK;
  return superblockLast(
    unlistedEraseBlocks(blockCount, skip).filter((block) =>
      blockHasProgrammedPage(image, block),
    ),
  );
}

/**
 * Relocate a dump onto the destination card's bad-block list. Same list keeps
 * the source bytes. An unparseable image is only writable when the dest list
 * is empty (1:1 program of every block). The dest write-block list is chosen
 * in this same pass as the parse.
 */
export function preparePs2ImageForDest(
  image: Uint8Array,
  destBad: readonly number[],
): PreparePs2ImageResult {
  const card = PS2MemoryCard.tryFromBytes(image);
  if (card === null) {
    if (destBad.length === 0) {
      const blockCount = image.length / PAGE_SIZE / PAGES_PER_BLOCK;
      return {
        ok: true,
        image,
        blocks: destAllBlocks(blockCount, destBad),
      };
    }
    return {
      ok: false,
      message:
        "The card image is not a PS2 filesystem, so it cannot be relocated around the card's bad blocks.",
    };
  }
  const cardBlocks = eraseBlockCount(card.getSuperblock().clustersPerCard);
  const want = occupiedBadBlocks(destBad, cardBlocks);
  const have = occupiedBadBlocks(card.getSuperblock().badBlockList, cardBlocks);
  if (sameOccupiedBadBlocks(want, have)) {
    return { ok: true, image, blocks: destWriteBlocks(image, destBad) };
  }
  const remapped = card.remapToBadBlocks(want);
  if (remapped === null) {
    return {
      ok: false,
      message: "The saves do not fit on this card with its bad-block list.",
    };
  }
  const out = remapped.getCardImage(true);
  return { ok: true, image: out, blocks: destWriteBlocks(out, destBad) };
}

// Conquest guard, before the first erase packet. Arcade SoulCalibur II
// Conquest cards have no PFS filesystem; the firmware erases on request, so
// the host must refuse here. The guard is fail-closed: a page-0 read that
// does not return a page cannot prove the card is not Conquest, so refuse
// too (erasing an unreadable Conquest card would destroy it).
async function readPs2Page0ForDestructive(
  nand: Pick<Ps2DestNand, "readPage">,
): Promise<DestResult<{ page0: Uint8Array }>> {
  const page0 = await nand.readPage(0);
  if (page0 === null) {
    return {
      ok: false,
      result: {
        status: "error",
        message:
          "Page 0 could not be read, so the card could not be checked for Conquest; the format/write was refused before any erase.",
      },
    };
  }
  if (isPs2ConquestCard(page0)) {
    return {
      ok: false,
      result: {
        status: "error",
        message:
          "The card is a SoulCalibur II Conquest card with no PFS filesystem; it was refused before any erase or write.",
      },
    };
  }
  return { ok: true, page0 };
}

/**
 * Keep the on-disk `0xD0` list when page 0 is formatted; otherwise spare-scan
 * erase blocks 1 … n−1 (at most 14 hits).
 */
async function destSkipList(
  nand: Pick<Ps2DestNand, "readPage">,
  specs: Ps2CardSpecs,
): Promise<DestResult<{ skip: number[] }>> {
  const page0r = await readPs2Page0ForDestructive(nand);
  if (!page0r.ok) return page0r;
  const blockCount = specs.pageCount / PAGES_PER_BLOCK;
  const list = readBadBlockListFromPage(page0r.page0);
  if (list !== null) {
    return { ok: true, skip: occupiedBadBlocks(list, blockCount) };
  }
  const scanned = await scanSpareMarkedEraseBlocksAsync(blockCount, (page) =>
    nand.readPage(page),
  );
  if (!scanned.ok) {
    return {
      ok: false,
      result: {
        status: "error",
        message: `Page ${scanned.page} could not be read, so the spare scan could not finish.`,
      },
    };
  }
  return { ok: true, skip: scanned.hits };
}

async function programPs2Block(
  nand: Pick<Ps2DestNand, "writePage">,
  image: Uint8Array,
  block: number,
  specs: Ps2CardSpecs,
  onPage: () => void,
): Promise<Ps2CardImageResult | null> {
  const blockStart = block * PAGES_PER_BLOCK;
  const blockEnd = blockStart + PAGES_PER_BLOCK;
  for (let page = blockStart; page < blockEnd; page++) {
    const ok = await nand.writePage(
      page,
      image.subarray(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    );
    if (!ok) {
      return {
        status: "error",
        message: `Failed to write page ${page} of ${specs.pageCount}.`,
      };
    }
    onPage();
  }
  return null;
}

function eraseFailed(block: number, blockCount: number): Ps2CardImageResult {
  return {
    status: "error",
    message: `Failed to erase block ${block} of ${blockCount}.`,
  };
}

function destProgress(
  stepCount: number,
  onProgress: (progress: number) => void,
): () => void {
  let step = 0;
  return () => {
    step++;
    onProgress(step / stepCount);
  };
}

async function eraseBlocks(
  nand: Pick<Ps2DestNand, "eraseBlock">,
  blocks: readonly number[],
  specs: Ps2CardSpecs,
  onStep: () => void,
): Promise<Ps2CardImageResult | null> {
  const blockCount = specs.pageCount / PAGES_PER_BLOCK;
  for (const block of blocks) {
    const erased = await nand.eraseBlock(block);
    if (!erased) return eraseFailed(block, blockCount);
    onStep();
  }
  return null;
}

/** Erase `toErase`, then program `toProgram` from `image`. */
async function eraseThenProgram(
  nand: Ps2DestNand,
  image: Uint8Array,
  toErase: readonly number[],
  toProgram: readonly number[],
  specs: Ps2CardSpecs,
  onProgress: (progress: number) => void,
): Promise<Ps2CardImageResult | null> {
  const tick = destProgress(
    toErase.length + toProgram.length * PAGES_PER_BLOCK,
    onProgress,
  );
  const erased = await eraseBlocks(nand, toErase, specs, tick);
  if (erased) return erased;
  for (const block of toProgram) {
    const fail = await programPs2Block(nand, image, block, specs, tick);
    if (fail) return fail;
  }
  return null;
}

async function eraseAndProgramBlocks(
  nand: Ps2DestNand,
  image: Uint8Array,
  blocks: readonly number[],
  specs: Ps2CardSpecs,
  onProgress: (progress: number) => void,
): Promise<Ps2CardImageResult | null> {
  const blockCount = specs.pageCount / PAGES_PER_BLOCK;
  const tick = destProgress(blocks.length * (1 + PAGES_PER_BLOCK), onProgress);
  for (const block of blocks) {
    const erased = await nand.eraseBlock(block);
    if (!erased) return eraseFailed(block, blockCount);
    tick();
    const fail = await programPs2Block(nand, image, block, specs, tick);
    if (fail) return fail;
  }
  return null;
}

function format2Image(
  specs: Ps2CardSpecs,
  skip: readonly number[],
): DestResult<{ image: Uint8Array }> {
  const clusters = specs.pageCount / PAGES_PER_CLUSTER;
  try {
    return { ok: true, image: format2(clusters, PS2MemoryCard.nowJst(), skip) };
  } catch {
    return {
      ok: false,
      result: {
        status: "error",
        message: "The PS2 card's bad-block list leaves no usable filesystem.",
      },
    };
  }
}

function formatGeometryError(specs: Ps2CardSpecs): Ps2CardImageResult | null {
  const geo = ps2DestGeometryError(specs);
  if (geo) return geo;
  const clusters = specs.pageCount / PAGES_PER_CLUSTER;
  const blockClusters = PAGES_PER_BLOCK * PAGES_PER_CLUSTER;
  if (
    !Number.isInteger(clusters) ||
    clusters < 64 ||
    clusters % blockClusters !== 0
  ) {
    return {
      status: "error",
      message:
        "The PS2 card geometry is not block-aligned, so the formatted image would not match the card; refusing to format.",
    };
  }
  return null;
}

/**
 * Keep the on-disk `0xD0` list when page 0 is formatted; otherwise spare-scan.
 * Build format2 with that list. Quick programs only filesystem erase blocks,
 * like the PS3 Utility. Full erases every unlisted block first. An erase `'f'`
 * aborts (the list is not updated).
 */
export async function formatPs2DestCard(
  nand: Ps2DestNand,
  specs: Ps2CardSpecs,
  onProgress: (progress: number) => void,
  quick: boolean,
): Promise<Ps2CardImageResult> {
  const geo = formatGeometryError(specs);
  if (geo) return geo;
  const listr = await destSkipList(nand, specs);
  if (!listr.ok) return listr.result;
  const built = format2Image(specs, listr.skip);
  if (!built.ok) return built.result;
  const writeBlocks = destWriteBlocks(built.image, listr.skip);
  const toErase = quick
    ? writeBlocks
    : unlistedEraseBlocks(specs.pageCount / PAGES_PER_BLOCK, listr.skip);
  const fail = await eraseThenProgram(
    nand,
    built.image,
    toErase,
    writeBlocks,
    specs,
    onProgress,
  );
  if (fail) return fail;
  return { status: "ok", image: built.image, specs };
}

/**
 * Dest list wins. Remap live saves onto it (same list keeps the source bytes).
 * Program only pages the prepared image actually wrote, except an unparseable
 * dump onto an empty dest list which is 1:1 of every unlisted block.
 */
export async function writePs2DestCard(
  nand: Ps2DestNand,
  image: Uint8Array,
  specs: Ps2CardSpecs,
  onProgress: (progress: number) => void,
): Promise<Ps2CardImageResult> {
  const geo = ps2DestGeometryError(specs);
  if (geo) return geo;
  if (image.length !== specs.pageCount * PAGE_SIZE) {
    return {
      status: "error",
      message: "The PS2 card image size does not match the card in the slot.",
    };
  }
  const listr = await destSkipList(nand, specs);
  if (!listr.ok) return listr.result;
  const prepared = preparePs2ImageForDest(image, listr.skip);
  if (!prepared.ok) return { status: "error", message: prepared.message };
  const fail = await eraseAndProgramBlocks(
    nand,
    prepared.image,
    prepared.blocks,
    specs,
    onProgress,
  );
  if (fail) return fail;
  return { status: "ok", image: prepared.image, specs };
}
