import {
  destOccupiedSkip,
  formatPs2DestCard,
  preparePs2ImageForDest,
  ps2SkipListTooLong,
  surveyPs2EraseBlocks,
  writePs2DestCard,
  type Ps2DestNand,
} from "@/lib/ps2/ps2-dest-write";
import { format2, FRESH_ROOT_TIME, PAGE_SIZE } from "@/lib/ps2/ps2-pfs";
import type { Ps2CardSpecs } from "@/lib/ps2/ps2-types";

function page0WithBad(bad: number[]): Uint8Array {
  const page = new Uint8Array(PAGE_SIZE).fill(0xff);
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

describe("ps2 dest skip list", () => {
  it("reads occupied dest blocks from page 0", () => {
    expect(destOccupiedSkip(page0WithBad([800, 816]), 1024)).toEqual([
      800, 816,
    ]);
    expect(destOccupiedSkip(new Uint8Array(PAGE_SIZE).fill(0xff), 8)).toEqual(
      [],
    );
  });

  it("caps the skip list at 32 occupied blocks", () => {
    expect(ps2SkipListTooLong([1, 2, 3])).toBeNull();
    const skip = Array.from({ length: 33 }, (_, i) => i + 1);
    expect(ps2SkipListTooLong(skip)).toMatchObject({
      status: "error",
      message:
        "The PS2 card has 33 bad erase blocks; the filesystem can list at most 32.",
    });
  });

  it("survey aborts when live 'f' results would exceed 32 listed blocks", async () => {
    const nand: Pick<Ps2DestNand, "eraseBlock"> = {
      eraseBlock: async (block) => await Promise.resolve(block === 0),
    };
    const r = await surveyPs2EraseBlocks(nand, 40, [], () => {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.result.status).toBe("error");
    if (r.result.status !== "error") return;
    expect(r.result.message).toMatch(/at most 32/);
  });
});

describe("ps2 dest write helpers", () => {
  const specs: Ps2CardSpecs = {
    flags: 0x2b,
    pageSize: 512,
    blockPages: 16,
    pageCount: 128,
  };

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
    const r = await formatPs2DestCard(nand, specs, () => {});
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.message).toMatch(/Page 0 could not be read/);
  });

  it("format builds a skip list from a live 'f'", async () => {
    const erased: number[] = [];
    const nand: Ps2DestNand = {
      readPage: async () => await Promise.resolve(page0WithBad([])),
      writePage: async () => await Promise.resolve(true),
      eraseBlock: async (block) => {
        erased.push(block);
        return await Promise.resolve(block !== 3);
      },
    };
    const r = await formatPs2DestCard(nand, specs, () => {});
    expect(r.status).toBe("ok");
    expect(erased).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    if (r.status !== "ok") return;
    expect(destOccupiedSkip(r.image.subarray(0, PAGE_SIZE), 8)).toEqual([3]);
  });

  it("write of format2 onto a listed dest skips that block", async () => {
    const erased: number[] = [];
    const programmed: number[] = [];
    const nand: Ps2DestNand = {
      readPage: async () => await Promise.resolve(page0WithBad([3])),
      writePage: async (page) => {
        programmed.push(page >>> 4);
        return await Promise.resolve(true);
      },
      eraseBlock: async (block) => {
        erased.push(block);
        return await Promise.resolve(true);
      },
    };
    const r = await writePs2DestCard(
      nand,
      format2(64, FRESH_ROOT_TIME),
      specs,
      () => {},
    );
    expect(r.status).toBe("ok");
    expect(erased).toEqual([0, 1, 2, 4, 5, 6, 7]);
    expect(new Set(programmed).has(3)).toBe(false);
  });
});

describe("preparePs2ImageForDest", () => {
  it("keeps an unparseable image when dest has no bad blocks", () => {
    const image = new Uint8Array(32 * PAGE_SIZE);
    const r = preparePs2ImageForDest(image, []);
    expect(r).toEqual({ ok: true, image });
  });

  it("refuses an unparseable image when dest has bad blocks", () => {
    const r = preparePs2ImageForDest(new Uint8Array(32 * PAGE_SIZE), [1]);
    expect(r.ok).toBe(false);
  });

  it("returns the source bytes when the dest list already matches", () => {
    const image = format2(64, FRESH_ROOT_TIME, [3]);
    const r = preparePs2ImageForDest(image, [3]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.image).toBe(image);
  });
});
