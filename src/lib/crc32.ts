// IEEE CRC-32 (ISO 3309 / PNG / ZIP). Used for a short fingerprint of raw card
// and save images so two dumps can be compared at a glance.

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

// Fold a range of `data` into a running CRC-32 state and return it. The state
// starts at 0xffffffff and is left un-finalized, so non-contiguous chunks can
// be hashed in place without copying them together.
export function crc32Update(
  state: number,
  data: Uint8Array,
  offset = 0,
  length = data.length - offset,
): number {
  for (let i = 0; i < length; i++) {
    state = TABLE[(state ^ data[offset + i]) & 0xff] ^ (state >>> 8);
  }
  return state;
}

export function crc32(data: Uint8Array): number {
  return (crc32Update(0xffffffff, data) ^ 0xffffffff) >>> 0;
}

export function formatCrc32(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, "0");
}
