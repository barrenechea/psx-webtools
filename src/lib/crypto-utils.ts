/**
 * Decrypts data using AES-CBC algorithm.
 * @param data - The encrypted data as a Uint8Array.
 * @param mcxKey - The key used for decryption as a Uint8Array.
 * @param mcxIv - The initialization vector used for decryption as a Uint8Array.
 * @returns A Promise that resolves to the decrypted data as a Uint8Array.
 * @throws Will throw an error if decryption fails.
 */
export async function aesCbcDecrypt(
  data: BufferSource,
  mcxKey: BufferSource,
  mcxIv: BufferSource,
): Promise<Uint8Array> {
  const algorithm = { name: "AES-CBC", iv: mcxIv };
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    mcxKey,
    algorithm,
    false,
    ["decrypt"],
  );

  try {
    const decrypted = await crypto.subtle.decrypt(algorithm, cryptoKey, data);
    return new Uint8Array(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt data", { cause: error });
  }
}

/**
 * Converts a string to a Uint8Array.
 * @param str - The input string to convert.
 * @returns A Uint8Array representation of the input string.
 */
export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Converts a Uint8Array to a string.
 * @param array - The Uint8Array to convert.
 * @returns A string representation of the input Uint8Array.
 */
export function uint8ArrayToString(array: Uint8Array): string {
  return new TextDecoder().decode(array);
}

// ---------------------------------------------------------------------------
// AES-128 (pure TypeScript) — used for the ECB operations in getHmac.
//
// WebCrypto does not expose ECB mode. Emulating it with AES-CBC + a zero IV is
// unreliable across environments (block-size and padding behaviour varies
// between browsers and runtimes), so AES-128 is implemented directly here to
// match the reference implementation, which uses AES-128-ECB with zero padding.
// ---------------------------------------------------------------------------

function aesGfMul(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return result;
}

function aesGfInv(x: number): number {
  if (x === 0) return 0;
  let result = 1;
  let base = x;
  let exp = 254; // x^254 == x^-1 in GF(2^8)
  while (exp > 0) {
    if (exp & 1) result = aesGfMul(result, base);
    base = aesGfMul(base, base);
    exp >>= 1;
  }
  return result;
}

const AES_SBOX: readonly number[] = (() => {
  const s = new Array<number>(256);
  for (let x = 0; x < 256; x++) {
    const b = aesGfInv(x);
    let out = 0;
    for (let i = 0; i < 8; i++) {
      let bit = 0;
      for (const off of [0, 4, 5, 6, 7]) {
        bit ^= (b >> ((i + off) % 8)) & 1;
      }
      bit ^= (0x63 >> i) & 1; // affine constant c = 0x63
      out |= bit << i;
    }
    s[x] = out;
  }
  return s;
})();

const AES_INV_SBOX: readonly number[] = (() => {
  const s = new Array<number>(256);
  for (let x = 0; x < 256; x++) s[AES_SBOX[x]] = x;
  return s;
})();

const AES_RCON: readonly number[] = [
  0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36,
];

function aesExpandKey(key: Uint8Array): Uint32Array {
  const w = new Uint32Array(44);
  for (let i = 0; i < 4; i++) {
    w[i] =
      (key[4 * i] << 24) |
      (key[4 * i + 1] << 16) |
      (key[4 * i + 2] << 8) |
      key[4 * i + 3];
  }
  for (let i = 4; i < 44; i++) {
    let temp = w[i - 1];
    if (i % 4 === 0) {
      temp = ((temp << 8) | (temp >>> 24)) >>> 0; // RotWord
      temp =
        (AES_SBOX[(temp >>> 24) & 0xff] << 24) |
        (AES_SBOX[(temp >>> 16) & 0xff] << 16) |
        (AES_SBOX[(temp >>> 8) & 0xff] << 8) |
        AES_SBOX[temp & 0xff]; // SubWord
      temp = (temp ^ (AES_RCON[i / 4 - 1] << 24)) >>> 0; // Rcon
    }
    w[i] = (w[i - 4] ^ temp) >>> 0;
  }
  return w;
}

