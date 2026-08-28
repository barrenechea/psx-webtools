// Host-side stand-in for the Memory Card's "mechacon" (MagicGate) crypto, the
// PS2 counterpart of the card's challenge/response. It mirrors the math the
// card runs internally so the two sides agree on the 16-byte UniqueKey and the
// 8-byte SessionKey. All vectors are derived from the user-supplied keyset; no
// key material ships with the code.

import { mgCbcDecrypt, mgCbcEncrypt } from "@/lib/ps2/ps2-des";

/**
 * A PS2 card read/write failure surfaced to the UI. `step` names the MagicGate
 * handshake step that failed (e.g. "F0 0A") when the failure was an auth
 * rejection, so the key-file UI can clear a bad keyset instead of parsing the
 * message string. `needsKey` marks the "card needs auth but no keyset was
 * used" case, so the UI can prompt for a key file.
 */
export class Ps2CardError extends Error {
  constructor(
    message: string,
    public readonly step?: string,
    public readonly needsKey = false,
  ) {
    super(message);
    this.name = "Ps2CardError";
  }
}

export interface Ps2MgKeyset {
  // The F7 packet argument (0xF7 <param>): 0 = dev/DEX (F7 omitted),
  // 1 = retail CEX, 3 = arcade. Passed through to F7 verbatim.
  keychangeParam: number;
  // MC_CARDKEY_HASHKEY_1 / _2 — the two 16-byte 3DES key pairs (8+8 each).
  hashKey1: Uint8Array;
  hashKey2: Uint8Array;
  // MC_CARDKEY_MATERIAL_1 / _2 — the 8-byte IVs that seed the UniqueKey halves.
  material1: Uint8Array;
  material2: Uint8Array;
  // MC_CHALLENGE_MATERIAL — the 8-byte IV for the challenge/response exchange.
  challengeMaterial: Uint8Array;
}

export interface Ps2MgChallenge {
  c1: Uint8Array;
  c2: Uint8Array;
  c3: Uint8Array;
}

export const MG_HASH_KEY_SIZE = 16;
export const MG_MATERIAL_SIZE = 8;

export function validateMgKeyset(keyset: Ps2MgKeyset): void {
  check(keyset.hashKey1.length, MG_HASH_KEY_SIZE, "hashKey1");
  check(keyset.hashKey2.length, MG_HASH_KEY_SIZE, "hashKey2");
  check(keyset.material1.length, MG_MATERIAL_SIZE, "material1");
  check(keyset.material2.length, MG_MATERIAL_SIZE, "material2");
  check(keyset.challengeMaterial.length, MG_MATERIAL_SIZE, "challengeMaterial");
}

function check(len: number, want: number, name: string): void {
  if (len !== want) {
    throw new Error(`MgKeyset.${name} must be ${want} bytes, got ${len}`);
  }
}

function xor8(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = a[i] ^ b[i];
  return out;
}

function equal8(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return false;
  return true;
}

// One authentication session. Drive it in the F0 order: calcUniqueKey after
// the CardIV/CardMaterial reads, setCardNonce after the CardNonce read,
// generateChallenges, then verifyResponses after the CR1/CR2/CR3 reads.
export class PS2Mechacon {
  private cardIv?: Uint8Array;
  private cardNonce?: Uint8Array;
  private mechaNonce?: Uint8Array;
  private uniqueKey?: Uint8Array;
  sessionKey?: Uint8Array;

  // S-0x82. Derive the 16-byte UniqueKey from the card's IV + material.
  calcUniqueKey(
    keyset: Ps2MgKeyset,
    cardIv: Uint8Array,
    cardMaterial: Uint8Array,
  ): void {
    this.cardIv = cardIv.slice();
    const input = xor8(cardIv, cardMaterial);
    const k = new Uint8Array(16);
    k.set(mgCbcEncrypt(keyset.hashKey1, keyset.material1, input), 0);
    k.set(mgCbcEncrypt(keyset.hashKey2, keyset.material2, input), 8);
    this.uniqueKey = k;
  }

  // After the CardNonce read (F0 04).
  setCardNonce(cardNonce: Uint8Array): void {
    this.cardNonce = cardNonce.slice();
  }

  // S-0x84/0x85. Build the C1/C2/C3 challenge from a fresh 8-byte host nonce.
  generateChallenges(
    keyset: Ps2MgKeyset,
    mechaNonce: Uint8Array,
  ): Ps2MgChallenge {
    const uk = this.require(this.uniqueKey, "uniqueKey");
    if (mechaNonce.length !== 8) {
      throw new Error(`Mecha nonce must be 8 bytes, got ${mechaNonce.length}`);
    }
    this.mechaNonce = mechaNonce.slice();
    const c1 = mgCbcEncrypt(uk, keyset.challengeMaterial, mechaNonce);
    const c2 = mgCbcEncrypt(uk, c1, this.require(this.cardNonce, "cardNonce"));
    const c3 = mgCbcEncrypt(uk, c2, this.require(this.cardIv, "cardIv"));
    return { c1, c2, c3 };
  }

  // S-0x86/0x87. Check the card's responses; on success set sessionKey.
  verifyResponses(
    keyset: Ps2MgKeyset,
    cr1: Uint8Array,
    cr2: Uint8Array,
    cr3: Uint8Array,
  ): boolean {
    const uk = this.require(this.uniqueKey, "uniqueKey");
    const mn = this.require(this.mechaNonce, "mechaNonce");
    const cn = this.require(this.cardNonce, "cardNonce");
    if (!equal8(mgCbcDecrypt(uk, keyset.challengeMaterial, cr1), cn))
      return false;
    if (!equal8(mgCbcDecrypt(uk, cr1, cr2), mn)) return false;
    this.sessionKey = mgCbcDecrypt(uk, cr2, cr3);
    return true;
  }

  private require(v: Uint8Array | undefined, name: string): Uint8Array {
    if (!v) throw new Error(`PS2Mechacon: ${name} not set`);
    return v;
  }
}
