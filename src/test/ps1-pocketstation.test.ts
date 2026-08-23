import {
  calcBiosChecksum,
  decodePocketStationMonoIcon,
  formatPocketStationSerial,
  getBiosDate,
  getBiosRemark,
  getBiosVersion,
  KNOWN_BIOS_RELEASES,
} from "@/lib/ps1/pocketstation";

describe("formatPocketStationSerial", () => {
  it("renders the top byte as a letter and the lower 24 bits as decimal", () => {
    expect(formatPocketStationSerial(0x41_123456)).toBe("A01193046");
    expect(formatPocketStationSerial(0x50_000001)).toBe("P00000001");
  });

  it("zero-pads the decimal part to eight digits", () => {
    expect(formatPocketStationSerial(0x44ffffff)).toBe("D16777215");
    expect(formatPocketStationSerial(0x42000000)).toBe("B00000000");
  });
});

describe("calcBiosChecksum", () => {
  it("sums little-endian 32-bit words", () => {
    expect(calcBiosChecksum(new Uint8Array([1, 0, 0, 0]))).toBe(1);
    expect(calcBiosChecksum(new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]))).toBe(3);
  });

  it("treats the high byte as unsigned", () => {
    expect(calcBiosChecksum(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBe(
      0xffffffff,
    );
  });

  it("wraps the total modulo 2^32", () => {
    expect(
      calcBiosChecksum(new Uint8Array([0xff, 0xff, 0xff, 0xff, 1, 0, 0, 0])),
    ).toBe(0);
  });
});

describe("getBiosDate", () => {
  it("formats bytes 0x17..0x14 as unpadded hex", () => {
    const bios = new Uint8Array(16384);
    bios[0x14] = 0x1;
    bios[0x15] = 0x2;
    bios[0x16] = 0x3;
    bios[0x17] = 0x4;
    expect(getBiosDate(bios)).toBe("43/2/1");
  });
});

describe("getBiosVersion", () => {
  it("joins the kernel block at 0x1DFC and GUI block at 0x3FFC", () => {
    const bios = new Uint8Array(16384);
    "PS1.".split("").forEach((c, i) => (bios[0x1dfc + i] = c.charCodeAt(0)));
    "1.00".split("").forEach((c, i) => (bios[0x3ffc + i] = c.charCodeAt(0)));
    expect(getBiosVersion(bios)).toBe("PS1., 1.00");
  });
});

describe("KNOWN_BIOS_RELEASES", () => {
  it("pins the known release checksums and labels", () => {
    expect(KNOWN_BIOS_RELEASES[0]).toEqual({
      comment: "1st release",
      checksum: 0x27e94c07,
    });
    expect(KNOWN_BIOS_RELEASES[1]).toEqual({
      comment: "2nd release",
      checksum: 0xb16ce96c,
    });
    expect(KNOWN_BIOS_RELEASES[2]).toEqual({
      comment: "DTL-H4000",
      checksum: 0x1babaf29,
    });
  });
});

describe("getBiosRemark", () => {
  it("maps known checksums to their release", () => {
    for (const release of KNOWN_BIOS_RELEASES) {
      expect(getBiosRemark(release.checksum)).toBe(release.comment);
    }
  });

  it("reports unknown checksums as a bad dump", () => {
    expect(getBiosRemark(0)).toBe("Unknown / bad dump");
  });
});

describe("decodePocketStationMonoIcon", () => {
  it("maps an all-zero frame to every pixel on (L1)", () => {
    const pixels = decodePocketStationMonoIcon(new Uint8Array(128));
    expect(pixels).toHaveLength(1024);
    expect(pixels.every((on) => on)).toBe(true);
  });

  it("maps an all-set frame to every pixel off", () => {
    const pixels = decodePocketStationMonoIcon(new Uint8Array(128).fill(0xff));
    expect(pixels.every((on) => !on)).toBe(true);
  });

  it("bit-reverses and inverts per byte, MSB-first within each row (L1b)", () => {
    const frame = new Uint8Array(128);
    frame[0] = 0x80;
    const pixels = decodePocketStationMonoIcon(frame);
    expect(pixels[0]).toBe(false); // x=0: MSB of 0x80 set, inverted off
    expect(pixels[1]).toBe(true);
    expect(pixels[7]).toBe(true);
    expect(pixels[8]).toBe(true); // next byte is 0 -> on
    expect(pixels.filter((on) => !on)).toHaveLength(1);
  });
});