function aesEncryptBlock(
  input: Uint8Array,
  roundKeys: Uint32Array,
): Uint8Array {
  const s = new Uint8Array(16);
  s.set(input.subarray(0, 16));
  const addRoundKey = (round: number) => {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        s[r + 4 * c] ^= (roundKeys[round * 4 + c] >>> (24 - 8 * r)) & 0xff;
      }
    }
  };
  const subBytes = () => {
    for (let i = 0; i < 16; i++) s[i] = AES_SBOX[s[i]];
  };
  const shiftRows = () => {
    const t = new Uint8Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        t[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
      }
    }
    s.set(t);
  };
  const mixColumns = () => {
    for (let c = 0; c < 4; c++) {
      const a = s[4 * c],
        b = s[4 * c + 1],
        d = s[4 * c + 2],
        e = s[4 * c + 3];
      s[4 * c] = aesGfMul(a, 2) ^ aesGfMul(b, 3) ^ d ^ e;
      s[4 * c + 1] = a ^ aesGfMul(b, 2) ^ aesGfMul(d, 3) ^ e;
      s[4 * c + 2] = a ^ b ^ aesGfMul(d, 2) ^ aesGfMul(e, 3);
      s[4 * c + 3] = aesGfMul(a, 3) ^ b ^ d ^ aesGfMul(e, 2);
    }
  };
  addRoundKey(0);
  for (let round = 1; round < 10; round++) {
    subBytes();
    shiftRows();
    mixColumns();
    addRoundKey(round);
  }
  subBytes();
  shiftRows();
  addRoundKey(10);
  return s;
}

function aesDecryptBlock(
  input: Uint8Array,
  roundKeys: Uint32Array,
): Uint8Array {
  const s = new Uint8Array(16);
  s.set(input.subarray(0, 16));
  const addRoundKey = (round: number) => {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        s[r + 4 * c] ^= (roundKeys[round * 4 + c] >>> (24 - 8 * r)) & 0xff;
      }
    }
  };
  const invSubBytes = () => {
    for (let i = 0; i < 16; i++) s[i] = AES_INV_SBOX[s[i]];
  };
  const invShiftRows = () => {
    const t = new Uint8Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        t[r + 4 * c] = s[r + 4 * ((((c - r) % 4) + 4) % 4)];
      }
    }
    s.set(t);
  };
  const invMixColumns = () => {
    for (let c = 0; c < 4; c++) {
      const a = s[4 * c],
        b = s[4 * c + 1],
        d = s[4 * c + 2],
        e = s[4 * c + 3];
      s[4 * c] =
        aesGfMul(a, 14) ^ aesGfMul(b, 11) ^ aesGfMul(d, 13) ^ aesGfMul(e, 9);
      s[4 * c + 1] =
        aesGfMul(a, 9) ^ aesGfMul(b, 14) ^ aesGfMul(d, 11) ^ aesGfMul(e, 13);
      s[4 * c + 2] =
        aesGfMul(a, 13) ^ aesGfMul(b, 9) ^ aesGfMul(d, 14) ^ aesGfMul(e, 11);
      s[4 * c + 3] =
        aesGfMul(a, 11) ^ aesGfMul(b, 13) ^ aesGfMul(d, 9) ^ aesGfMul(e, 14);
    }
  };
  addRoundKey(10);
  for (let round = 9; round >= 1; round--) {
    invShiftRows();
    invSubBytes();
    addRoundKey(round);
    invMixColumns();
  }
  invShiftRows();
  invSubBytes();
  addRoundKey(0);
  return s;
}

function aesEcbEncryptBlocks(data: Uint8Array, key: Uint8Array): Uint8Array {
  const roundKeys = aesExpandKey(key);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) {
    out.set(aesEncryptBlock(data.subarray(i, i + 16), roundKeys), i);
  }
  return out;
}

function aesEcbDecryptBlocks(data: Uint8Array, key: Uint8Array): Uint8Array {
  const n = data.length - (data.length % 16);
  const roundKeys = aesExpandKey(key);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 16) {
    out.set(aesDecryptBlock(data.subarray(i, i + 16), roundKeys), i);
  }
  return out;
}

function asUint8Array(bufferSource: BufferSource): Uint8Array {
  if (bufferSource instanceof Uint8Array) return bufferSource;
  if (bufferSource instanceof ArrayBuffer) return new Uint8Array(bufferSource);
  return new Uint8Array(
    bufferSource.buffer,
    bufferSource.byteOffset,
    bufferSource.byteLength,
  );
}

