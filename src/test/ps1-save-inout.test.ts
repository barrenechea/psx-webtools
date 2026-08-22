import { SlotTypes } from "@/lib/ps1-memory-card";

import {
  equalBytes,
  HEADER_SIZE,
  makeSavePayload,
  newCard,
  SLOT_COUNT,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

// A formatted card where only the listed slots are free (the rest are occupied
// with a 1-block save each) — used to exercise the free-slot scan.
function cardWithFreeOnly(freeSlots: number[]) {
  const card = newCard();
  const free = new Set(freeSlots);
  for (let s = 0; s < SLOT_COUNT; s++) {
    if (!free.has(s)) card.setSaveBytes(s, makeSavePayload(1));
  }
  return card;
}

describe("D. save in/out & links", () => {
  it("D1 getSaveBytes returns the payload (128 header + N*8192 data)", () => {
    const card = newCard();
    const payload = makeSavePayload(1);
    expect(card.setSaveBytes(0, payload)).toBe(true);
    const out = card.getSaveBytes(0);
    expect(out.length).toBe(128 + 8192);
    // the data block survives intact
    expect(equalBytes(out.slice(128), payload.slice(128))).toBe(true);
  });

  it("D3 setSaveBytes populates derived fields", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const s = card.getSaves()[0];
    expect(s.name).toBe("Hiro");
    expect(s.region).toBe("America");
    expect(s.regionRaw).toBe("BA");
    expect(s.productCode).toBe("SCES-00001");
    expect(s.identifier).toBe("TESTGAME");
    expect(s.blockCount).toBe(8); // 8192 bytes -> 8 KB
    expect(s.iconFrameCount).toBe(1);
    expect(s.slotType).toBe(SlotTypes.Initial);
    expect(card.changed).toBe(true);
    expect(card.undoCount).toBe(1);
  });

  it("D4 a 3-block payload chains initial/middle/end with pointers", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3));
    const s = card.getSaves();
    expect(s[0].slotType).toBe(SlotTypes.Initial);
    expect(s[1].slotType).toBe(SlotTypes.MiddleLink);
    expect(s[2].slotType).toBe(SlotTypes.EndLink);
    expect(card.getSaveLinks(0)).toEqual([0, 1, 2]);
    // Each slot resolves to the save's master (slot 0).
    expect(card.getMasterLinkForSlot(0)).toBe(0);
    expect(card.getMasterLinkForSlot(1)).toBe(0);
    expect(card.getMasterLinkForSlot(2)).toBe(0);

    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    expect(raw[128 + 0 * 128 + 8]).toBe(1); // slot0 -> 1
    expect(raw[128 + 1 * 128 + 8]).toBe(2); // slot1 -> 2
    expect(raw[128 + 2 * 128 + 8]).toBe(0xff); // slot2 end
    expect(card.getSaveBytes(0).length).toBe(128 + 3 * 8192);
  });

  it("D7 setSaveBytes returns false when the card is full", () => {
    const card = newCard();
    for (let i = 0; i < 15; i++) card.setSaveBytes(i, makeSavePayload(1));
    expect(card.setSaveBytes(0, makeSavePayload(1))).toBe(false);
  });

  it("D2 setSaveBytes forces the header fields regardless of the payload", () => {
    const p = makeSavePayload(1);
    p[0] = 0x00; // tamper the slot type
    p[4] = 0;
    p[5] = 0;
    p[6] = 0; // tamper the size
    p[8] = 0x05; // tamper the pointer
    p[9] = 0x00;
    const card = newCard();
    card.setSaveBytes(0, p);
    const h = card.getSaveBytes(0).slice(0, HEADER_SIZE);
    expect(h[0]).toBe(SlotTypes.Initial); // type forced to initial
    expect(h[4]).toBe(0x00); // size = 8192 (0x2000)
    expect(h[5]).toBe(0x20);
    expect(h[6]).toBe(0x00);
    expect(h[8]).toBe(0xff); // pointer forced (a 1-slot save is an end link)
    expect(h[9]).toBe(0xff);
  });

  it("D10 getSaveBytes from a middle link starts at that slot", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3));
    const fromMiddle = card.getSaveBytes(1); // slot 1 is the middle link
    expect(fromMiddle.length).toBe(128 + 2 * 8192); // slots 1 and 2
    expect(fromMiddle[0]).toBe(SlotTypes.MiddleLink);
  });

  it("D11 a header-only payload (0 data blocks) returns false", () => {
    // The reference has a latent bug here ((len-128)/8192 == 0 re-chains the
    // whole card); the port guards requiredSlots < 1 and rejects it.
    const card = newCard();
    const p = new Uint8Array(128);
    p[0] = SlotTypes.Initial;
    expect(card.setSaveBytes(0, p)).toBe(false);
  });

  it("D13 setSaveBytes on an occupied slot skips to the next free slot", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1)); // occupy slot 0
    expect(card.setSaveBytes(0, makeSavePayload(1))).toBe(true);
    expect(card.getSaveLinks(0)).toEqual([0]); // slot 0 keeps its own save
    expect(card.getSaveLinks(1)).toEqual([1]); // the new save landed on slot 1
    expect(card.getSaves()[1].slotType).toBe(SlotTypes.Initial);
    expect(card.getMasterLinkForSlot(1)).toBe(1); // slot 1 is its own master
  });

  it("D14 a payload shorter than the 128-byte header returns false", () => {
    // The reference throws IndexOutOfRange; the port returns false.
    const card = newCard();
    expect(card.setSaveBytes(0, new Uint8Array(100))).toBe(false);
  });

  it("D15 trailing bytes beyond the data block round up to the next slot", () => {
    // The reference ignores the trailing bytes (1 slot); the port rounds the
    // required slot count up, so 8320 + 100 bytes occupy two slots.
    const card = newCard();
    const p = new Uint8Array(8320 + 100);
    p.set(makeSavePayload(1), 0);
    for (let i = 8320; i < p.length; i++) p[i] = 0xee;
    expect(card.setSaveBytes(0, p)).toBe(true);
    expect(card.getSaveLinks(0)).toEqual([0, 1]);
    expect(card.getSaveBytes(0).length).toBe(128 + 2 * 8192);
  });

  it("D5 places a save in non-contiguous free slots in scan order", () => {
    const card = cardWithFreeOnly([5, 10]);
    expect(card.setSaveBytes(5, makeSavePayload(2))).toBe(true);
    expect(card.getSaveLinks(5)).toEqual([5, 10]);
    expect(card.getSaves()[5].slotType).toBe(SlotTypes.Initial);
    expect(card.getSaves()[10].slotType).toBe(SlotTypes.EndLink);
    expect(card.getSaveBytes(5).length).toBe(128 + 2 * 8192);
  });

  it("D6 the free-slot scan wraps around the end of the card", () => {
    const card = cardWithFreeOnly([14, 0]);
    expect(card.setSaveBytes(14, makeSavePayload(2))).toBe(true);
    expect(card.getSaveLinks(14)).toEqual([14, 0]);
    expect(card.getSaves()[14].slotType).toBe(SlotTypes.Initial);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.EndLink);
  });

  it("D9 replaceSaveBytes writes edited data back to the existing chain in place", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const original = card.getSaveBytes(0);
    const edited = new Uint8Array(original);
    edited[128] = 0xab; // a data-region edit (the plugin-editor case)
    const undoBefore = card.undoCount;
    card.replaceSaveBytes(0, edited);
    expect(card.getSaveBytes(0).length).toBe(original.length); // same footprint
    expect(equalBytes(card.getSaveBytes(0), edited)).toBe(true); // edited bytes written
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial); // chain unchanged
    expect(card.undoCount).toBe(undoBefore + 1);
    expect(card.changed).toBe(true);
    expect(card.undo()).toBe(true);
    expect(equalBytes(card.getSaveBytes(0), original)).toBe(true); // undo restores pre-edit
  });

  it("D12 replaceSaveBytes does not validate the payload size", () => {
    // Larger payload: only the existing chain's slots are written, the chain
    // length is unchanged (the reference behaves the same).
    const big = newCard();
    big.setSaveBytes(0, makeSavePayload(2)); // 2-slot chain {0,1}
    const payload = makeSavePayload(3); // 3-block payload
    payload[8] = 1; // a proper 3-block header points at the next slot
    big.replaceSaveBytes(0, payload);
    expect(big.getSaveBytes(0).length).toBe(128 + 2 * 8192);
    expect(big.getSaveBytes(0)[8]).toBe(1); // pointer taken from the payload header
    // Smaller payload: the reference throws IndexOutOfRange on the out-of-bounds
    // read; the port writes fewer bytes without throwing (no size validation).
    const small = newCard();
    small.setSaveBytes(0, makeSavePayload(2));
    expect(() => small.replaceSaveBytes(0, makeSavePayload(1))).not.toThrow();
  });
});

