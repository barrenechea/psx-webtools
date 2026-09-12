import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { isPs2ConquestCard } from "@/lib/ps2/ps2-conquest";
import {
  BAD_BLOCK_SLOTS,
  eraseBlockCount,
  format2,
  occupiedBadBlocks,
  PAGE_SIZE,
  PAGES_PER_BLOCK,
  PAGES_PER_CLUSTER,
  readBadBlockListFromPage,
  sameOccupiedBadBlocks,
} from "@/lib/ps2/ps2-pfs";
import type { Ps2CardImageResult, Ps2CardSpecs } from "@/lib/ps2/ps2-types";

export type Ps2DestNand = {
  readPage: (page: number) => Promise<Uint8Array | null>;
  writePage: (page: number, data: Uint8Array) => Promise<boolean>;
  eraseBlock: (block: number) => Promise<boolean>;
};

type Ps2Page0Guard =
  | { ok: true; page0: Uint8Array }
  | { ok: false; result: Ps2CardImageResult };

type Ps2SkipSurvey =
  | { ok: true; skip: number[] }
  | { ok: false; result: Ps2CardImageResult };

type Ps2DestSeed =
  | { ok: true; seed: number[] }
  | { ok: false; result: Ps2CardImageResult };

type Ps2ImageBuild =
  | { ok: true; image: Uint8Array }
  | { ok: false; result: Ps2CardImageResult };

export type PreparePs2ImageResult =
  | { ok: true; image: Uint8Array }
  | { ok: false; message: string };

/** Occupied dest skip list from page 0's superblock `0xD0` slots. */
export function destOccupiedSkip(
  page0: Uint8Array,
  blockCount: number,
): number[] {
  return occupiedBadBlocks(readBadBlockListFromPage(page0) ?? [], blockCount);
}

/**
 * Relocate a dump onto the destination card's live bad-block list. Same list
 * keeps the source bytes. An unparseable image is only writable when the dest
 * list is empty (1:1 program of every block).
 */
export function preparePs2ImageForDest(
  image: Uint8Array,
  destBad: readonly number[],
): PreparePs2ImageResult {
  const card = PS2MemoryCard.tryFromBytes(image);
  if (card === null) {
    if (destBad.length === 0) return { ok: true, image };
    return {
      ok: false,
      message:
        "The card image is not a PS2 filesystem, so it cannot be relocated around the card's bad blocks.",
    };
  }
  const blocks = eraseBlockCount(card.getSuperblock().clustersPerCard);
  const want = occupiedBadBlocks(destBad, blocks);
  const have = occupiedBadBlocks(card.getSuperblock().badBlockList, blocks);
  if (sameOccupiedBadBlocks(want, have)) return { ok: true, image };
  const remapped = card.remapToBadBlocks(want);
  if (remapped === null) {
    return {
      ok: false,
      message: "The saves do not fit on this card with its bad-block list.",
    };
  }
  return { ok: true, image: remapped.getCardImage(true) };
}

export function ps2SkipListTooLong(
  skip: readonly number[],
): Ps2CardImageResult | null {
  if (skip.length <= BAD_BLOCK_SLOTS) return null;
  return {
    status: "error",
    message: `The PS2 card has ${skip.length} bad erase blocks; the filesystem can list at most ${BAD_BLOCK_SLOTS}.`,
  };
}

