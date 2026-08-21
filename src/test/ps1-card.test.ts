import PS1MemoryCard, { SlotTypes } from "@/lib/ps1-memory-card";

import {
  equalBytes,
  makeSavePayload,
  newCard,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

describe("A. card lifecycle & raw layout", () => {
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

  it("A4b loadFromRawData rejects a wrongly-sized buffer", () => {
    const card = new PS1MemoryCard();
    expect(() => card.loadFromRawData(new Uint8Array(131071))).toThrow();
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

  it("B3 getSaveLinks returns the full chain of a 3-block save", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3));
    expect(card.getSaveLinks(0)).toEqual([0, 1, 2]);
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
});
