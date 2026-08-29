import { PS2SAVE_CBS_RC4S, rc4Crypt } from "@/lib/ps2/ps2-rc4";

describe("ps2-rc4", () => {
  it("key table is 256 bytes", () => {
    expect(PS2SAVE_CBS_RC4S.length).toBe(256);
  });

  it("is symmetric (double application restores input)", () => {
    for (const len of [0, 1, 33, 1000]) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 31) & 0xff;
      const once = rc4Crypt(PS2SAVE_CBS_RC4S, data);
      const twice = rc4Crypt(PS2SAVE_CBS_RC4S, once);
      expect(Array.from(twice).join(",")).toBe(Array.from(data).join(","));
    }
  });

  it("is deterministic and non-identity", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = rc4Crypt(PS2SAVE_CBS_RC4S, data);
    const b = rc4Crypt(PS2SAVE_CBS_RC4S, data);
    expect(Array.from(a).join(",")).toBe(Array.from(b).join(","));
    expect(Array.from(a).join(",")).not.toBe(Array.from(data).join(","));
  });
});
