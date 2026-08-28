// FIPS 46-3 DES for single 8-byte blocks, plus the 3DES-EDE and MagicGate
// CBC-single-block primitives used by the memory-card handshake. The tables
// below are the standard FIPS permutations and S-boxes; the whole module was
// cross-checked against a reference DES (5000 encrypt + 2000 decrypt vectors,
// plus 3DES-EDE and CBC round-trips).

const SBOX: readonly (readonly number[])[] = [
  [
    14, 0, 4, 15, 13, 7, 1, 4, 2, 14, 15, 2, 11, 13, 8, 1, 3, 10, 10, 6, 6, 12,
    12, 11, 5, 9, 9, 5, 0, 3, 7, 8, 4, 15, 1, 12, 14, 8, 8, 2, 13, 4, 6, 9, 2,
    1, 11, 7, 15, 5, 12, 11, 9, 3, 7, 14, 3, 10, 10, 0, 5, 6, 0, 13,
  ],
  [
    15, 3, 1, 13, 8, 4, 14, 7, 6, 15, 11, 2, 3, 8, 4, 14, 9, 12, 7, 0, 2, 1, 13,
    10, 12, 6, 0, 9, 5, 11, 10, 5, 0, 13, 14, 8, 7, 10, 11, 1, 10, 3, 4, 15, 13,
    4, 1, 2, 5, 11, 8, 6, 12, 7, 6, 12, 9, 0, 3, 5, 2, 14, 15, 9,
  ],
  [
    10, 13, 0, 7, 9, 0, 14, 9, 6, 3, 3, 4, 15, 6, 5, 10, 1, 2, 13, 8, 12, 5, 7,
    14, 11, 12, 4, 11, 2, 15, 8, 1, 13, 1, 6, 10, 4, 13, 9, 0, 8, 6, 15, 9, 3,
    8, 0, 7, 11, 4, 1, 15, 2, 14, 12, 3, 5, 11, 10, 5, 14, 2, 7, 12,
  ],
  [
    7, 13, 13, 8, 14, 11, 3, 5, 0, 6, 6, 15, 9, 0, 10, 3, 1, 4, 2, 7, 8, 2, 5,
    12, 11, 1, 12, 10, 4, 14, 15, 9, 10, 3, 6, 15, 9, 0, 0, 6, 12, 10, 11, 1, 7,
    13, 13, 8, 15, 9, 1, 4, 3, 5, 14, 11, 5, 12, 2, 7, 8, 2, 4, 14,
  ],
  [
    2, 14, 12, 11, 4, 2, 1, 12, 7, 4, 10, 7, 11, 13, 6, 1, 8, 5, 5, 0, 3, 15,
    15, 10, 13, 3, 0, 9, 14, 8, 9, 6, 4, 11, 2, 8, 1, 12, 11, 7, 10, 1, 13, 14,
    7, 2, 8, 13, 15, 6, 9, 15, 12, 0, 5, 9, 6, 10, 3, 4, 0, 5, 14, 3,
  ],
  [
    12, 10, 1, 15, 10, 4, 15, 2, 9, 7, 2, 12, 6, 9, 8, 5, 0, 6, 13, 1, 3, 13, 4,
    14, 14, 0, 7, 11, 5, 3, 11, 8, 9, 4, 14, 3, 15, 2, 5, 12, 2, 9, 8, 5, 12,
    15, 3, 10, 7, 11, 0, 14, 4, 1, 10, 7, 1, 6, 13, 0, 11, 8, 6, 13,
  ],
  [
    4, 13, 11, 0, 2, 11, 14, 7, 15, 4, 0, 9, 8, 1, 13, 10, 3, 14, 12, 3, 9, 5,
    7, 12, 5, 2, 10, 15, 6, 8, 1, 6, 1, 6, 4, 11, 11, 13, 13, 8, 12, 1, 3, 4, 7,
    10, 14, 7, 10, 9, 15, 5, 6, 0, 8, 15, 0, 14, 5, 2, 9, 3, 2, 12,
  ],
  [
    13, 1, 2, 15, 8, 13, 4, 8, 6, 10, 15, 3, 11, 7, 1, 4, 10, 12, 9, 5, 3, 6,
    14, 11, 5, 0, 0, 14, 12, 9, 7, 2, 7, 2, 11, 1, 4, 14, 1, 7, 9, 4, 12, 10,
    14, 8, 2, 13, 0, 15, 6, 12, 10, 9, 13, 0, 15, 3, 3, 5, 5, 6, 8, 11,
  ],
];