describe("E. format & delete", () => {
  it("E1 formatSave wipes the whole chain", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial);

    card.formatSave(0);
    const s = card.getSaves()[0];
    expect(s.slotType).toBe(SlotTypes.Formatted);
    expect(s.name).toBe("");
    expect(s.blockCount).toBe(0);
    const h0 = card.getRawData(128, 128);
    expect(h0[0]).toBe(0xa0);
    expect(h0[8]).toBe(0xff);
    expect(h0[9]).toBe(0xff);
  });

  it("E2 toggleDeleteSave flips initial <-> deleted", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    card.toggleDeleteSave(0);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.DeletedInitial);
    card.toggleDeleteSave(0);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial);
  });

  it("E3 toggleDeleteSave deletes the whole linked chain", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3));
    card.toggleDeleteSave(0);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.DeletedInitial);
    expect(card.getSaves()[1].slotType).toBe(SlotTypes.DeletedMiddleLink);
    expect(card.getSaves()[2].slotType).toBe(SlotTypes.DeletedEndLink);
  });

  it("E5 toggleDeleteSave on a formatted slot is a no-op but pushes an undo", () => {
    const card = newCard();
    const undoBefore = card.undoCount;
    card.toggleDeleteSave(5);
    expect(card.getSaves()[5].slotType).toBe(SlotTypes.Formatted);
    expect(card.undoCount).toBe(undoBefore + 1);
    // The reference also sets changedFlag here; the port does not mark a no-op
    // toggle as changed.
    expect(card.changed).toBe(false);
    expect(card.undo()).toBe(true);
    expect(card.redoCount).toBe(1);
  });
});

