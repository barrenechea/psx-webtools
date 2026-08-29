// PS3 PSV signing keys for a PS2 save (savetype 2). These are the PS3 PSV
// HMAC key/IV (the same class as the PS1 save keys in ps1-keys.ts) — not
// MagicGate card keys. A PS2 .psv is signed so a PS3 USB copy is accepted on
// OFW; PC import tools do not verify the signature.

/** PS2 PSV (savetype 2) HMAC AES-128 key. */
export const psvPs2Key = new Uint8Array([
  0xea, 0x02, 0xce, 0xef, 0x5b, 0xb4, 0xd2, 0x99, 0x8f, 0x61, 0x19, 0x10, 0xd7,
  0x7f, 0x51, 0xc6,
]);

/** PS2 PSV (savetype 2) HMAC AES-128 initialization vector. */
export const psvIv = new Uint8Array([
  0xb3, 0x0f, 0xfe, 0xed, 0xb7, 0xdc, 0x5e, 0xb7, 0x13, 0x3d, 0xa6, 0x0d, 0x1b,
  0x6b, 0x2c, 0xdc,
]);
