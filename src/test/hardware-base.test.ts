import { DexDrive } from "@/lib/ps1/hardware/dexdrive";

describe("R. HardwareInterface base", () => {
  it("R1 calculateChecksum is a plain unsigned byte sum", () => {
    const hw = new DexDrive();
    expect(hw.calculateChecksum(new Uint8Array([]))).toBe(0);
    expect(hw.calculateChecksum(new Uint8Array([1, 2, 3]))).toBe(6);
    expect(
      hw.calculateChecksum(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x01])),
    ).toBe(1021);
    expect(hw.calculateChecksum(new Uint8Array([0x80, 0x80, 0x80, 0x80]))).toBe(
      0x200,
    );
  });
});
