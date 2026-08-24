import { crc32, formatCrc32 } from "@/lib/crc32";
import PS1MemoryCard, { CardTypes, SlotTypes } from "@/lib/ps1-memory-card";

import {
  equalBytes,
  makeSavePayload,
  newCard,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

// The link-integrity edge cases set slot types and pointers directly on a loaded
// card (as the reference does). A typed view exposes just those internals, using
// the same `as unknown as <Shape>` idiom as single-save.test.ts — never `any`.
type SlotInternals = {
  slotTypes: SlotTypes[];
  headerData: Uint8Array[];
};
const internals = (card: PS1MemoryCard): SlotInternals =>
  card as unknown as SlotInternals;

describe("A. card lifecycle & raw layout", () => {
  it("CRC-32 of '123456789' is the ISO 3309 check value", () => {
    expect(formatCrc32(crc32(new TextEncoder().encode("123456789")))).toBe(
      "CBF43926",
    );
  });

  it("A1 formatCard leaves all 15 slots formatted and blank", () => {
    const card = newCard();
    const saves = card.getSaves();
    expect(saves).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(saves[i].slotType).toBe(SlotTypes.Formatted);
      expect(saves[i].name).toBe("");
      expect(saves[i].blockCount).toBe(0);
      expect(saves[i].iconFrameCount).toBe(0);
    }
    const h0 = card.getRawData(128, 128);
    expect(h0[0]).toBe(0xa0); // formatted
    expect(h0[8]).toBe(0xff);
    expect(h0[9]).toBe(0xff);
    expect(card.changed).toBe(false);
    expect(card.undoCount).toBe(0);
  });

  it("A2 raw signature bytes", () => {
    const card = newCard();
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    expect(raw.length).toBe(TOTAL_CARD_SIZE);
    expect(raw[0]).toBe(0x4d); // M
    expect(raw[1]).toBe(0x43); // C
    expect(raw[127]).toBe(0x0e); // 0x4d ^ 0x43
    expect(raw[8064]).toBe(0x4d);
    expect(raw[8065]).toBe(0x43);
    expect(raw[8191]).toBe(0x0e);
  });

  it("A3 per-slot XOR checksum is the formatted golden value", () => {
    const card = newCard();
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    for (let n = 0; n < 15; n++) {
      // 0xa0 ^ 0xff ^ 0xff == 0xa0
      expect(raw[128 + n * 128 + 127]).toBe(0xa0);
    }
  });

  it("A4 loadFromRawData round-trips byte-identically", () => {
    const card = newCard();
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    const reopened = new PS1MemoryCard();
    reopened.loadFromRawData(raw, false);
    expect(equalBytes(reopened.getRawData(0, TOTAL_CARD_SIZE), raw)).toBe(true);
    // the loaded card reflects the formatted state
    expect(reopened.getSaves()[0].slotType).toBe(SlotTypes.Formatted);
  });

  it("A4c raw checksum is stable, ignores GME comments, and changes with data", () => {
    const a = newCard();
    const b = newCard();
    expect(a.getRawChecksum()).toBe(b.getRawChecksum());
    expect(a.getRawChecksum()).toMatch(/^[0-9A-F]{8}$/);

    a.setComment(0, "gme comment must not affect the raw checksum");
    expect(a.getRawChecksum()).toBe(b.getRawChecksum());

    const mutated = new Uint8Array(a.getRawData(0, TOTAL_CARD_SIZE));
    mutated[8192] ^= 0xff;
    b.loadFromRawData(mutated, false);
    expect(b.getRawChecksum()).not.toBe(a.getRawChecksum());
  });

  it("A4b loadFromRawData rejects a wrongly-sized buffer", () => {
    const card = new PS1MemoryCard();
    expect(() => card.loadFromRawData(new Uint8Array(131071))).toThrow();
  });

  it("A7 fixData=false preserves a bad checksum; fixData=true recomputes it", () => {
    const raw = new Uint8Array(newCard().getRawData(0, TOTAL_CARD_SIZE));
    raw[128 + 127] = 0x00; // clobber slot 0's XOR byte (correct value is 0xa0)
    const bad = new PS1MemoryCard();
    bad.loadFromRawData(raw, false);
    expect(bad.getRawData(0, TOTAL_CARD_SIZE)[128 + 127]).toBe(0x00);
    const good = new PS1MemoryCard();
    good.loadFromRawData(raw, true);
    expect(good.getRawData(0, TOTAL_CARD_SIZE)[128 + 127]).toBe(0xa0);
  });

  it("A9 a clean card's raw image is signature + 15 headers + 20 reserved blocks", () => {
    const raw = newCard().getRawData(0, TOTAL_CARD_SIZE);
    expect(raw.length).toBe(TOTAL_CARD_SIZE);
    // primary + secondary signature
    expect(raw[0]).toBe(0x4d);
    expect(raw[1]).toBe(0x43);
    expect(raw[127]).toBe(0x0e);
    expect(raw[8064]).toBe(0x4d);
    expect(raw[8065]).toBe(0x43);
    expect(raw[8191]).toBe(0x0e);
    // 15 formatted slot headers
    for (let n = 0; n < 15; n++) {
      const h = 128 + n * 128;
      expect(raw[h + 0]).toBe(0xa0);
      expect(raw[h + 8]).toBe(0xff);
      expect(raw[h + 9]).toBe(0xff);
      expect(raw[h + 127]).toBe(0xa0);
    }
    // 20 reserved blocks (only present on a clean build)
    for (let n = 0; n < 20; n++) {
      const h = 2048 + n * 128;
      for (let i = 0; i < 4; i++) expect(raw[h + i]).toBe(0xff);
      expect(raw[h + 8]).toBe(0xff);
      expect(raw[h + 9]).toBe(0xff);
    }
    // exactly those bytes are non-zero
    let nonZero = 0;
    for (let i = 0; i < raw.length; i++) if (raw[i] !== 0) nonZero++;
    expect(nonZero).toBe(3 + 3 + 15 * 4 + 20 * 6);
  });

  it("A10 loadFromRawData rejects an oversized buffer", () => {
    const card = new PS1MemoryCard();
    expect(() => card.loadFromRawData(new Uint8Array(131073))).toThrow();
  });

  it("A8 saveMemoryCard resets the changed flag", async () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1)); // a save marks the card changed
    expect(card.changed).toBe(true);
    const ok = await card.saveMemoryCard("a8test", CardTypes.Raw, false);
    expect(ok).toBe(true);
    expect(card.changed).toBe(false);
  });
});

