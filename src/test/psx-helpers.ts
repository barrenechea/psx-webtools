import PS1MemoryCard, { type SlotTypes } from "@/lib/ps1-memory-card";

export const HEADER_SIZE = 128;
export const BYTES_PER_SLOT = 8192;
export const TOTAL_CARD_SIZE = 131072;
export const SLOT_COUNT = 15;

// A fresh, fully-formatted 15-slot card (the TS equivalent of a blank card).
export function newCard(): PS1MemoryCard {
  const card = new PS1MemoryCard();
  card.formatCard();
  return card;
}

// The canonical save payload, shaped like SetSaveBytes/GetSaveBytes:
// a 128-byte header followed by `blocks` x 8192-byte data blocks.
export function makeSavePayload(blocks: number): Uint8Array {
  const total = HEADER_SIZE + blocks * BYTES_PER_SLOT;
  const out = new Uint8Array(total);

  // --- header (128 bytes) ---
  out[0] = 0x51; // initial; setSaveBytes forces this anyway
  out[10] = 0x42; // 'B'
  out[11] = 0x41; // 'A'  -> region "BA" = America
  const prod = "SCES-00001";
  for (let i = 0; i < 10; i++) out[12 + i] = prod.charCodeAt(i);
  const id = "TESTGAME";
  for (let i = 0; i < 8; i++) out[22 + i] = id.charCodeAt(i);
  const sizeBytes = blocks * BYTES_PER_SLOT;
  out[4] = sizeBytes & 0xff;
  out[5] = (sizeBytes >> 8) & 0xff;
  out[6] = (sizeBytes >> 16) & 0xff;

  // --- data blocks ---
  for (let b = 0; b < blocks; b++) {
    const base = HEADER_SIZE + b * BYTES_PER_SLOT;
    out[base + 0] = 0x53; // 'S'
    out[base + 1] = 0x43; // 'C'
    out[base + 2] = 0x11; // 1 icon frame
    // name "Hiro" at [4..7]; [8..67] stay zero so the even-zero scan stops at 4
    out[base + 4] = 0x48; // 'H'
    out[base + 5] = 0x69; // 'i'
    out[base + 6] = 0x72; // 'r'
    out[base + 7] = 0x6f; // 'o'
    // palette entries (kept minimal; exact palette is an intentional TS deviation)
    out[base + 96] = 0x1f;
    out[base + 97] = 0x0;
    out[base + 98] = 0x1f;
    out[base + 99] = 0x7f;
    // icon frames (128..511) and the rest of the block (512..8191)
    for (let i = 128; i < 512; i++) out[base + i] = 0xaa;
    for (let i = 512; i < BYTES_PER_SLOT; i++) out[base + i] = 0x5a;
  }
  return out;
}

// Read `len` bytes starting at `start` as a plain number[] for assertions.
export function bytesAt(buf: Uint8Array, start: number, len: number): number[] {
  return Array.from(buf.slice(start, start + len));
}

// Strict element-wise byte comparison.
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Encode a string as its raw byte values (ASCII range).
export function toBytes(str: string): number[] {
  return Array.from(str, (c) => c.charCodeAt(0));
}

// Wrap bytes in a File backed by a fresh ArrayBuffer. The DOM File/Blob
// constructors require `Uint8Array<ArrayBuffer>`, but card buffers are typed
// `Uint8Array<ArrayBufferLike>`, so copy into a concrete ArrayBuffer first.
export function toFile(bytes: Uint8Array, name: string): File {
  return new File([new Uint8Array(bytes)], name);
}

export type { SlotTypes };
