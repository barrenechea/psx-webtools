import {
  des3edeDecrypt,
  des3edeEncrypt,
  desDecryptBlock,
  desEncryptBlock,
  mgCbcDecrypt,
  mgCbcEncrypt,
} from "@/lib/ps2/ps2-des";
import { equalBytes } from "@/test/psx-helpers";

function h(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// The first vector is the FIPS 46-3 worked example; the rest are arbitrary
// non-secret keys/data generated against a reference DES.
const V = (rows: string[][]): Uint8Array[][] => rows.map((r) => r.map(h));

const DES_VECTORS: Uint8Array[][] = V([
  ["133457799BBCDEF1", "0123456789ABCDEF", "85E813540F0AB405"],
  ["950E87D7F5606615", "2C61275C9E6B6CF8", "813932770C01F4C5"],
  ["1F00BCA0042DB923", "6DBCA290A9EAB706", "22D7311D37BB5E8C"],
  ["4C10A4FE30CFFDDA", "F26FFF4CC4FD394D", "45BCEB8EEBDC9F20"],
  ["6814A2BC786A6D2D", "A26B351E6C8042C5", "D91A3552444DDFC1"],
  ["54760E7FBC051C6C", "D4C08880A5A4666D", "4EF632C1FC07AE58"],
  ["29610AE0EED8F1E7", "C34BD8E2FE5213E5", "8373CA62524962FF"],
]);

describe("ps2-des: FIPS DES block", () => {
  it("encrypts and decrypts the reference vectors", () => {
    for (const [key, plain, enc] of DES_VECTORS) {
      expect(equalBytes(desEncryptBlock(key, plain), enc)).toBe(true);
      expect(equalBytes(desDecryptBlock(key, enc), plain)).toBe(true);
    }
  });

  it("round-trips arbitrary blocks", () => {
    const key = h("A55A0000FF000011");
    for (let n = 0; n < 64; n++) {
      const plain = new Uint8Array(8).fill(n & 0xff);
      const ct = desEncryptBlock(key, plain);
      expect(equalBytes(desDecryptBlock(key, ct), plain)).toBe(true);
    }
  });
});

describe("ps2-des: 3DES-EDE", () => {
  const E3_VECTORS: Uint8Array[][] = V([
    [
      "6C50AFB6E9FB123D",
      "6F28D015A2AA0B9D",
      "4E385994EBAC94AF",
      "F88A79E3FB722E2D",
    ],
    [
      "194F9545ADBA52CE",
      "C675CE05588F882F",
      "57DE8C051D4B7EF2",
      "C62498FDDAE53C2C",
    ],
    [
      "D998EFD82733E933",
      "6DF216C33F8F3201",
      "11DC6F3FCB57D5D8",
      "C63B07464735311F",
    ],
    [
      "8860A84722025E05",
      "33176469AA6EF630",
      "607507EBC5B864D7",
      "EFF1ACAB5F8E731F",
    ],
  ]);

  it("matches the reference EDE vectors", () => {
    for (const [k1, k2, data, enc] of E3_VECTORS) {
      expect(equalBytes(des3edeEncrypt(k1, k2, data), enc)).toBe(true);
      expect(equalBytes(des3edeDecrypt(k1, k2, enc), data)).toBe(true);
    }
  });
});

describe("ps2-des: MagicGate CBC single-block", () => {
  const CBC_VECTORS: Uint8Array[][] = V([
    [
      "DA10FAAA6FC24B837A2F11088D29B146",
      "2DE288F12FCB9940",
      "B98937DFEF041066",
      "063964903C61A8E6",
    ],
    [
      "C5B790314A2E3224DD4B712ED355871E",
      "07FDC889FA017ED7",
      "81EEADD71198BF15",
      "8CDCFB48A553D97C",
    ],
    [
      "AAABC8D366E0440D3A46305C425A7DE1",
      "3371364FC51D1A5E",
      "4763DD191AC44B70",
      "63507BE236116CB0",
    ],
    [
      "0B7A6E1D81E4B9E7016590C55646E6D0",
      "E5A2A8BEF16E981A",
      "1167FBA4A2927979",
      "8F03B03CB6FBB271",
    ],
  ]);

  it("matches the reference CBC vectors and round-trips", () => {
    for (const [key16, iv, data, enc] of CBC_VECTORS) {
      expect(equalBytes(mgCbcEncrypt(key16, iv, data), enc)).toBe(true);
      expect(equalBytes(mgCbcDecrypt(key16, iv, enc), data)).toBe(true);
    }
  });
});
