import { buildIconSys, parseIconSys } from "@/lib/ps2/ps2-iconsys";

const GTA_VCS_SJIS = [
  0x82, 0x66, 0x82, 0x73, 0x82, 0x60, 0x81, 0x40, 0x82, 0x75, 0x82, 0x62, 0x82,
  0x72,
];

describe("icon.sys titles", () => {
  it("encodes ASCII titles with the console fullwidth map", () => {
    const icon = buildIconSys({ title: "GTA VCS" });
    expect([...icon.subarray(0xc0, 0xc0 + 14)]).toEqual(GTA_VCS_SJIS);
    expect(icon[0xc0 + 14]).toBe(0);
    expect(parseIconSys(icon).title).toBe("GTA VCS");
  });

  it("still NFKC-decodes planted Shift-JIS", () => {
    const icon = buildIconSys({ title: "" });
    icon.set(GTA_VCS_SJIS, 0xc0);
    expect(parseIconSys(icon).title).toBe("GTA VCS");
  });

  it("matches Sony map quirks, not generic CP932", () => {
    const eq = (title: string, bytes: number[]) => {
      const icon = buildIconSys({ title });
      expect([...icon.subarray(0xc0, 0xc0 + bytes.length)]).toEqual(bytes);
      expect(icon[0xc0 + bytes.length]).toBe(0);
    };
    eq("=", [0x81, 0x5c]);
    eq("\\", [0x81, 0x8f]);
    eq("~", [0x81, 0x60]);
    eq("\x7f", [0x81, 0x51]);
  });

  it("replaces unencodable bytes with a fullwidth space", () => {
    const icon = buildIconSys({ title: "\x01" });
    expect([...icon.subarray(0xc0, 0xc2)]).toEqual([0x81, 0x40]);
  });

  it("copies only console-legal SJIS pairs", () => {
    const copied = buildIconSys({
      title: String.fromCharCode(0x82, 0x66),
    });
    expect([...copied.subarray(0xc0, 0xc2)]).toEqual([0x82, 0x66]);
    const denied = buildIconSys({
      title: String.fromCharCode(0xea, 0x40),
    });
    expect([...denied.subarray(0xc0, 0xc2)]).toEqual([0x81, 0x40]);
    expect(denied[0xc0]).not.toBe(0xea);
  });
});
