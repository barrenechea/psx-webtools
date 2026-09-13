// Spare-scan of PS2 NAND: erase blocks 1 … n−1, at most SPARE_SCAN_MAX hits.
// Image format2 and live dest format share this walk. Unreadable NAND is
// handled by the async pump before it feeds the walk.

import { ECC_PAGE_DATA_SIZE, ECC_PAGE_SIZE } from "./ps2-ecc";

/** Spare-scan hit cap (blocks 1 … n−1). A reformat keeps the full 32-slot list. */
const SPARE_SCAN_MAX = 14;

const PAGE_SIZE = ECC_PAGE_SIZE;
const PAGE_DATA_SIZE = ECC_PAGE_DATA_SIZE;
/** Same 16-page erase block as `PAGES_PER_BLOCK` in the filesystem module. */
const PAGES_PER_BLOCK = 16;

type SpareScanResult =
  | { ok: true; hits: number[] }
  | { ok: false; page: number };

function pageSpareIsMarked(page: Uint8Array): boolean {
  const end = Math.min(page.length, PAGE_SIZE);
  for (let i = PAGE_DATA_SIZE; i < end; i++) {
    if (page[i] !== 0xff) return true;
  }
  return false;
}

/**
 * Yields page indices; the pump feeds page bytes. A block is listed when page
 * 0 or page 1 has a spare byte ≠ 0xFF. Block 0 is not inspected, so a
 * programmed superblock Hamming spare is not treated as a defect.
 */
function* spareScanSteps(
  blockCount: number,
): Generator<number, number[], Uint8Array> {
  const hits: number[] = [];
  for (
    let block = 1;
    block < blockCount && hits.length < SPARE_SCAN_MAX;
    block++
  ) {
    const page0 = block * PAGES_PER_BLOCK;
    const data0 = yield page0;
    const data1 = yield page0 + 1;
    if (pageSpareIsMarked(data0) || pageSpareIsMarked(data1)) hits.push(block);
  }
  return hits;
}

export function scanSpareMarkedEraseBlocks(
  blockCount: number,
  readPage: (page: number) => Uint8Array,
): number[] {
  const steps = spareScanSteps(blockCount);
  let step = steps.next();
  while (!step.done) {
    step = steps.next(readPage(step.value));
  }
  return step.value;
}

/** Live NAND spare scan. Same walk as the image spare scan. */
export async function scanSpareMarkedEraseBlocksAsync(
  blockCount: number,
  readPage: (page: number) => Promise<Uint8Array | null>,
): Promise<SpareScanResult> {
  const steps = spareScanSteps(blockCount);
  let step = steps.next();
  while (!step.done) {
    const page = await readPage(step.value);
    if (page === null) return { ok: false, page: step.value };
    step = steps.next(page);
  }
  return { ok: true, hits: step.value };
}