describe("F. header / comment", () => {
  it("F4 region names map to their codes", () => {
    const cases: [string, string][] = [
      ["America", "BA"],
      ["Europe", "BE"],
      ["Japan", "BI"],
      ["XX", "XX"],
    ];
    for (const [region, raw] of cases) {
      const card = newCard();
      card.setHeaderData(0, "PROD", "ID", region);
      const s = card.getSaves()[0];
      expect(s.region).toBe(region);
      expect(s.regionRaw).toBe(raw);
    }
  });

  it("F7 setHeaderData writes the exact prod/id/region fields", () => {
    const card = newCard();
    card.setHeaderData(0, "SCES-00002", "NEWGAME", "Europe");
    const s = card.getSaves()[0];
    expect(s.productCode).toBe("SCES-00002");
    expect(s.identifier).toBe("NEWGAME");
    expect(s.region).toBe("Europe");
    expect(s.regionRaw).toBe("BE");
  });

  it("F9 setComment is stored in-memory for the slot", () => {
    const card = newCard();
    card.setComment(0, "hello");
    expect(card.getSaves()[0].comment).toBe("hello");
  });

  it("F2 a Shift-JIS name decodes through getSaveName", () => {
    const p = makeSavePayload(1);
    for (let i = 0; i < 12; i++) p[128 + 4 + i] = 0; // clear the name area (data[4..15])
    // "テスト" in Shift-JIS
    const name = [0x83, 0x65, 0x83, 0x58, 0x83, 0x67];
    for (let i = 0; i < name.length; i++) p[128 + 4 + i] = name[i];
    const card = newCard();
    card.setSaveBytes(0, p);
    expect(card.getSaves()[0].name).toBe("テスト");
  });

  it("F3 the name scan keeps odd-index zeros and stops at an even-index pair", () => {
    const p = makeSavePayload(1);
    p[128 + 4] = 0x41; // 'A'
    p[128 + 5] = 0x00; // odd index, kept
    p[128 + 6] = 0x43; // 'C'
    p[128 + 7] = 0x00; // odd index, kept
    // [128+8] and [128+9] are already 0 -> the even-index zero pair stops the scan
    const card = newCard();
    card.setSaveBytes(0, p);
    expect(card.getSaves()[0].name).toBe("A\0C\0");
  });

  it("F5 the identifier is NUL-padded on write and stripped on read", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    card.setHeaderData(0, "SCES-00001", "ID", "America");
    const s = card.getSaves()[0];
    expect(s.productCode).toBe("SCES-00001");
    expect(s.identifier).toBe("ID"); // "ID" + 6 NULs -> "ID"
  });

  it("F8 setHeaderData pads prod to 10 with spaces and truncates id to 8", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    card.setHeaderData(0, "ABC", "123456789", "America");
    const s = card.getSaves()[0];
    expect(s.productCode).toBe("ABC       "); // 3 chars + 7 spaces
    expect(s.identifier).toBe("12345678"); // 9 -> 8
    expect(s.region).toBe("America");
    expect(s.regionRaw).toBe("BA");
  });

  it("F11 setHeaderData region: 1-char pads to two, >2 truncates to first two", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    card.setHeaderData(0, "SCES-00001", "TESTGAME", "B");
    expect(card.getSaves()[0].regionRaw).toBe("B ");
    expect(card.getSaves()[0].region).toBe("B ");
    card.setHeaderData(0, "SCES-00001", "TESTGAME", "BEX");
    expect(card.getSaves()[0].regionRaw).toBe("BE");
    expect(card.getSaves()[0].region).toBe("Europe");
  });

  it("F12 a fresh formatted card has a NUL region and an empty name", () => {
    const card = newCard();
    const s = card.getSaves()[3];
    expect(s.region).toBe("\0\0");
    expect(s.regionRaw).toBe("\0\0");
    expect(s.name).toBe("");
  });

  it("F10 linked slots are labeled by role, inherit the master region, and resolve to it", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3));
    // The master's chain is the full 3-slot run; a link slot resolves to it.
    expect(card.getSaveLinks(0)).toEqual([0, 1, 2]);
    expect(card.getMasterLinkForSlot(2)).toBe(0);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial);
    expect(card.getSaves()[1].slotType).toBe(SlotTypes.MiddleLink);
    expect(card.getSaves()[2].slotType).toBe(SlotTypes.EndLink);
    // Link slots are labeled by role and inherit the master's region.
    expect(card.getSaves()[1].name).toBe("Linked slot (middle link)");
    expect(card.getSaves()[2].name).toBe("Linked slot (end link)");
    expect(card.getSaves()[1].region).toBe("America");
    expect(card.getSaves()[2].region).toBe("America");
    // Link slots carry no prod/id of their own.
    expect(card.getSaves()[1].productCode).toBe("");
    expect(card.getSaves()[1].identifier).toBe("");
  });
});
