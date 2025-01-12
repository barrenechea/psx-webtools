/**
 * Decrypts data using AES-CBC algorithm.
 * @param data - The encrypted data as a Uint8Array.
 * @param mcxKey - The key used for decryption as a Uint8Array.
 * @param mcxIv - The initialization vector used for decryption as a Uint8Array.
 * @returns A Promise that resolves to the decrypted data as a Uint8Array.
 * @throws Will throw an error if decryption fails.
 */
export async function aesCbcDecrypt(
  data: Uint8Array,
  mcxKey: Uint8Array,
  mcxIv: Uint8Array
): Promise<Uint8Array> {
  const algorithm = { name: "AES-CBC", iv: mcxIv };
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    mcxKey,
    algorithm,
    false,
    ["decrypt"]
  );

  try {
    const decrypted = await crypto.subtle.decrypt(algorithm, cryptoKey, data);
    return new Uint8Array(decrypted);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt data");
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

/**
 * Creates an AES CryptoKey from a Uint8Array.
 * @param key - The key as a Uint8Array.
 * @returns A Promise that resolves to a CryptoKey.
 */
export async function createAesKey(key: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Processes a single block using AES-ECB mode.
 * @param block - The block to process as a Uint8Array.
 * @param key - The CryptoKey to use for encryption/decryption.
 * @param encrypt - Boolean indicating whether to encrypt (true) or decrypt (false).
 * @returns A Promise that resolves to the processed block as a Uint8Array.
 */
export async function aesEcbProcessBlock(
  block: Uint8Array,
  key: CryptoKey,
  encrypt: boolean
): Promise<Uint8Array> {
  const iv = new Uint8Array(16); // Zero IV for ECB
  const result = await crypto.subtle[encrypt ? "encrypt" : "decrypt"](
    { name: "AES-CBC", iv },
    key,
    block
  );
  return new Uint8Array(result).slice(0, 16);
}

/**
 * Processes data using AES-ECB mode.
 * @param data - The data to process as a Uint8Array.
 * @param key - The key as a Uint8Array.
 * @param encrypt - Boolean indicating whether to encrypt (true) or decrypt (false).
 * @returns A Promise that resolves to the processed data as a Uint8Array.
 */
export async function aesEcbProcess(
  data: Uint8Array,
  key: Uint8Array,
  encrypt: boolean
): Promise<Uint8Array> {
  const cryptoKey = await createAesKey(key);
  const blockSize = 16;
  const result = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i += blockSize) {
    const block = data.slice(i, i + blockSize);
    const processedBlock = await aesEcbProcessBlock(block, cryptoKey, encrypt);
    result.set(processedBlock, i);
  }

  return result;
}

/**
 * Encrypts data using AES-ECB mode.
 * @param toEncrypt - The data to encrypt as a Uint8Array.
 * @param key - The key as a Uint8Array.
 * @returns A Promise that resolves to the encrypted data as a Uint8Array.
 */
export async function aesEcbEncrypt(
  toEncrypt: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  return aesEcbProcess(toEncrypt, key, true);
}

/**
 * Decrypts data using AES-ECB mode.
 * @param toDecrypt - The data to decrypt as a Uint8Array.
 * @param key - The key as a Uint8Array.
 * @returns A Promise that resolves to the decrypted data as a Uint8Array.
 */
export async function aesEcbDecrypt(
  toDecrypt: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  return aesEcbProcess(toDecrypt, key, false);
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
  saveKey: Uint8Array,
  saveIv: Uint8Array
): Promise<Uint8Array> {
  const buffer = new Uint8Array(0x14);
  const salt = new Uint8Array(0x40);
  const temp = new Uint8Array(0x14);
  const hash1 = new Uint8Array(data.length + 0x40);
  const hash2 = new Uint8Array(0x54);

  buffer.set(saltSeed.subarray(0, 0x14));
  // this next one fails
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
