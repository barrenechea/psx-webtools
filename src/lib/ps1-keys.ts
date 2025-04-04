/**
 * The key used for decrypting MCX format files.
 */
export const mcxKey = new Uint8Array([
  0x81, 0xd9, 0xcc, 0xe9, 0x71, 0xa9, 0x49, 0x9b, 0x04, 0xad, 0xdc, 0x48, 0x30,
  0x7f, 0x07, 0x92,
]);

/**
 * The initialization vector used for decrypting MCX format files.
 */
export const mcxIv = new Uint8Array([
  0x13, 0xc2, 0xe7, 0x69, 0x4b, 0xec, 0x69, 0x6d, 0x52, 0xcf, 0x00, 0x09, 0x2a,
  0xc1, 0xf2, 0x72,
]);

/**
 * The key used for encrypting and decrypting save data.
 */
export const saveKey = new Uint8Array([
  0xab, 0x5a, 0xbc, 0x9f, 0xc1, 0xf4, 0x9d, 0xe6, 0xa0, 0x51, 0xdb, 0xae, 0xfa,
  0x51, 0x88, 0x59,
]);

/**
 * The initialization vector used for encrypting and decrypting save data.
 */
export const saveIv = new Uint8Array([
  0xb3, 0x0f, 0xfe, 0xed, 0xb7, 0xdc, 0x5e, 0xb7, 0x13, 0x3d, 0xa6, 0x0d, 0x1b,
  0x6b, 0x2c, 0xdc,
]);

/**
 * Generates a salt seed for use in HMAC generation.
 * @param data - The input data to generate the salt seed from.
 * @returns A Promise that resolves to the generated salt seed as a Uint8Array.
 */
export async function generateSaltSeed(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", data));
}
