// LZA-R (the PS2 MAX single-save coder): round-trip and sizing checks.

import { lzariCompress, lzariDecompress } from "@/lib/ps2/ps2-lzari";

function randBytes(n: number, seed = 0x1234): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 8) & 0xff;
  }
  return out;
}

const eq = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

describe("ps2-lzari", () => {
  it("round-trips an empty buffer", () => {
    const src = new Uint8Array(0);
    expect(eq(lzariDecompress(lzariCompress(src), 0), src)).toBe(true);
  });

  it("round-trips a short literal-only buffer (< 60 B)", () => {
    const src = new TextEncoder().encode("hello world, ps2 save data");
    expect(eq(lzariDecompress(lzariCompress(src), src.length), src)).toBe(true);
  });

  it("round-trips and shrinks a highly repetitive buffer (matches)", () => {
    const block = new TextEncoder().encode(
      "The quick brown fox jumps over the lazy dog. ",
    );
    const src = new Uint8Array(4096);
    for (let i = 0; i < src.length; i++) src[i] = block[i % block.length];
    const compressed = lzariCompress(src);
    expect(compressed.length < src.length).toBe(true);
    expect(eq(lzariDecompress(compressed, src.length), src)).toBe(true);
  });

  it("round-trips a pseudo-random (incompressible) buffer", () => {
    const src = randBytes(2000, 0xabcd);
    expect(eq(lzariDecompress(lzariCompress(src), src.length), src)).toBe(true);
  });

  it("round-trips a mixed buffer (random runs + repeating runs)", () => {
    const block = new Uint8Array(300 + 512);
    block.set(randBytes(300, 7), 0);
    for (let i = 0; i < 512; i++) block[300 + i] = (i * 7) & 0xff;
    const src = new Uint8Array(0x4000);
    for (let i = 0; i < src.length; i++) src[i] = block[i % block.length];
    const compressed = lzariCompress(src);
    expect(eq(lzariDecompress(compressed, src.length), src)).toBe(true);
  });

  it("round-trips buffers of every small size", () => {
    for (let len = 1; len <= 130; len++) {
      const src = randBytes(len, len);
      const compressed = lzariCompress(src);
      expect(eq(lzariDecompress(compressed, len), src), `len=${len}`).toBe(
        true,
      );
    }
  });

  it("round-trips a > 4 KiB buffer (exercises the ring wrap)", () => {
    const src = new Uint8Array(0x8000);
    // compressible text run, then an incompressible run, to exercise both
    const text = new TextEncoder().encode(
      "The quick brown fox jumps over the lazy dog. 0123456789. ",
    );
    for (let i = 0; i < src.length / 2; i++) src[i] = text[i % text.length];
    const rand = randBytes(src.length - src.length / 2, 99);
    src.set(rand, src.length / 2);
    const compressed = lzariCompress(src);
    expect(compressed.length < src.length).toBe(true);
    expect(eq(lzariDecompress(compressed, src.length), src)).toBe(true);
  });

  // Goldens from Okumura LZARI.C / apollo-ps4 lzari.c (4/7/1989 parameters,
  // no 4-byte size prefix). The MAX payload is this stream; unlzari.c tools
  // that expect a prefix are fed the header `length` u32 immediately before it.
  it("decodes canonical Okumura streams and matches their encoder", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const hex = (h: string) =>
      Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
    const cases: [Uint8Array, string][] = [
      [enc("AAAA"), "ca56fac0"],
      [
        enc("hello world, ps2 save data"),
        "aaf1c0d07145046f387909d66e215a6eb16d1349eee132263b28",
      ],
      [enc("          "), "2993c0"],
    ];
    for (const [src, compressedHex] of cases) {
      const compressed = hex(compressedHex);
      expect(eq(lzariDecompress(compressed, src.length), src)).toBe(true);
      expect(eq(lzariCompress(src), compressed)).toBe(true);
    }
  });
});
