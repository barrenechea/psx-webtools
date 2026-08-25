import { aesCbcDecrypt } from "@/lib/crypto-utils";
import { mcxIv, mcxKey } from "@/lib/ps1-keys";
import PS1MemoryCard from "@/lib/ps1-memory-card";

import {
  equalBytes,
  makeSavePayload,
  newCard,
  TOTAL_CARD_SIZE,
} from "./psx-helpers";

// The format builders are private; reach them through this typed shape (no `any`).
type Builders = {
  makeVmpCard(): Promise<Uint8Array>;
  makeMcxCard(): Promise<Uint8Array>;
  makePsvSave(save: Uint8Array): Promise<Uint8Array>;
};
const b = (card: PS1MemoryCard): Builders => card as unknown as Builders;

async function sha1(data: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", data));
}
async function sha256(data: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

// Frozen HMACs for the canonical VMP (fresh card) and PSV (single save) outputs —
// the TS crypto must reproduce these byte-for-byte.
const VMP_HMAC = [
  0xe3, 0x9f, 0x80, 0x2f, 0xaa, 0x4a, 0xee, 0xdf, 0x87, 0x41, 0xc5, 0x3e, 0x65,
  0xf8, 0x33, 0x1f, 0xb1, 0xce, 0x1d, 0xf7,
];
const PSV_HMAC = [
  0x5a, 0xa3, 0x44, 0xe3, 0x2b, 0xdf, 0x0e, 0xf2, 0xcc, 0x67, 0x5a, 0x43, 0xcc,
  0x9e, 0x33, 0xed, 0x41, 0xc9, 0x73, 0x48,
];

describe("K. crypto (via VMP/PSV/MCX)", () => {
  it("K1 MCX output is AES-CBC encrypted (no cleartext card at 0x80)", async () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const mcx = await b(card).makeMcxCard();
    expect(mcx.length).toBe(0x200a0);
    expect(!(mcx[0x80] === 0x4d && mcx[0x81] === 0x43)).toBe(true);
  });

  it("K2 the VMP salt is self-consistent (SHA1 over the salt/HMAC-blanked buffer)", async () => {
    const vmp = await b(newCard()).makeVmpCard();
    const zeroed = new Uint8Array(vmp);
    for (let i = 0x0c; i < 0x34; i++) zeroed[i] = 0;
    const salt = await sha1(zeroed);
    for (let i = 0; i < 20; i++) expect(salt[i]).toBe(vmp[0x0c + i]);
  });

  it("K3 the VMP and PSV HMACs match the frozen goldens", async () => {
    const vmp = await b(newCard()).makeVmpCard();
    for (let i = 0; i < 20; i++) expect(vmp[0x20 + i]).toBe(VMP_HMAC[i]);

    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const psv = await b(card).makePsvSave(card.getSaveBytes(0));
    for (let i = 0; i < 20; i++) expect(psv[0x1c + i]).toBe(PSV_HMAC[i]);
  });

  it("K4 encoding the same VMP twice is byte-identical in [0x0C..0x34)", async () => {
    const card = newCard();
    const a = await b(card).makeVmpCard();
    const bb = await b(card).makeVmpCard();
    for (let i = 0x0c; i < 0x34; i++) expect(a[i]).toBe(bb[i]);
  });

  it("K5 the PSV container has the fixed layout and a self-consistent salt", async () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const psv = await b(card).makePsvSave(card.getSaveBytes(0));
    expect(psv.length).toBe(8324);
    expect(psv[0]).toBe(0);
    expect(psv[0x38]).toBe(0x14);
    expect(psv[0x3c]).toBe(1);
    expect(psv[0x44]).toBe(0x84);
    expect(psv[0x49]).toBe(2);
    expect(psv[0x60]).toBe(3);
    expect(psv[0x61]).toBe(0x90);
    expect(new DataView(psv.buffer).getUint32(0x40, true)).toBe(8192);
    expect(new DataView(psv.buffer).getUint32(0x5c, true)).toBe(8192);
    // salt self-consistency: blank [0x08..0x30), SHA1 -> [0x08..0x1C)
    const zeroed = new Uint8Array(psv);
    for (let i = 0x08; i < 0x30; i++) zeroed[i] = 0;
    const salt = await sha1(zeroed);
    for (let i = 0; i < 20; i++) expect(salt[i]).toBe(psv[0x08 + i]);
  });

  it("K6 MCX decrypts to a zeroed header, the card at 0x80, and a SHA-256 region", async () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const rawBefore = card.getRawData(0, TOTAL_CARD_SIZE);
    const enc = await b(card).makeMcxCard();
    expect(enc.length).toBe(0x200a0);
    const dec = await aesCbcDecrypt(enc, mcxKey, mcxIv);
    for (let i = 0; i < 0x80; i++) expect(dec[i]).toBe(0);
    expect(
      equalBytes(dec.subarray(0x80, 0x80 + TOTAL_CARD_SIZE), rawBefore),
    ).toBe(true);
    const hash = await sha256(new Uint8Array(dec.subarray(0, 0x20080)));
    for (let i = 0; i < 0x20; i++) expect(hash[i]).toBe(dec[0x20080 + i]);
  });
});