/**
 * Encrypts data using AES-128-ECB mode.
 * The input is zero-padded to a full block before encryption (matching the
 * reference implementation); the returned value is truncated back to the
 * original input length.
 * @param toEncrypt - The data to encrypt as a Uint8Array.
 * @param key - The 16-byte key.
 * @returns A Promise that resolves to the encrypted data as a Uint8Array.
 */
export async function aesEcbEncrypt(
  toEncrypt: Uint8Array,
  key: BufferSource,
): Promise<Uint8Array> {
  const keyBytes = asUint8Array(key);
  const paddedLen = Math.ceil(toEncrypt.length / 16) * 16;
  const padded = new Uint8Array(paddedLen);
  padded.set(toEncrypt);
  const full = aesEcbEncryptBlocks(padded, keyBytes);
  return full.slice(0, toEncrypt.length);
}

/**
 * Decrypts data using AES-128-ECB mode.
 * Only complete 16-byte blocks are decrypted (matching the reference).
 * @param toDecrypt - The data to decrypt as a Uint8Array.
 * @param key - The 16-byte key.
 * @returns A Promise that resolves to the decrypted data as a Uint8Array.
 */
export async function aesEcbDecrypt(
  toDecrypt: Uint8Array,
  key: BufferSource,
): Promise<Uint8Array> {
  const keyBytes = asUint8Array(key);
  return aesEcbDecryptBlocks(toDecrypt, keyBytes);
}

/**
 * Performs an XOR operation between a destination buffer and an IV.
 * @param destBuffer - The destination buffer to XOR with the IV.
 * @param iv - The initialization vector.
 */
export function xorWithIv(destBuffer: Uint8Array, iv: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    destBuffer[i] ^= iv[i];
  }
}

/**
 * Generates an HMAC for PlayStation 1 memory card data.
 * @param data - The data to generate the HMAC for.
 * @param saltSeed - The salt seed for HMAC generation.
 * @param saveKey - The key used for save data encryption.
 * @param saveIv - The initialization vector used for save data encryption.
 * @returns A Promise that resolves to the generated HMAC as a Uint8Array.
 */
export async function getHmac(
  data: Uint8Array,
  saltSeed: Uint8Array,
  saveKey: BufferSource,
  saveIv: Uint8Array,
): Promise<Uint8Array> {
  const buffer = new Uint8Array(0x14);
  const salt = new Uint8Array(0x40);
  const temp = new Uint8Array(0x14);
  const hash1 = new Uint8Array(data.length + 0x40);
  const hash2 = new Uint8Array(0x54);

  buffer.set(saltSeed.subarray(0, 0x14));
  buffer.set(await aesEcbDecrypt(buffer.subarray(0, 0x10), saveKey));
  salt.set(buffer.subarray(0, 0x10));
  buffer.set(saltSeed.subarray(0, 0x10));
  buffer.set(await aesEcbEncrypt(buffer.subarray(0, 0x14), saveKey));

  salt.set(buffer.subarray(0, 0x10), 0x10);
  xorWithIv(salt, saveIv);
  buffer.fill(0xff, 0x14);
  buffer.set(saltSeed.subarray(0x10, 0x14), 0);
  temp.set(salt.subarray(0x10, 0x24));
  xorWithIv(temp, buffer);
  salt.set(temp.subarray(0, 0x10), 0x10);
  temp.set(salt.subarray(0, 0x14));
  salt.fill(0, 0x14);
  salt.set(temp.subarray(0, 0x14));

  for (let i = 0; i < salt.length; i++) {
    salt[i] ^= 0x36;
  }

  hash1.set(salt.subarray(0, 0x40));
  hash1.set(data, 0x40);
  const sha1Hash1 = await crypto.subtle.digest("SHA-1", hash1);
  buffer.set(new Uint8Array(sha1Hash1));

  for (let i = 0; i < salt.length; i++) {
    salt[i] ^= 0x6a;
  }

  hash2.set(salt.subarray(0, 0x40));
  hash2.set(buffer.subarray(0, 0x14), 0x40);
  const sha1Hash2 = await crypto.subtle.digest("SHA-1", hash2);
  return new Uint8Array(sha1Hash2);
}
