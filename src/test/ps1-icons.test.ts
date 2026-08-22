import PS1MemoryCard, {
  DataTypes,
  IconTypes,
  SlotTypes,
} from "@/lib/ps1-memory-card";

import {
  equalBytes,
  HEADER_SIZE,
  makeSavePayload,
  newCard,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

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

  it("G7 software type: header 'P' + MCX0/MCX1 -> software, else save", () => {
    const raw = newCard().getRawData(0, TOTAL_CARD_SIZE);
    raw[128] = 0x51; // slot 0 = initial
    raw[128 + 0x10] = 0x50; // header[0x10] = 'P'
    raw[8192 + 0x52] = 0x4d; // "MCX"
    raw[8192 + 0x53] = 0x43;
    raw[8192 + 0x54] = 0x58;
    raw[8192 + 0x55] = 0x30; // '0' -> MCX0
    const card = new PS1MemoryCard();
    card.loadFromRawData(raw);
    expect(card.getSaveDataType(0)).toBe(DataTypes.Software);

    raw[8192 + 0x55] = 0x32; // '2' -> MCX2, not software
    card.loadFromRawData(raw);
    expect(card.getSaveDataType(0)).toBe(DataTypes.Save);
  });

  it("G6 MCIcon: non-initial -> null, initial -> mcIconFrames*0x80 bytes", () => {
    expect(newCard().getPocketStationIcon(0, IconTypes.MCIcon)).toBeNull();

    const card = newCard();
    const p = makeSavePayload(1);
    p[HEADER_SIZE + 0x50] = 1; // mcIconFrames = 1
    card.setSaveBytes(0, p);
    const result = card.getPocketStationIcon(0, IconTypes.MCIcon);
    expect(result).not.toBeNull();
    const icon = result!;
    expect(icon.data).toHaveLength(0x80);
    // base = 0x80 + 0x80*iconFrames(1) + funcTableOffset(0) + savedSnapOffset(0)
    const base = 0x80 + 0x80 * 1;
    const raw = card.getRawData(8192, 8192);
    for (let i = 0; i < icon.data.length; i++) {
      expect(icon.data[i]).toBe(raw[base + i]);
    }
  });

  it("G8 APIcon: null when apIconEntries<1, else frames at entryOffset + iconOffset+128", () => {
    // default: apIconEntries (saveData[0][0x56]) is 0 -> null
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    expect(card.getPocketStationIcon(0, IconTypes.APIcon)).toBeNull();

    // apIconEntries=1, entry at 0x100 (iconFrames=1, mcIconFrames=0 -> 0x100)
    const card2 = newCard();
    const p = makeSavePayload(1);
    p[HEADER_SIZE + 0x56] = 1; // apIconEntries
    p[HEADER_SIZE + 0x100] = 1; // apIconFrames
    p[HEADER_SIZE + 0x102] = 5; // delay
    p[HEADER_SIZE + 0x104] = 0x00; // iconOffset LE24 = 0
    p[HEADER_SIZE + 0x105] = 0x00;
    p[HEADER_SIZE + 0x106] = 0x00;
    card2.setSaveBytes(0, p);
    const icon = card2.getPocketStationIcon(0, IconTypes.APIcon)!;
    expect(icon.delay).toBe(5);
    expect(icon.data).toHaveLength(0x80);
    // icon = GetSaveBytes(0)[128..255] = saveData[0][0..127]
    const raw = card2.getRawData(8192, 8192);
    for (let i = 0; i < 0x80; i++) expect(icon.data[i]).toBe(raw[i]);
  });

  it("P0-1 MCIcon funcTableOffset: data[0x57]=1 -> read base 0x180", () => {
    const card = newCard();
    const p = makeSavePayload(1);
    p[HEADER_SIZE + 0x50] = 1; // mcIconFrames
    p[HEADER_SIZE + 0x57] = 1; // funcTableOffset = ((1*8)+0x7f) & ~0x7f = 0x80
    card.setSaveBytes(0, p);
    const icon = card.getPocketStationIcon(0, IconTypes.MCIcon)!;
    expect(icon.delay).toBe(0); // MCIcon never sets delay
    expect(icon.data).toHaveLength(0x80);
    // base = 0x80 + 0x80*iconFrames(1) + funcTableOffset(0x80) = 0x180
    const raw = card.getRawData(8192, 8192);
    for (let i = 0; i < 0x80; i++) expect(icon.data[i]).toBe(raw[0x180 + i]);
  });

  it("P0-2 MCIcon savedSnapOffset: data[0x55]='1' -> read base 0x900", () => {
    const card = newCard();
    const p = makeSavePayload(1);
    p[HEADER_SIZE + 0x50] = 1; // mcIconFrames
    p[HEADER_SIZE + 0x55] = 0x31; // '1' -> savedSnapOffset 0x800
    card.setSaveBytes(0, p);
    const icon = card.getPocketStationIcon(0, IconTypes.MCIcon)!;
    expect(icon.data).toHaveLength(0x80);
    // base = 0x80 + 0x80*iconFrames(1) + savedSnapOffset(0x800) = 0x900
    const raw = card.getRawData(8192, 8192);
    for (let i = 0; i < 0x80; i++) expect(icon.data[i]).toBe(raw[0x900 + i]);
  });

  it("P0-3 APIcon entryOffset includes the mcIconFrames term", () => {
    const card = newCard();
    const p = makeSavePayload(1);
    p[HEADER_SIZE + 0x56] = 1; // apIconEntries
    p[HEADER_SIZE + 0x50] = 2; // mcIconFrames -> entryOffset = 0x80+0x80+0x100 = 0x200
    p[HEADER_SIZE + 0x200] = 1; // apIconFrames
    p[HEADER_SIZE + 0x202] = 7; // delay
    p[HEADER_SIZE + 0x204] = 0x20; // iconOffset LE24 = 0x20
    p[HEADER_SIZE + 0x205] = 0x00;
    p[HEADER_SIZE + 0x206] = 0x00;
    card.setSaveBytes(0, p);
    const icon = card.getPocketStationIcon(0, IconTypes.APIcon)!;
    expect(icon.delay).toBe(7);
    expect(icon.data).toHaveLength(0x80);
    // icon[i] = saveData[0][0x20+i]
    const raw = card.getRawData(8192, 8192);
    for (let i = 0; i < 0x80; i++) expect(icon.data[i]).toBe(raw[0x20 + i]);
    expect(icon.data[64]).toBe(0x1f); // saveData[0][0x60] = palette[0] low
    expect(icon.data[67]).toBe(0x7f); // saveData[0][0x63] = palette[1] high
  });

  it("P0-4 APIcon iconOffset can span into a 2nd block", () => {
    const card = newCard();
    const p = makeSavePayload(2);
    p[HEADER_SIZE + 8192 + 5] = 0x42; // distinguish block 2 (slot 1)
    p[HEADER_SIZE + 0x56] = 1; // apIconEntries
    p[HEADER_SIZE + 0x100] = 1; // apIconFrames (entryOffset 0x100, mcIconFrames==0)
    p[HEADER_SIZE + 0x102] = 0; // delay
    p[HEADER_SIZE + 0x104] = 0x00; // iconOffset LE24 = 0x2000 (8192)
    p[HEADER_SIZE + 0x105] = 0x20;
    p[HEADER_SIZE + 0x106] = 0x00;
    card.setSaveBytes(0, p);
    const icon = card.getPocketStationIcon(0, IconTypes.APIcon)!;
    expect(icon.delay).toBe(0);
    expect(icon.data).toHaveLength(0x80);
    // icon = slot 1 (block 2) data[0..127]
    const raw = card.getRawData(2 * 8192, 8192);
    for (let i = 0; i < 0x80; i++) expect(icon.data[i]).toBe(raw[i]);
    expect(icon.data[5]).toBe(0x42);
    expect(icon.data[0]).toBe(0x53); // 'S'
    expect(icon.data[1]).toBe(0x43); // 'C'
  });

  it("G14 SetIconBytes: linked slots share the master's resolved colors; raw data untouched", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(3)); // slots 0,1,2
    const pattern = new Uint8Array(416);
    pattern[0] = 0x1f; // entry 0
    pattern[1] = 0x00;
    pattern[10] = 0x00; // entry 5
    pattern[11] = 0x10;
    pattern[20] = 0x1f; // entry 10
    pattern[21] = 0x7f;
    for (let i = 32; i < 416; i++) pattern[i] = 0x5a;
    card.setIconBytes(0, pattern);

    const master = card.getIconColorData(0);
    // frame 0: the block is 0x5A, so even pixels -> low nibble, odd -> high nibble
    expect(master[0][0]).toBe(master[0][2]); // both low-nibble entries
    expect(master[0][1]).toBe(master[0][3]); // both high-nibble entries
    expect(master[0][0]).not.toBe(master[0][1]); // low and high entries differ
    // frames 1 and 2 are populated from base 128 + 128*n
    expect(master[1][0]).not.toEqual([0, 0, 0, 0]);
    expect(master[2][0]).not.toEqual([0, 0, 0, 0]);

    // linked slots (1, 2) share the master's resolved colors (same reference)
    for (const s of [1, 2]) {
      const linked = card.getIconColorData(s);
      for (let k = 0; k < 3; k++)
        for (let p = 0; p < 256; p++) expect(linked[k][p]).toBe(master[k][p]);
    }

    // linked slots' raw data is untouched (only the master is written)
    const raw1 = card.getRawData(2 * 8192, 8192);
    expect(raw1[96]).toBe(0x1f);
    expect(raw1[128]).toBe(0xaa);
    expect(card.changed).toBe(true);
  });

  it("P1-4 MCIcon: zero frames -> null (initial and deleted); non-zero -> frames*0x80", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1)); // initial, mcIconFrames=0
    expect(card.getPocketStationIcon(0, IconTypes.MCIcon)).toBeNull();
    card.toggleDeleteSave(0); // deleted_initial still passes the gate
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.DeletedInitial);
    expect(card.getPocketStationIcon(0, IconTypes.MCIcon)).toBeNull();

    const card2 = newCard();
    const p = makeSavePayload(1);
    p[HEADER_SIZE + 0x50] = 2; // 2 frames -> base = 0x80 + 0x80*iconFrames(1) = 0x100
    card2.setSaveBytes(0, p);
    const icon = card2.getPocketStationIcon(0, IconTypes.MCIcon)!;
    expect(icon.delay).toBe(0);
    expect(icon.data).toHaveLength(0x100);
    const raw = card2.getRawData(8192, 8192);
    for (let i = 0; i < 0x100; i++) expect(icon.data[i]).toBe(raw[0x100 + i]);
  });
});
