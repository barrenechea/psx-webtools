import { mgCbcEncrypt } from "@/lib/ps2/ps2-des";
import {
  PS2Mechacon,
  type Ps2MgKeyset,
  validateMgKeyset,
} from "@/lib/ps2/ps2-mechacon";
import { equalBytes } from "@/test/psx-helpers";

function bytes(v: number[]): Uint8Array {
  return new Uint8Array(v);
}

// Fake, non-secret keyset + card state. Values are arbitrary patterns, not
// real MagicGate constants.
const keyset: Ps2MgKeyset = {
  keychangeParam: 1,
  hashKey1: bytes([
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x21, 0x22, 0x23, 0x24,
    0x25, 0x26, 0x27, 0x28,
  ]),
  hashKey2: bytes([
    0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x41, 0x42, 0x43, 0x44,
    0x45, 0x46, 0x47, 0x48,
  ]),
  material1: bytes([0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58]),
  material2: bytes([0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68]),
  challengeMaterial: bytes([0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78]),
};

const cardIv = bytes([0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8]);
const cardMaterial = bytes([0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8]);
const cardNonce = bytes([0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8]);
const mechaNonce = bytes([0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);
const sessionKey = bytes([0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8]);

// The card side of the exchange, computed with the UniqueKey the card derives
// for itself (the same derivation the host uses, so the two sides agree).
function cardResponses() {
  const cr1 = mgCbcEncrypt(
    derivedUniqueKey(),
    keyset.challengeMaterial,
    cardNonce,
  );
  const cr2 = mgCbcEncrypt(derivedUniqueKey(), cr1, mechaNonce);
  const cr3 = mgCbcEncrypt(derivedUniqueKey(), cr2, sessionKey);
  return { cr1, cr2, cr3 };
}

function derivedUniqueKey(): Uint8Array {
  // Mirror the card's UniqueKey derivation (host and card must agree).
  const input = new Uint8Array(8);
  for (let i = 0; i < 8; i++) input[i] = cardIv[i] ^ cardMaterial[i];
  const k = new Uint8Array(16);
  k.set(mgCbcEncrypt(keyset.hashKey1, keyset.material1, input), 0);
  k.set(mgCbcEncrypt(keyset.hashKey2, keyset.material2, input), 8);
  return k;
}

describe("PS2Mechacon", () => {
  it("authenticates against a matching card and recovers the SessionKey", () => {
    const host = new PS2Mechacon();
    host.calcUniqueKey(keyset, cardIv, cardMaterial);
    host.setCardNonce(cardNonce);
    const { c1, c2, c3 } = host.generateChallenges(keyset, mechaNonce);

    const { cr1, cr2, cr3 } = cardResponses();

    expect(host.verifyResponses(keyset, cr1, cr2, cr3)).toBe(true);
    expect(equalBytes(host.sessionKey!, sessionKey)).toBe(true);
    // The three challenge values the host transmits are well-formed 8-byte blocks.
    expect(c1.length).toBe(8);
    expect(c2.length).toBe(8);
    expect(c3.length).toBe(8);
  });

  it("rejects a tampered CR1", () => {
    const host = new PS2Mechacon();
    host.calcUniqueKey(keyset, cardIv, cardMaterial);
    host.setCardNonce(cardNonce);
    host.generateChallenges(keyset, mechaNonce);
    const { cr1, cr2, cr3 } = cardResponses();
    const bad = cr1.slice();
    bad[0] ^= 0x01;
    expect(host.verifyResponses(keyset, bad, cr2, cr3)).toBe(false);
    expect(host.sessionKey).toBeUndefined();
  });

  it("rejects a tampered CR2", () => {
    const host = new PS2Mechacon();
    host.calcUniqueKey(keyset, cardIv, cardMaterial);
    host.setCardNonce(cardNonce);
    host.generateChallenges(keyset, mechaNonce);
    const { cr1, cr2, cr3 } = cardResponses();
    const bad = cr2.slice();
    bad[7] ^= 0x80;
    expect(host.verifyResponses(keyset, cr1, bad, cr3)).toBe(false);
  });

  it("rejects a card with a different nonce (CR1/CR2 mismatch)", () => {
    const host = new PS2Mechacon();
    host.calcUniqueKey(keyset, cardIv, cardMaterial);
    host.setCardNonce(cardNonce);
    host.generateChallenges(keyset, mechaNonce);
    // Card answers with the wrong nonce, so CR2 won't decrypt to the host nonce.
    const wrong = bytes([0, 0, 0, 0, 0, 0, 0, 0]);
    const cr1 = mgCbcEncrypt(
      derivedUniqueKey(),
      keyset.challengeMaterial,
      wrong,
    );
    const cr2 = mgCbcEncrypt(derivedUniqueKey(), cr1, mechaNonce);
    const cr3 = mgCbcEncrypt(derivedUniqueKey(), cr2, sessionKey);
    expect(host.verifyResponses(keyset, cr1, cr2, cr3)).toBe(false);
  });

  it("validateMgKeyset throws on wrong field sizes", () => {
    expect(() => validateMgKeyset(keyset)).not.toThrow();
    const bad: Ps2MgKeyset = {
      ...keyset,
      hashKey1: bytes([0, 0, 0, 0, 0, 0, 0]),
    };
    expect(() => validateMgKeyset(bad)).toThrow();
  });
});
