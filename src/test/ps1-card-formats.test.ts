import { aesCbcDecrypt } from "@/lib/crypto-utils";
import { mcxIv, mcxKey } from "@/lib/ps1-keys";
import PS1MemoryCard, { CardTypes } from "@/lib/ps1-memory-card";

import {
  bytesAt,
  equalBytes,
  newCard,
  toBytes,
  toFile,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

// The format builders are private on the class; reach them through this shape
// (avoids `any` while still letting the tests inspect the emitted bytes).
type FormatBuilders = {
  getGmeHeader(): Uint8Array;
  getVgsHeader(): Uint8Array;
  makeVmpCard(): Promise<Uint8Array>;
  makeMcxCard(): Promise<Uint8Array>;
};
function builders(card: PS1MemoryCard): FormatBuilders {
  return card as unknown as FormatBuilders;
}

function gmeHeader(card: PS1MemoryCard): Uint8Array {
  return builders(card).getGmeHeader();
}
function vgsHeader(card: PS1MemoryCard): Uint8Array {
  return builders(card).getVgsHeader();
}

describe("H. card file formats", () => {
  it("H1 GME header layout", () => {
    const card = newCard();
    card.setComment(0, "hi");
    const h = gmeHeader(card);
    expect(h.length).toBe(3904);
    expect(bytesAt(h, 0, 11)).toEqual(toBytes("123-456-STD"));
    expect(h[18]).toBe(1);
    expect(h[20]).toBe(1);
    expect(h[21]).toBe(0x4d); // 'M'
    // per-slot type + pointer echo
    expect(h[22 + 0]).toBe(0xa0); // slot0 formatted
    expect(h[38 + 0]).toBe(0xff);
    // slot0 comment
    expect(bytesAt(h, 64, 2)).toEqual(toBytes("hi"));
  });

  it("H1b GME header echoes all 15 slots", () => {
    const card = newCard();
    const h = gmeHeader(card);
    for (let n = 0; n < 15; n++) {
      expect(h[22 + n]).toBe(0xa0); // headerData[n][0]
      expect(h[38 + n]).toBe(0xff); // headerData[n][8]
    }
  });

  it("H4 VGS header layout", () => {
    const card = newCard();
    const h = vgsHeader(card);
    expect(h.length).toBe(64);
    expect(bytesAt(h, 0, 4)).toEqual(toBytes("VgsM"));
    expect(h[4]).toBe(1);
    expect(h[8]).toBe(1);
    expect(h[12]).toBe(1);
    expect(h[17]).toBe(2);
  });

  it("H5 VMP file structure", async () => {
    const card = newCard();
    const vmp = await builders(card).makeVmpCard();
    expect(vmp.length).toBe(0x20080);
    expect(bytesAt(vmp, 1, 3)).toEqual(toBytes("PMV"));
    expect(vmp[4]).toBe(0x80);
    // the raw card is preserved at 0x80
    expect(vmp[0x80]).toBe(0x4d); // 'M'
    expect(vmp[0x81]).toBe(0x43); // 'C'
  });

  it("H8 MCX file decrypts back to an MC card", async () => {
    const card = newCard();
    const mcx = await builders(card).makeMcxCard();
    expect(mcx.length).toBe(0x200a0);
    const inner = await aesCbcDecrypt(mcx, mcxKey, mcxIv);
    expect(inner[0x80]).toBe(0x4d); // 'M'
    expect(inner[0x81]).toBe(0x43); // 'C'
  });

  it("H11 GME comment for slot 1 sits at header offset 320; slot 0 stays NUL", () => {
    const card = newCard();
    card.setComment(1, "x");
    const h = gmeHeader(card);
    expect(h[320]).toBe(0x78); // 'x'
    expect(h[321]).toBe(0);
    expect(h[64]).toBe(0);
  });
});

describe("H. format sniffing (loadFromFile)", () => {
  it("H10 a raw MC file is detected as Raw", async () => {
    const card = newCard();
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    const reopened = new PS1MemoryCard();
    await reopened.loadFromFile(toFile(raw, "card.mcr"));
    expect(reopened.getCardType()).toBe(CardTypes.Raw);
    expect(equalBytes(reopened.getRawData(0, TOTAL_CARD_SIZE), raw)).toBe(true);
  });

  it("H2 a GME file is detected as Gme and its card is preserved", async () => {
    const card = newCard();
    const header = gmeHeader(card);
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    const gme = new Uint8Array(3904 + TOTAL_CARD_SIZE);
    gme.set(header);
    gme.set(raw, 3904);

    const reopened = new PS1MemoryCard();
    await reopened.loadFromFile(toFile(gme, "card.gme"));
    expect(reopened.getCardType()).toBe(CardTypes.Gme);
    expect(equalBytes(reopened.getRawData(0, TOTAL_CARD_SIZE), raw)).toBe(true);
  });

  it("H9 an unsupported file throws a format error", async () => {
    const junk = new Uint8Array(TOTAL_CARD_SIZE).fill(0x55);
    const reopened = new PS1MemoryCard();
    await expect(
      reopened.loadFromFile(toFile(junk, "card.mcr")),
    ).rejects.toThrow(/not a supported Memory Card format/);
  });

  it("H7 a VMP file round-trips and is detected as Vmp", async () => {
    const card = newCard();
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    const vmp = await builders(card).makeVmpCard();
    const reopened = new PS1MemoryCard();
    await reopened.loadFromFile(toFile(vmp, "card.vmp"));
    expect(reopened.getCardType()).toBe(CardTypes.Vmp);
    expect(equalBytes(reopened.getRawData(0, TOTAL_CARD_SIZE), raw)).toBe(true);
  });

  it("H3 a corrupted GME signature still opens as Gme (comments not loaded)", async () => {
    const card = newCard();
    card.setComment(0, "hi");
    const header = gmeHeader(card);
    const raw = card.getRawData(0, TOTAL_CARD_SIZE);
    const gme = new Uint8Array(3904 + TOTAL_CARD_SIZE);
    gme.set(header);
    gme.set(raw, 3904);
    for (let i = 0; i < 11; i++) gme[i] = 0; // clobber the "123-456-STD" signature
    const reopened = new PS1MemoryCard();
    await reopened.loadFromFile(toFile(gme, "card.gme"));
    expect(reopened.getCardType()).toBe(CardTypes.Gme);
    expect(reopened.getSaves()[0].comment).toBe(""); // fallback path skips comments
  });
});