describe("B. slot type & link integrity", () => {
  const cases: [number, SlotTypes][] = [
    [0xa0, SlotTypes.Formatted],
    [0x51, SlotTypes.Initial],
    [0xa1, SlotTypes.DeletedInitial],
    [0x00, SlotTypes.Corrupted],
    [0x99, SlotTypes.Corrupted],
  ];

  it("B1 decodes the slot type from the header byte", () => {
    for (const [byte, expected] of cases) {
      const buf = new Uint8Array(TOTAL_CARD_SIZE);
      buf[128] = byte; // slot 0 header[0]
      const card = new PS1MemoryCard();
      card.loadFromRawData(buf);
      expect(card.getSaves()[0].slotType).toBe(expected);
    }
  });

  it("B2 an orphaned middle link is reset to formatted", () => {
    const buf = new Uint8Array(TOTAL_CARD_SIZE);
    // slot 0 -> initial, points at slot 1
    buf[128 + 0 * 128 + 0] = 0x51;
    buf[128 + 0 * 128 + 8] = 1;
    // slot 1 -> middle, reachable, ends the chain
    buf[128 + 1 * 128 + 0] = 0x52;
    buf[128 + 1 * 128 + 8] = 0xff;
    // slot 2 -> middle, but nothing links to it (orphan)
    buf[128 + 2 * 128 + 0] = 0x52;
    buf[128 + 2 * 128 + 8] = 0xff;

    const card = new PS1MemoryCard();
    card.loadFromRawData(buf);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial);
    expect(card.getSaves()[1].slotType).toBe(SlotTypes.MiddleLink);
    expect(card.getSaves()[2].slotType).toBe(SlotTypes.Formatted);
  });

  it("D8 getSaveLinks returns the full chain of a 3-block save", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3));
    expect(card.getSaveLinks(0)).toEqual([0, 1, 2]);
  });

  it("B3 findSaveLinks stops before a corrupted slot", () => {
    const card = newCard();
    const c = internals(card);
    c.slotTypes[0] = SlotTypes.Initial;
    c.slotTypes[1] = SlotTypes.MiddleLink;
    c.slotTypes[2] = SlotTypes.Corrupted;
    c.headerData[0][8] = 1; // slot 0 -> 1
    c.headerData[1][8] = 2; // slot 1 -> 2 (corrupted)
    expect(card.getSaveLinks(0)).toEqual([0, 1]);
  });

  it("B4 findSaveLinks breaks on an out-of-range or non-link pointer", () => {
    // pointer past the last slot (16 > 15) -> stops immediately
    const a = newCard();
    const ca = internals(a);
    ca.slotTypes[0] = SlotTypes.Initial;
    ca.headerData[0][8] = 16;
    expect(a.getSaveLinks(0)).toEqual([0]);

    // pointer to a formatted (non-link) slot -> stops
    const b = newCard();
    const cb = internals(b);
    cb.slotTypes[0] = SlotTypes.Initial;
    cb.headerData[0][8] = 5; // slot 5 stays formatted
    expect(b.getSaveLinks(0)).toEqual([0]);
  });

  it("B5 findSaveLinks terminates a link cycle at the slot count", () => {
    const card = newCard();
    const c = internals(card);
    c.slotTypes[1] = SlotTypes.MiddleLink;
    c.slotTypes[2] = SlotTypes.EndLink;
    c.headerData[1][8] = 2;
    c.headerData[2][8] = 1; // 1 <-> 2 cycle
    const links = card.getSaveLinks(1);
    expect(links).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(links[i]).toBe(i % 2 === 0 ? 1 : 2);
    }
  });
});

describe("C. XOR checksum", () => {
  it("C1 header XOR is self-consistent after a save", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const header = card.getSaveBytes(0).slice(0, 128);
    let xor = 0;
    for (let i = 0; i < 127; i++) xor ^= header[i];
    expect(header[127]).toBe(xor);
  });

  it("C2 flipping a header byte flips the slot XOR by exactly that delta", () => {
    const card = newCard();
    const base = card.getRawData(0, TOTAL_CARD_SIZE);
    const oldByte = base[128 + 5]; // slot 0 header[5]
    const oldXor = base[128 + 127];
    const newByte = 0x5a;
    const mutated = new Uint8Array(base);
    mutated[128 + 5] = newByte;
    const reloaded = new PS1MemoryCard();
    reloaded.loadFromRawData(mutated, true); // fixData -> recalculateXOR
    const out = reloaded.getRawData(0, TOTAL_CARD_SIZE);
    expect(out[128 + 5]).toBe(newByte);
    expect(out[128 + 127]).toBe((oldXor ^ oldByte ^ newByte) & 0xff);
  });
});
