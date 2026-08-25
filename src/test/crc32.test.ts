import { crc32, formatCrc32 } from "@/lib/crc32";

const ascii = (s: string) =>
  new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));

describe("S. CRC-32 (IEEE)", () => {
  it("S1 the standard check value", () => {
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });

  it("S2 empty input is 0", () => {
    expect(crc32(new Uint8Array([]))).toBe(0);
  });

  it("S3 single-byte vector", () => {
    expect(crc32(ascii("a"))).toBe(0xe8b7be43);
  });

  it("S4 formatCrc32 pads to 8 uppercase hex", () => {
    expect(formatCrc32(0)).toBe("00000000");
    expect(formatCrc32(0xcbf43926)).toBe("CBF43926");
    expect(formatCrc32(0xdeadbeef)).toBe("DEADBEEF");
  });
});
