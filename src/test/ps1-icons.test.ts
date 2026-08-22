import { equalBytes, makeSavePayload, newCard } from "./psx-helpers";

describe("G. palette & icons", () => {
  it("G1 the palette decodes 5-bit channels by bit-replication (not left-shift)", () => {
    const card = newCard();
    const icon = new Uint8Array(416);
    icon[0] = 0x1f;
    icon[1] = 0x00; // entry 0
    icon[2] = 0x1f;
    icon[3] = 0x7f; // entry 1
    card.setIconBytes(0, icon);
    const palette = card.getIconPalette(0);
    // 5-bit channel 0x1F replicates to 0xFF (the reference left-shifts it to 0xF8)
    expect(palette[0]).toEqual([255, 0, 0, 255]);
    expect(palette[1]).toEqual([255, 198, 255, 255]);
  });

  it("G2 a blank card's palette is all-transparent", () => {
    const card = newCard();
    for (const entry of card.getIconPalette(0)) {
      expect(entry).toEqual([0, 0, 0, 0]);
    }
  });

  it("G3 icon frame count comes from data byte 2 (0x11/0x12/0x13)", () => {
    expect(newCard().getSaves()[0].iconFrameCount).toBe(0);
    const frames: [number, number][] = [
      [0x11, 1],
      [0x12, 2],
      [0x13, 3],
    ];
    for (const [byte, expected] of frames) {
      const card = newCard();
      const p = makeSavePayload(1);
      p[128 + 2] = byte;
      card.setSaveBytes(0, p);
      expect(card.getSaves()[0].iconFrameCount).toBe(expected);
    }
  });

  it("G4 icon pixels map even-x to the low nibble and odd-x to the high nibble", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1)); // slot 0 = Initial
    const icon = new Uint8Array(416);
    icon[0] = 0x1f;
    icon[1] = 0x00; // palette entry 0
    icon[2] = 0x1f;
    icon[3] = 0x7f; // palette entry 1
    for (let i = 32; i < 160; i++) icon[i] = 0x10;
    card.setIconBytes(0, icon);
    const frame = card.getIconData(0)[0];
    // each 0x10 byte -> low nibble 0 (even-x), high nibble 1 (odd-x)
    expect(frame[0]).toBe(0);
    expect(frame[1]).toBe(1);
    expect(frame[2]).toBe(0);
    expect(frame[3]).toBe(1);
    // the nibble indices resolve through the (bit-replicated) palette
    const palette = card.getIconPalette(0);
    expect(palette[0]).toEqual([255, 0, 0, 255]);
    expect(palette[1]).toEqual([255, 198, 255, 255]);
  });

  it("G5 icon bytes round-trip (416 bytes)", () => {
    const card = newCard();
    const pattern = new Uint8Array(416);
    for (let i = 0; i < 416; i++) pattern[i] = i;
    card.setIconBytes(0, pattern);
    expect(equalBytes(card.getIconBytes(0), pattern)).toBe(true);
  });

  it("G16 a formatted slot's icon data is blank (all-zero indices)", () => {
    const card = newCard();
    const iconData = card.getIconData(0);
    expect(iconData).toHaveLength(3);
    for (const frame of iconData) {
      for (const pixel of frame) expect(pixel).toBe(0);
    }
  });

  it("P1-2 a palette entry with only the black flag set is black, not transparent", () => {
    const card = newCard();
    const icon = new Uint8Array(416);
    icon[0] = 0x00;
    icon[1] = 0x80; // entry 0: black-flag only
    card.setIconBytes(0, icon);
    const palette = card.getIconPalette(0);
    expect(palette[0]).toEqual([0, 0, 0, 255]);
    for (let c = 1; c < 16; c++) expect(palette[c]).toEqual([0, 0, 0, 0]);
  });
});
