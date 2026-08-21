import { SlotTypes } from "@/lib/ps1-memory-card";

import {
  equalBytes,
  makeSavePayload,
  newCard,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

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
});