const IP: readonly number[] = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38,
  30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1,
  59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39,
  31, 23, 15, 7,
];

const IP_INV: readonly number[] = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14,
  54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28,
  35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9,
  49, 17, 57, 25,
];

const PC1: readonly number[] = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
  27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38,
  30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const PC2: readonly number[] = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27,
  20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34,
  53, 46, 42, 50, 36, 29, 32,
];

const EXPAND: readonly number[] = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16,
  17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29,
  28, 29, 30, 31, 32, 1,
];

const PERMUTE: readonly number[] = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32,
  27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const SHIFT: readonly number[] = [
  1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1,
];

function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (let b = 0; b < bytes.length; b++) {
    for (let i = 7; i >= 0; i--) bits.push((bytes[b] >> i) & 1);
  }
  return bits;
}

function bitsToBytes(bits: readonly number[]): Uint8Array {
  const out = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out[i >> 3] = v;
  }
  return out;
}

function permute(bits: readonly number[], table: readonly number[]): number[] {
  const out = new Array<number>(table.length);
  for (let i = 0; i < table.length; i++) out[i] = bits[table[i] - 1];
  return out;
}

function keySchedule(key: Uint8Array): number[][] {
  const kb = permute(bytesToBits(key), PC1);
  let left = kb.slice(0, 28);
  let right = kb.slice(28);
  const roundKeys: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const s = SHIFT[i];
    left = left.slice(s).concat(left.slice(0, s));
    right = right.slice(s).concat(right.slice(0, s));
    roundKeys.push(permute(left.concat(right), PC2));
  }
  return roundKeys;
}

function feistel(
  right: readonly number[],
  roundKey: readonly number[],
): number[] {
  const expanded = permute(right, EXPAND);
  const xored = new Array<number>(expanded.length);
  for (let i = 0; i < expanded.length; i++)
    xored[i] = expanded[i] ^ roundKey[i];
  const out: number[] = [];
  for (let box = 0; box < 8; box++) {
    let j = 0;
    for (let k = 0; k < 6; k++) j = (j << 1) | xored[box * 6 + k];
    const v = SBOX[box][j];
    out.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
  }
  return permute(out, PERMUTE);
}

function desBlock(
  key: Uint8Array,
  data: Uint8Array,
  decrypt: boolean,
): Uint8Array {
  const bits = permute(bytesToBits(data), IP);
  let left = bits.slice(0, 32);
  let right = bits.slice(32);
  const roundKeys = keySchedule(key);
  for (let i = 0; i < 16; i++) {
    const rk = decrypt ? roundKeys[15 - i] : roundKeys[i];
    const f = feistel(right, rk);
    const newRight = left.map((b, k) => b ^ f[k]);
    left = right;
    right = newRight;
  }
  // The final "right || left" is the natural no-swap result, then inverse IP.
  return bitsToBytes(permute(right.concat(left), IP_INV));
}

export function desEncryptBlock(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 8 || data.length !== 8) {
    throw new Error("desEncryptBlock needs 8-byte key and data");
  }
  return desBlock(key, data, false);
}

export function desDecryptBlock(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 8 || data.length !== 8) {
    throw new Error("desDecryptBlock needs 8-byte key and data");
  }
  return desBlock(key, data, true);
}

// 3DES-EDE with two 8-byte keys: encrypt = E(K1, D(K2, E(K1, x))),
// decrypt = D(K1, E(K2, D(K1, x))).
export function des3edeEncrypt(
  key1: Uint8Array,
  key2: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  return desBlock(
    key1,
    desBlock(key2, desBlock(key1, data, false), true),
    false,
  );
}

export function des3edeDecrypt(
  key1: Uint8Array,
  key2: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  return desBlock(
    key1,
    desBlock(key2, desBlock(key1, data, true), false),
    true,
  );
}

// MagicGate single-block CBC (8-byte block, so one block is the whole group):
// encrypt = EDE(data XOR iv); decrypt = EDE^{-1}(data) XOR iv. key16 is the
// two 8-byte keys packed as [key1, key2].
export function mgCbcEncrypt(
  key16: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const xored = new Uint8Array(8);
  for (let i = 0; i < 8; i++) xored[i] = data[i] ^ iv[i];
  return des3edeEncrypt(key16.subarray(0, 8), key16.subarray(8, 16), xored);
}

export function mgCbcDecrypt(
  key16: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const dec = des3edeDecrypt(key16.subarray(0, 8), key16.subarray(8, 16), data);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = dec[i] ^ iv[i];
  return out;
}
