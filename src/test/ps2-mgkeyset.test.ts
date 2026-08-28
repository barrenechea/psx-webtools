import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import { Ps2CardError } from "@/lib/ps2/ps2-mechacon";
import {
  fromStoredMgKeyset,
  parseMgHex,
  parsePs3mcaIni,
  shouldClearKeysetOn,
  type StoredMgKeyset,
  toStoredMgKeyset,
} from "@/lib/ps2/ps2-mgkeyset";
import { equalBytes } from "@/test/psx-helpers";

// Fake, non-secret key bytes (arbitrary patterns, never real MagicGate data).
const H1 = [
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x21, 0x22, 0x23, 0x24, 0x25,
  0x26, 0x27, 0x28,
];
const H2 = [
  0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x41, 0x42, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48,
];
const M1 = [0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58];
const M2 = [0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68];
const CM = [0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78];

const bytes = (v: number[]): Uint8Array => new Uint8Array(v);
const spaced = (v: number[]) =>
  v.map((b) => b.toString(16).padStart(2, "0")).join(" ");
const prefixed = (v: number[]) =>
  v.map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(", ");
const concat = (v: number[]) =>
  v.map((b) => b.toString(16).padStart(2, "0")).join("");

const expectKeyset = (
  parsed: ReturnType<typeof parsePs3mcaIni>[number],
  section: string,
  param: number,
) => {
  expect(parsed.section).toBe(section);
  expect(parsed.keyset.keychangeParam).toBe(param);
  expect(equalBytes(parsed.keyset.hashKey1, bytes(H1))).toBe(true);
  expect(equalBytes(parsed.keyset.hashKey2, bytes(H2))).toBe(true);
  expect(equalBytes(parsed.keyset.material1, bytes(M1))).toBe(true);
  expect(equalBytes(parsed.keyset.material2, bytes(M2))).toBe(true);
  expect(equalBytes(parsed.keyset.challengeMaterial, bytes(CM))).toBe(true);
};

describe("parseMgHex", () => {
  it("accepts spaced, 0x-prefixed, and concatenated forms", () => {
    expect(equalBytes(parseMgHex(spaced(H1), 16)!, bytes(H1))).toBe(true);
    expect(equalBytes(parseMgHex(prefixed(H1), 16)!, bytes(H1))).toBe(true);
    expect(equalBytes(parseMgHex(concat(H1), 16)!, bytes(H1))).toBe(true);
  });

  it("rejects too few, too many, and odd nibbles", () => {
    expect(parseMgHex(spaced(H1.slice(0, 4)), 16)).toBeNull();
    expect(parseMgHex(`${spaced(H1)} ff`, 16)).toBeNull();
    expect(parseMgHex("1", 1)).toBeNull();
  });
});

