import {
  destAllBlocks,
  destWriteBlocks,
  formatPs2DestCard,
  preparePs2ImageForDest,
  unlistedEraseBlocks,
  writePs2DestCard,
  type Ps2DestNand,
} from "@/lib/ps2/ps2-dest-write";
import {
  format2,
  FRESH_ROOT_TIME,
  occupiedBadBlocks,
  PAGE_SIZE,
  PAGES_PER_BLOCK,
  readBadBlockListFromPage,
} from "@/lib/ps2/ps2-pfs";
import type { Ps2CardSpecs } from "@/lib/ps2/ps2-types";

function erasedPage(): Uint8Array {
  return new Uint8Array(PAGE_SIZE).fill(0xff);
}

function page0WithBad(bad: number[]): Uint8Array {
  const page = erasedPage();
  page.set(new TextEncoder().encode("Sony PS2 Memory Card Format "), 0);
  for (let i = 0; i < 32; i++) {
    const o = 0xd0 + i * 4;
    const b = i < bad.length ? bad[i] >>> 0 : 0xffffffff;
    page[o] = b & 0xff;
    page[o + 1] = (b >>> 8) & 0xff;
    page[o + 2] = (b >>> 16) & 0xff;
    page[o + 3] = (b >>> 24) & 0xff;
  }
  return page;
}

function markedSparePage(): Uint8Array {
  const page = erasedPage();
  page[512] = 0x00;
  return page;
}

function expectProgressTicks(seen: number[], workSteps: number) {
  expect(seen).toHaveLength(workSteps);
  for (let i = 0; i < workSteps; i++) {
    expect(seen[i]).toBeCloseTo((i + 1) / workSteps, 10);
  }
}

