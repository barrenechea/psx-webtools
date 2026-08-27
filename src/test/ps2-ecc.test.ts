// 20-bit Hamming ECC for PS2 card pages. Golden vectors: the codes the real
// hardware stored for two 128-byte chunks of the superblock page (self-
// contained hex below), plus the all-FF / all-zero constant and round-trips.

import {
  assembleImagePage,
  calcEcc,
  checkPage,
  ECC_ALL_FF_CODE,
  ECC_CHUNK_SIZE,
  ECC_PAGE_DATA_SIZE,
  ECC_PAGE_SIZE,
  pageSpare,
} from "@/lib/ps2/ps2-ecc";

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// First 128 bytes of a real card's superblock page (magic + header fields).
const REAL_CHUNK0 =
  "536f6e7920505332204d656d6f7279204361726420466f726d617420312e322e302e30000000000000020200100000ff0020000029000000c71f000000000000ff030000fe0300000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
// Third 128-byte chunk of the same page (tail of the superblock, zero padded).
const REAL_CHUNK2 =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff022b0000000400000001000008000000ffffffff000000000000000000000000411f00000000000000000000ffffffff";

describe("ps2-ecc", () => {
  it("reproduces the hardware code for a real superblock chunk", () => {
    expect([...calcEcc(fromHex(REAL_CHUNK0))]).toEqual([0x07, 0x34, 0x4b]);
    expect([...calcEcc(fromHex(REAL_CHUNK2))]).toEqual([0x25, 0x71, 0x0e]);
  });

  it("all-FF and all-zero chunks code to the erased constant", () => {
    expect([...calcEcc(new Uint8Array(ECC_CHUNK_SIZE).fill(0xff))]).toEqual([
      ...ECC_ALL_FF_CODE,
    ]);
    expect([...calcEcc(new Uint8Array(ECC_CHUNK_SIZE))]).toEqual([
      0x77, 0x7f, 0x7f,
    ]);
  });

  it("pageSpare places the four chunk codes in order and zero-pads", () => {
    const data = new Uint8Array(ECC_PAGE_DATA_SIZE);
    data.set(fromHex(REAL_CHUNK0), 0); // chunk 0 = real header
    data.set(new Uint8Array(ECC_CHUNK_SIZE).fill(0xff), ECC_CHUNK_SIZE); // chunk 1 = FF
    data.set(fromHex(REAL_CHUNK2), 2 * ECC_CHUNK_SIZE); // chunk 2 = real tail
    // chunk 3 stays all-zero
    const spare = pageSpare(data);
    expect(spare.length).toBe(16);
    expect([...spare.slice(0, 3)]).toEqual([0x07, 0x34, 0x4b]);
    expect([...spare.slice(3, 6)]).toEqual([0x77, 0x7f, 0x7f]);
    expect([...spare.slice(6, 9)]).toEqual([0x25, 0x71, 0x0e]);
    expect([...spare.slice(9, 12)]).toEqual([0x77, 0x7f, 0x7f]);
    expect([...spare.slice(12, 16)]).toEqual([0, 0, 0, 0]);
  });

  it("checkPage: a freshly written page validates", () => {
    const page = new Uint8Array(ECC_PAGE_SIZE);
    for (let i = 0; i < ECC_PAGE_DATA_SIZE; i++) page[i] = (i * 31 + 7) & 0xff;
    page.set(
      pageSpare(page.subarray(0, ECC_PAGE_DATA_SIZE)),
      ECC_PAGE_DATA_SIZE,
    );
    expect(checkPage(page)).toBe("valid");
  });

  it("checkPage: a never-written page is erased", () => {
    expect(checkPage(new Uint8Array(ECC_PAGE_SIZE).fill(0xff))).toBe("erased");
  });

  it("checkPage: a written all-FF data page is valid, not erased", () => {
    const page = new Uint8Array(ECC_PAGE_SIZE).fill(0xff);
    page.set(
      pageSpare(new Uint8Array(ECC_PAGE_DATA_SIZE).fill(0xff)),
      ECC_PAGE_DATA_SIZE,
    );
    expect(checkPage(page)).toBe("valid");
  });

  it("checkPage: a flipped data bit or spare bit is corrupt", () => {
    const page = new Uint8Array(ECC_PAGE_SIZE);
    for (let i = 0; i < ECC_PAGE_DATA_SIZE; i++) page[i] = (i * 13) & 0xff;
    page.set(
      pageSpare(page.subarray(0, ECC_PAGE_DATA_SIZE)),
      ECC_PAGE_DATA_SIZE,
    );
    expect(checkPage(page)).toBe("valid");

    const dataCorrupt = new Uint8Array(page);
    dataCorrupt[5] ^= 0x01;
    expect(checkPage(dataCorrupt)).toBe("corrupt");

    const spareCorrupt = new Uint8Array(page);
    spareCorrupt[ECC_PAGE_DATA_SIZE + 1] ^= 0x40;
    expect(checkPage(spareCorrupt)).toBe("corrupt");
  });

  it("calcEcc rejects a short input", () => {
    expect(() => calcEcc(new Uint8Array(ECC_CHUNK_SIZE - 1))).toThrow();
  });

  it("assembleImagePage keeps a provided spare and synthesizes a missing one", () => {
    const data = new Uint8Array(ECC_PAGE_DATA_SIZE);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    const spare = pageSpare(data);
    const withSpare = assembleImagePage(data, spare);
    expect(withSpare.length).toBe(ECC_PAGE_SIZE);
    expect([...withSpare.subarray(ECC_PAGE_DATA_SIZE)]).toEqual([...spare]);
    expect(checkPage(withSpare)).toBe("valid");

    const synthesized = assembleImagePage(data);
    expect([...synthesized]).toEqual([...withSpare]);

    const erased = assembleImagePage(
      new Uint8Array(ECC_PAGE_DATA_SIZE).fill(0xff),
    );
    expect(checkPage(erased)).toBe("erased");
  });
});