describe("parsePs3mcaIni", () => {
  it("parses the ps3mca MC_* name family", () => {
    const ini = [
      "[retail]",
      "keychange_param = 1",
      `MC_CARDKEY_HASHKEY_1 = ${spaced(H1)}`,
      `MC_CARDKEY_HASHKEY_2 = ${spaced(H2)}`,
      `MC_CARDKEY_MATERIAL_1 = ${spaced(M1)}`,
      `MC_CARDKEY_MATERIAL_2 = ${spaced(M2)}`,
      `MC_CHALLENGE_MATERIAL = ${spaced(CM)}`,
    ].join("\n");
    const parsed = parsePs3mcaIni(ini);
    expect(parsed).toHaveLength(1);
    expectKeyset(parsed[0], "retail", 1);
  });

  it("parses the KELFTool MG_* alias family and ignores KBIT/KC/SIG", () => {
    const ini = [
      "[prototype]",
      "keychange_param = 0",
      `MG_CARDKEY_0 = ${prefixed(H1)}`,
      `MG_CARDKEY2_0 = ${prefixed(H2)}`,
      `MG_CARDIV_0 = ${prefixed(M1)}`,
      `MG_CARDIV2_0 = ${prefixed(M2)}`,
      `MG_CHALLENGE_IV = ${prefixed(CM)}`,
      "MG_KBIT_0 = 0x00",
      "MG_KC_0 = 0x00",
      "MG_SIG_0 = 0x00",
    ].join("\n");
    const parsed = parsePs3mcaIni(ini);
    expect(parsed).toHaveLength(1);
    expectKeyset(parsed[0], "prototype", 0);
  });

  it("keeps each complete section from a multi-section file", () => {
    const ini = [
      "[retail]",
      "keychange_param = 1",
      `MC_CARDKEY_HASHKEY_1 = ${concat(H1)}`,
      `MC_CARDKEY_HASHKEY_2 = ${concat(H2)}`,
      `MC_CARDKEY_MATERIAL_1 = ${concat(M1)}`,
      `MC_CARDKEY_MATERIAL_2 = ${concat(M2)}`,
      `MC_CHALLENGE_MATERIAL = ${concat(CM)}`,
      "",
      "[arcade]",
      "keychange_param = 3",
      `MG_CARDKEY_0 = ${spaced(H1)}`,
      `MG_CARDKEY2_0 = ${spaced(H2)}`,
      `MG_CARDIV_0 = ${spaced(M1)}`,
      `MG_CARDIV2_0 = ${spaced(M2)}`,
      `MG_CHALLENGE_IV = ${spaced(CM)}`,
    ].join("\n");
    const parsed = parsePs3mcaIni(ini);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].section).toBe("retail");
    expect(parsed[0].keyset.keychangeParam).toBe(1);
    expect(parsed[1].section).toBe("arcade");
    expect(parsed[1].keyset.keychangeParam).toBe(3);
  });

  it("drops a section whose HASHKEY is too short", () => {
    const ini = [
      "[broken]",
      "keychange_param = 1",
      `MC_CARDKEY_HASHKEY_1 = ${spaced(H1.slice(0, 12))}`,
      `MC_CARDKEY_HASHKEY_2 = ${spaced(H2)}`,
      `MC_CARDKEY_MATERIAL_1 = ${spaced(M1)}`,
      `MC_CARDKEY_MATERIAL_2 = ${spaced(M2)}`,
      `MC_CHALLENGE_MATERIAL = ${spaced(CM)}`,
    ].join("\n");
    expect(parsePs3mcaIni(ini)).toHaveLength(0);
  });

  it("drops a section missing keychange_param or with an out-of-range value", () => {
    const rows = [
      `MC_CARDKEY_HASHKEY_1 = ${spaced(H1)}`,
      `MC_CARDKEY_HASHKEY_2 = ${spaced(H2)}`,
      `MC_CARDKEY_MATERIAL_1 = ${spaced(M1)}`,
      `MC_CARDKEY_MATERIAL_2 = ${spaced(M2)}`,
      `MC_CHALLENGE_MATERIAL = ${spaced(CM)}`,
    ];
    expect(parsePs3mcaIni([`[a]`, ...rows].join("\n"))).toHaveLength(0);
    expect(
      parsePs3mcaIni([`[b]`, "keychange_param = 5", ...rows].join("\n")),
    ).toHaveLength(0);
  });
});

describe("StoredMgKeyset persistence", () => {
  const keyset: Ps2MgKeyset = {
    keychangeParam: 2,
    hashKey1: bytes(H1),
    hashKey2: bytes(H2),
    material1: bytes(M1),
    material2: bytes(M2),
    challengeMaterial: bytes(CM),
  };

  it("round-trips bytes and keychange_param through JSON", () => {
    const stored = toStoredMgKeyset("retail", keyset);
    const restored = fromStoredMgKeyset(JSON.parse(JSON.stringify(stored)));
    expect(restored).not.toBeNull();
    expect(restored!.keychangeParam).toBe(2);
    expect(equalBytes(restored!.hashKey1, bytes(H1))).toBe(true);
    expect(equalBytes(restored!.challengeMaterial, bytes(CM))).toBe(true);
  });

  it("restores null from corrupted/missing localStorage payloads", () => {
    const stored = toStoredMgKeyset("retail", keyset);
    // Absent / wrong-shape top level.
    expect(fromStoredMgKeyset(null)).toBeNull();
    expect(fromStoredMgKeyset({} as StoredMgKeyset)).toBeNull();
    // keychange_param must be an integer in 0..3.
    expect(fromStoredMgKeyset({ ...stored, keychangeParam: 5 })).toBeNull();
    expect(fromStoredMgKeyset({ ...stored, keychangeParam: 1.5 })).toBeNull();
    // A hex row that is not a string or is the wrong length.
    expect(
      fromStoredMgKeyset({ ...stored, hashKey1: 12345 as unknown as string }),
    ).toBeNull();
    expect(fromStoredMgKeyset({ ...stored, hashKey1: "zz" })).toBeNull();
    expect(parseMgHex(16 as unknown as string, 16)).toBeNull();
  });
});

describe("shouldClearKeysetOn", () => {
  it("is true only for a Ps2CardError that names a failed step", () => {
    expect(shouldClearKeysetOn(new Ps2CardError("no", "F0 0A"))).toBe(true);
    expect(shouldClearKeysetOn(new Ps2CardError("no", undefined, true))).toBe(
      false,
    );
    expect(shouldClearKeysetOn(new Error("no"))).toBe(false);
  });
});