describe("ps2 dest write helpers", () => {
  const specs: Ps2CardSpecs = {
    flags: 0x2b,
    pageSize: 512,
    blockPages: 16,
    pageCount: 128,
  };

  function formatNand(
    page0: Uint8Array,
    extras?: Partial<{
      pages: Map<number, Uint8Array>;
      eraseOk: (block: number) => boolean;
    }>,
  ): {
    nand: Ps2DestNand;
    erased: number[];
    programmed: number[];
    ops: Array<"erase" | "program">;
  } {
    const erased: number[] = [];
    const programmed: number[] = [];
    const ops: Array<"erase" | "program"> = [];
    const pages = extras?.pages ?? new Map<number, Uint8Array>();
    const nand: Ps2DestNand = {
      readPage: async (page) => {
        if (page === 0) return await Promise.resolve(page0);
        const planted = pages.get(page);
        if (planted) return await Promise.resolve(planted);
        return await Promise.resolve(erasedPage());
      },
      writePage: async (page) => {
        programmed.push(page >>> 4);
        ops.push("program");
        return await Promise.resolve(true);
      },
      eraseBlock: async (block) => {
        erased.push(block);
        ops.push("erase");
        return await Promise.resolve(extras?.eraseOk?.(block) ?? true);
      },
    };
    return { nand, erased, programmed, ops };
  }

  it("picks only blocks with a programmed page and writes block 0 last", () => {
    const image = new Uint8Array(8 * 16 * PAGE_SIZE).fill(0xff);
    image[0] = 0x11;
    image[3 * 16 * PAGE_SIZE] = 0x22;
    expect(destWriteBlocks(image, [])).toEqual([3, 0]);
    expect(destWriteBlocks(image, [3])).toEqual([0]);
    const full = new Uint8Array(8 * 16 * PAGE_SIZE);
    expect(destWriteBlocks(full, [3])).toEqual(destAllBlocks(8, [3]));
    expect(destWriteBlocks(full, [])).toEqual(destAllBlocks(8, []));
  });

  it("lists every unlisted block, with destAllBlocks writing block 0 last", () => {
    expect(unlistedEraseBlocks(8, [3])).toEqual([0, 1, 2, 4, 5, 6, 7]);
    expect(destAllBlocks(8, [3])).toEqual([1, 2, 4, 5, 6, 7, 0]);
    expect(destAllBlocks(8, [])).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
  });

  it("write refuses a size mismatch before erase", async () => {
    const nand: Ps2DestNand = {
      readPage: async () => await Promise.resolve(page0WithBad([])),
      writePage: async () => await Promise.reject(new Error("write")),
      eraseBlock: async () => await Promise.reject(new Error("erase")),
    };
    const r = await writePs2DestCard(nand, new Uint8Array(16), specs, () => {});
    expect(r).toMatchObject({
      status: "error",
      message: "The PS2 card image size does not match the card in the slot.",
    });
  });

  it("format refuses when page 0 cannot be read", async () => {
    const nand: Ps2DestNand = {
      readPage: async () => await Promise.resolve(null),
      writePage: async () => await Promise.resolve(false),
      eraseBlock: async () => await Promise.reject(new Error("erase")),
    };
    const r = await formatPs2DestCard(nand, specs, () => {}, true);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.message).toMatch(/Page 0 could not be read/);
  });

  it("format spare-scans an unformatted card and programs only filesystem blocks", async () => {
    const { nand, erased, programmed, ops } = formatNand(erasedPage(), {
      pages: new Map([
        [3 * 16, markedSparePage()],
        [3 * 16 + 1, erasedPage()],
      ]),
    });
    const r = await formatPs2DestCard(nand, specs, () => {}, true);
    expect(r.status).toBe("ok");
    const preview = format2(64, FRESH_ROOT_TIME, [3]);
    const writeBlocks = destWriteBlocks(preview, [3]);
    expect(erased).toEqual(writeBlocks);
    expect(ops.slice(0, writeBlocks.length)).toEqual(
      Array.from({ length: writeBlocks.length }, () => "erase"),
    );
    expect(ops.slice(writeBlocks.length).every((op) => op === "program")).toBe(
      true,
    );
    expect(new Set(programmed).has(3)).toBe(false);
    if (r.status !== "ok") return;
    const list = readBadBlockListFromPage(r.image.subarray(0, PAGE_SIZE));
    expect(list).not.toBeNull();
    if (list === null) return;
    expect(occupiedBadBlocks(list, 8)).toEqual([3]);
  });

  it("format spare-scan of an unformatted card stops at 14 listed blocks", async () => {
    const capSpecs: Ps2CardSpecs = {
      flags: 0x2b,
      pageSize: 512,
      blockPages: 16,
      pageCount: 512,
    };
    const pages = new Map<number, Uint8Array>();
    for (let block = 1; block <= 20; block++) {
      pages.set(block * PAGES_PER_BLOCK, markedSparePage());
      pages.set(block * PAGES_PER_BLOCK + 1, markedSparePage());
    }
    const { nand, erased, programmed } = formatNand(erasedPage(), { pages });
    const reads: number[] = [];
    const wrapped: Ps2DestNand = {
      readPage: async (page) => {
        reads.push(page);
        return nand.readPage(page);
      },
      writePage: nand.writePage,
      eraseBlock: nand.eraseBlock,
    };
    const r = await formatPs2DestCard(wrapped, capSpecs, () => {}, true);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const listed = Array.from({ length: 14 }, (_, i) => i + 1);
    const list = readBadBlockListFromPage(r.image.subarray(0, PAGE_SIZE));
    expect(list).not.toBeNull();
    if (list === null) return;
    expect(occupiedBadBlocks(list, 32)).toEqual(listed);
    for (const block of listed) {
      expect(erased.includes(block)).toBe(false);
      expect(new Set(programmed).has(block)).toBe(false);
    }
    expect(reads).toContain(0);
    expect(reads).toContain(14 * PAGES_PER_BLOCK);
    expect(reads).not.toContain(15 * PAGES_PER_BLOCK);
  });

  it("format aborts when a spare-scan page cannot be read", async () => {
    const nand: Ps2DestNand = {
      readPage: async (page) => {
        if (page === 0) return await Promise.resolve(erasedPage());
        if (page === 16) return await Promise.resolve(erasedPage());
        if (page === 17) return await Promise.resolve(null);
        return await Promise.resolve(erasedPage());
      },
      writePage: async () => await Promise.resolve(false),
      eraseBlock: async () => await Promise.reject(new Error("erase")),
    };
    const r = await formatPs2DestCard(nand, specs, () => {}, true);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.message).toMatch(
      /Page 17 could not be read, so the spare scan could not finish/,
    );
  });

  it("full format erases every unlisted block before programming filesystem pages", async () => {
    const { nand, erased, programmed, ops } = formatNand(page0WithBad([3]));
    const r = await formatPs2DestCard(nand, specs, () => {}, false);
    expect(r.status).toBe("ok");
    const wipe = unlistedEraseBlocks(8, [3]);
    const preview = format2(64, FRESH_ROOT_TIME, [3]);
    const writeBlocks = destWriteBlocks(preview, [3]);
    expect(erased).toEqual(wipe);
    expect(ops.slice(0, wipe.length)).toEqual(
      Array.from({ length: wipe.length }, () => "erase"),
    );
    expect(ops.slice(wipe.length).every((op) => op === "program")).toBe(true);
    expect(new Set(programmed).has(3)).toBe(false);
    expect(new Set(programmed)).toEqual(new Set(writeBlocks));
  });

  it("format of a formatted card keeps 0xD0 and does not spare-scan", async () => {
    const reads: number[] = [];
    const { nand, erased, ops } = formatNand(page0WithBad([3]));
    const wrapped: Ps2DestNand = {
      readPage: async (page) => {
        reads.push(page);
        return nand.readPage(page);
      },
      writePage: nand.writePage,
      eraseBlock: nand.eraseBlock,
    };
    const r = await formatPs2DestCard(wrapped, specs, () => {}, true);
    expect(r.status).toBe("ok");
    expect(reads).toEqual([0]);
    const preview = format2(64, FRESH_ROOT_TIME, [3]);
    const writeBlocks = destWriteBlocks(preview, [3]);
    expect(erased).toEqual(writeBlocks);
    expect(ops.slice(0, writeBlocks.length).every((op) => op === "erase")).toBe(
      true,
    );
    expect(erased.includes(3)).toBe(false);
  });

  it("format aborts when a filesystem block erase returns 'f'", async () => {
    const seen: number[] = [];
    const { nand, erased } = formatNand(page0WithBad([]), {
      eraseOk: () => false,
    });
    const r = await formatPs2DestCard(nand, specs, (p) => seen.push(p), true);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.message).toMatch(/Failed to erase block/);
    expect(erased).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it("full format aborts on the first unlisted erase and does not program", async () => {
    const seen: number[] = [];
    const { nand, erased, programmed } = formatNand(page0WithBad([3]), {
      eraseOk: () => false,
    });
    const r = await formatPs2DestCard(nand, specs, (p) => seen.push(p), false);
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.message).toBe("Failed to erase block 0 of 8.");
    expect(erased).toEqual([0]);
    expect(programmed).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("write of format2 onto a listed dest skips that block", async () => {
    const { nand, erased, programmed } = formatNand(page0WithBad([3]));
    const image = format2(64, FRESH_ROOT_TIME);
    const r = await writePs2DestCard(nand, image, specs, () => {});
    expect(r.status).toBe("ok");
    const prepared = preparePs2ImageForDest(image, [3]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(erased).toEqual(prepared.blocks);
    expect(prepared.blocks).toEqual(destWriteBlocks(prepared.image, [3]));
    expect(new Set(programmed).has(3)).toBe(false);
  });

  it("quick format, full format, and write share the same progress ticks", async () => {
    const skip = [3];
    const preview = format2(64, FRESH_ROOT_TIME, skip);
    const writeBlocks = destWriteBlocks(preview, skip);
    const wipe = unlistedEraseBlocks(8, skip);
    const pages = specs.blockPages;

    const quickSeen: number[] = [];
    const { nand: quickNand } = formatNand(page0WithBad(skip));
    expect(
      (
        await formatPs2DestCard(
          quickNand,
          specs,
          (p) => quickSeen.push(p),
          true,
        )
      ).status,
    ).toBe("ok");
    expectProgressTicks(
      quickSeen,
      writeBlocks.length + writeBlocks.length * pages,
    );

    const fullSeen: number[] = [];
    const { nand: fullNand } = formatNand(page0WithBad(skip));
    expect(
      (await formatPs2DestCard(fullNand, specs, (p) => fullSeen.push(p), false))
        .status,
    ).toBe("ok");
    expectProgressTicks(fullSeen, wipe.length + writeBlocks.length * pages);

    const writeSeen: number[] = [];
    const { nand: writeNand } = formatNand(page0WithBad(skip));
    const image = format2(64, FRESH_ROOT_TIME);
    const prepared = preparePs2ImageForDest(image, skip);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(
      (
        await writePs2DestCard(writeNand, image, specs, (p) =>
          writeSeen.push(p),
        )
      ).status,
    ).toBe("ok");
    expectProgressTicks(writeSeen, prepared.blocks.length * (1 + pages));
  });

  it("write of an unparseable dump programs every unlisted block", async () => {
    const image = new Uint8Array(specs.pageCount * PAGE_SIZE).fill(0xff);
    image[0] = 0x00;
    const { nand, erased } = formatNand(erasedPage());
    const r = await writePs2DestCard(nand, image, specs, () => {});
    expect(r.status).toBe("ok");
    expect(erased).toEqual(destAllBlocks(8, []));
    expect(erased).not.toEqual(destWriteBlocks(image, []));
  });
});

describe("preparePs2ImageForDest", () => {
  it("keeps an unparseable image when dest has no bad blocks", () => {
    const image = new Uint8Array(32 * PAGE_SIZE);
    const r = preparePs2ImageForDest(image, []);
    expect(r).toEqual({
      ok: true,
      image,
      blocks: destAllBlocks(image.length / PAGE_SIZE / PAGES_PER_BLOCK, []),
    });
  });

  it("refuses an unparseable image when dest has bad blocks", () => {
    const r = preparePs2ImageForDest(new Uint8Array(32 * PAGE_SIZE), [1]);
    expect(r.ok).toBe(false);
  });

  it("returns the source bytes when the dest list already matches", () => {
    const image = format2(64, FRESH_ROOT_TIME, [3]);
    const r = preparePs2ImageForDest(image, [3]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.image).toBe(image);
      expect(r.blocks).toEqual(destWriteBlocks(image, [3]));
    }
  });
});