export function ps2DestGeometryError(
  specs: Ps2CardSpecs,
): Ps2CardImageResult | null {
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

// Conquest guard, before the first erase packet. Arcade SoulCalibur II
// Conquest cards have no PFS filesystem; the firmware erases on request, so
// the host must refuse here. The guard is fail-closed: a page-0 read that
// does not return a page cannot prove the card is not Conquest, so refuse
// too (erasing an unreadable Conquest card would destroy it).
export async function readPs2Page0ForDestructive(
  nand: Pick<Ps2DestNand, "readPage">,
): Promise<Ps2Page0Guard> {
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

async function destSeedFromPage0(
  nand: Pick<Ps2DestNand, "readPage">,
  specs: Ps2CardSpecs,
): Promise<Ps2DestSeed> {
  const page0r = await readPs2Page0ForDestructive(nand);
  if (!page0r.ok) return page0r;
  return {
    ok: true,
    seed: destOccupiedSkip(page0r.page0, specs.pageCount / PAGES_PER_BLOCK),
  };
}

/**
 * Skip `seed` (those blocks are not erased) and any live `'f'`. Block 0 erase
 * failure is fatal. Growing past {@link BAD_BLOCK_SLOTS} aborts. `onBlock` is
 * called after each erase-block index is decided.
 */
export async function surveyPs2EraseBlocks(
  nand: Pick<Ps2DestNand, "eraseBlock">,
  blockCount: number,
  seed: readonly number[],
  onBlock: (block: number, blockCount: number) => void,
): Promise<Ps2SkipSurvey> {
  const skip = new Set(occupiedBadBlocks(seed, blockCount));
  const cap = ps2SkipListTooLong([...skip]);
  if (cap) return { ok: false, result: cap };

  for (let block = 0; block < blockCount; block++) {
    if (skip.has(block)) {
      onBlock(block, blockCount);
      continue;
    }
    const erased = await nand.eraseBlock(block);
    if (!erased) {
      if (block === 0) {
        return {
          ok: false,
          result: {
            status: "error",
            message: `Failed to erase block 0 of ${blockCount}.`,
          },
        };
      }
      skip.add(block);
      const grown = ps2SkipListTooLong([...skip]);
      if (grown) return { ok: false, result: grown };
    }
    onBlock(block, blockCount);
  }
  return { ok: true, skip: occupiedBadBlocks([...skip], blockCount) };
}

async function programPs2Block(
  nand: Pick<Ps2DestNand, "writePage">,
  image: Uint8Array,
  block: number,
  specs: Ps2CardSpecs,
  onPage: (page: number) => void,
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
    onPage(page);
  }
  return null;
}

async function programPs2SkippedImage(
  nand: Pick<Ps2DestNand, "writePage">,
  image: Uint8Array,
  skip: readonly number[],
  specs: Ps2CardSpecs,
  onProgress: (progress: number) => void,
): Promise<Ps2CardImageResult | null> {
  const blockCount = specs.pageCount / PAGES_PER_BLOCK;
  const skipSet = new Set(skip);
  const steps = blockCount * 2;
  for (let block = 0; block < blockCount; block++) {
    if (!skipSet.has(block)) {
      const fail = await programPs2Block(nand, image, block, specs, (page) => {
        onProgress((blockCount + (page + 1) / PAGES_PER_BLOCK) / steps);
      });
      if (fail) return fail;
    }
    onProgress((blockCount + block + 1) / steps);
  }
  return null;
}

async function eraseThenProgram(
  nand: Ps2DestNand,
  specs: Ps2CardSpecs,
  seed: readonly number[],
  build: (skip: readonly number[]) => Ps2ImageBuild,
  onProgress: (progress: number) => void,
): Promise<Ps2CardImageResult> {
  const blockCount = specs.pageCount / PAGES_PER_BLOCK;
  const steps = blockCount * 2;
  const surveyed = await surveyPs2EraseBlocks(nand, blockCount, seed, (block) =>
    onProgress((block + 1) / steps),
  );
  if (!surveyed.ok) return surveyed.result;
  const built = build(surveyed.skip);
  if (!built.ok) return built.result;
  const programmed = await programPs2SkippedImage(
    nand,
    built.image,
    surveyed.skip,
    specs,
    onProgress,
  );
  if (programmed) return programmed;
  return { status: "ok", image: built.image, specs };
}

function format2Image(
  specs: Ps2CardSpecs,
  skip: readonly number[],
): Ps2ImageBuild {
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

/**
 * Survey erase, build format2 with the skip list, then program good blocks.
 * Listed bad blocks are left listed and not erased. Block 0 erase failure
 * is fatal. Other `'f'` results join the skip list.
 */
export async function formatPs2DestCard(
  nand: Ps2DestNand,
  specs: Ps2CardSpecs,
  onProgress: (progress: number) => void,
): Promise<Ps2CardImageResult> {
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
  const seedr = await destSeedFromPage0(nand, specs);
  if (!seedr.ok) return seedr.result;
  return eraseThenProgram(
    nand,
    specs,
    seedr.seed,
    (skip) => format2Image(specs, skip),
    onProgress,
  );
}

/**
 * Dest skip list wins. Fit-check against page 0 before erase; if skip grows
 * during survey, remap again. Same list keeps the source bytes.
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
  const seedr = await destSeedFromPage0(nand, specs);
  if (!seedr.ok) return seedr.result;
  const pre = preparePs2ImageForDest(image, seedr.seed);
  if (!pre.ok) return { status: "error", message: pre.message };
  return eraseThenProgram(
    nand,
    specs,
    seedr.seed,
    (skip) => {
      const prepared = sameOccupiedBadBlocks(skip, seedr.seed)
        ? pre
        : preparePs2ImageForDest(image, skip);
      if (!prepared.ok) {
        return {
          ok: false,
          result: { status: "error", message: prepared.message },
        };
      }
      return { ok: true, image: prepared.image };
    },
    onProgress,
  );
}
