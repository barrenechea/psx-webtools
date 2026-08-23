// Pure PocketStation display logic: serial formatting and 16 KB BIOS analysis
// (date, kernel/GUI version, checksum, known-release remark).

export interface KnownBiosRelease {
  comment: string;
  checksum: number;
}

export const KNOWN_BIOS_RELEASES: readonly KnownBiosRelease[] = [
  { comment: "1st release", checksum: 0x27e94c07 },
  { comment: "2nd release", checksum: 0xb16ce96c },
  { comment: "DTL-H4000", checksum: 0x1babaf29 },
];

const hex = (value: number): string => value.toString(16).toUpperCase();

// The serial is a 32-bit value: the top byte is a letter, the lower 24 bits are
// rendered as an 8-digit decimal.
export function formatPocketStationSerial(serial: number): string {
  const prefix = String.fromCharCode((serial >>> 24) & 0xff);
  const rest = (serial & 0xffffff).toString().padStart(8, "0");
  return `${prefix}${rest}`;
}

// The BIOS checksum is the 32-bit sum of its little-endian 32-bit words.
export function calcBiosChecksum(bios: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 3 < bios.length; i += 4) {
    const word =
      bios[i] | (bios[i + 1] << 8) | (bios[i + 2] << 16) | (bios[i + 3] << 24);
    sum = (sum + word) >>> 0;
  }
  return sum >>> 0;
}

export function getBiosDate(bios: Uint8Array): string {
  return `${hex(bios[0x17])}${hex(bios[0x16])}/${hex(bios[0x15])}/${hex(
    bios[0x14],
  )}`;
}

// Kernel version (4 bytes at 0x1DFC) and GUI version (4 bytes at 0x3FFC).
export function getBiosVersion(bios: Uint8Array): string {
  const kernel = String.fromCharCode(
    bios[0x1dfc],
    bios[0x1dfd],
    bios[0x1dfe],
    bios[0x1dff],
  );
  const gui = String.fromCharCode(
    bios[0x3ffc],
    bios[0x3ffd],
    bios[0x3ffe],
    bios[0x3fff],
  );
  return `${kernel}, ${gui}`;
}

export function getBiosRemark(checksum: number): string {
  return (
    KNOWN_BIOS_RELEASES.find((release) => release.checksum === checksum)
      ?.comment ?? "Unknown / bad dump"
  );
}

// Decode a monochromatic PocketStation icon frame (128 raw bytes) into a 32x32
// pixel grid, top-to-bottom. Each pixel is the bit-reversed, inverted source
// bit, mirroring the reference's monochrome BMP build (L-test vectors).
export function decodePocketStationMonoIcon(frame: Uint8Array): boolean[] {
  const pixels = new Array<boolean>(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const byte = frame[y * 4 + Math.floor(x / 8)];
      const bit = (byte >> (7 - (x % 8))) & 1;
      pixels[y * 32 + x] = bit === 0;
    }
  }
  return pixels;
}
