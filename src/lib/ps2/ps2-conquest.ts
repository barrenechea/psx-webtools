// SoulCalibur II Conquest card detection. These arcade cards carry no PFS
// filesystem: the NAND is not formatted, so a format, an erase, or any
// filesystem write destroys them. Every destructive PS2 path must refuse a
// Conquest card before it sends the first erase packet.

export const PS2_CONQUEST_MAGIC = "Memory Card for SoulCaliburII";

const CONQUEST_MAGIC_BYTES = new TextEncoder().encode(PS2_CONQUEST_MAGIC);

/**
 * True when page 0 of a PS2 card is a SoulCalibur II Conquest card, detected
 * by the fixed magic string at the start of the page. Compares the prefix only
 * (the full string carries a trailing NAMCO copyright line that is not needed
 * for detection); a buffer shorter than the prefix, or one that does not match
 * it (Sony magic, erased 0xFF, ...), is not a Conquest card.
 */
export function isPs2ConquestCard(page0: Uint8Array): boolean {
  if (page0.length < CONQUEST_MAGIC_BYTES.length) return false;
  for (let i = 0; i < CONQUEST_MAGIC_BYTES.length; i++) {
    if (page0[i] !== CONQUEST_MAGIC_BYTES[i]) return false;
  }
  return true;
}
