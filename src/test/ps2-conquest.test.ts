// SoulCalibur II Conquest detection. The arcade cards carry no PFS
// filesystem, so every destructive PS2 path (format, erase, inject) must
// refuse a Conquest card before it erases anything.

import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { isPs2ConquestCard, PS2_CONQUEST_MAGIC } from "@/lib/ps2/ps2-conquest";
import { PAGE_SIZE } from "@/lib/ps2/ps2-pfs";

const CONQUEST = new TextEncoder().encode(PS2_CONQUEST_MAGIC);

describe("SoulCalibur II Conquest detection", () => {
  it("detects the Conquest magic prefix at the start of page 0", () => {
    const page0 = new Uint8Array(PAGE_SIZE).fill(0xff);
    page0.set(CONQUEST, 0);
    expect(isPs2ConquestCard(page0)).toBe(true);
  });

  it("treats a Sony PFS superblock as not Conquest", () => {
    const page0 = new Uint8Array(PAGE_SIZE).fill(0xff);
    page0.set(new TextEncoder().encode("Sony PS2 Memory Card Format "), 0);
    expect(isPs2ConquestCard(page0)).toBe(false);
  });

  it("treats an erased (all-0xFF) page as not Conquest", () => {
    expect(isPs2ConquestCard(new Uint8Array(PAGE_SIZE).fill(0xff))).toBe(false);
  });

  it("treats a buffer shorter than the magic as not Conquest", () => {
    expect(isPs2ConquestCard(CONQUEST.subarray(0, CONQUEST.length - 1))).toBe(
      false,
    );
    expect(isPs2ConquestCard(new Uint8Array(8))).toBe(false);
  });

  it("does not match the magic at a nonzero offset", () => {
    const page0 = new Uint8Array(PAGE_SIZE).fill(0x00);
    page0.set(CONQUEST, 4); // shifted off the page start
    expect(isPs2ConquestCard(page0)).toBe(false);
  });

  it("a Conquest dump is neither a PFS card nor PS1; the probe flags it", () => {
    const dump = new Uint8Array(32 * PAGE_SIZE).fill(0xff);
    dump.set(CONQUEST, 0);
    // tryFromBytes requires the Sony superblock magic, so a Conquest dump is
    // not a PFS card...
    expect(PS2MemoryCard.tryFromBytes(dump)).toBeNull();
    // ...and the Conquest probe identifies it, so the open flow refuses it
    // instead of falling through to the PS1 loader.
    expect(isPs2ConquestCard(dump)).toBe(true);
  });
});
