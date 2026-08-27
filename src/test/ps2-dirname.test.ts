import {
  parsePs2SaveDirName,
  ps2SaveProductCode,
  ps2SaveRegion,
} from "@/lib/ps2/ps2-dirname";

describe("PS2 save directory name", () => {
  it("splits Key(2) + ProductNumber(10) + identifier", () => {
    expect(parsePs2SaveDirName("BASLUS-20062GTA30000")).toEqual({
      key: "BA",
      productNumber: "SLUS-20062",
      identifier: "GTA30000",
    });
    expect(parsePs2SaveDirName("BESCES-53133GodOfWar")).toEqual({
      key: "BE",
      productNumber: "SCES-53133",
      identifier: "GodOfWar",
    });
  });

  it("shows SLUS-20062 rather than LUS-20062", () => {
    expect(ps2SaveProductCode("BASLUS-20062GTA30000")).toBe("SLUS-20062");
    expect(ps2SaveProductCode("BASLUS-21590GTA40001")).toBe("SLUS-21590");
  });

  it("shows DATA-SYSTEM rather than ATA-SYSTE", () => {
    expect(ps2SaveProductCode("BEDATA-SYSTEM")).toBe("DATA-SYSTEM");
    expect(ps2SaveProductCode("BADATA-SYSTEM")).toBe("DATA-SYSTEM");
    expect(ps2SaveProductCode("BIDATA-SYSTEM")).toBe("DATA-SYSTEM");
  });

  it("shows EXEC-SYSTEM for OSDSYS browser-exec dirs", () => {
    expect(ps2SaveProductCode("BIEXEC-SYSTEM")).toBe("EXEC-SYSTEM");
    expect(ps2SaveProductCode("BREXEC-SYSTEM")).toBe("EXEC-SYSTEM");
  });

  it("maps the two-byte directory key to a DataCenter region", () => {
    expect(ps2SaveRegion("BASLUS-20062GTA30000")).toBe("America");
    expect(ps2SaveRegion("BESCES-53133GodOfWar")).toBe("Europe");
    expect(ps2SaveRegion("BISLPM-65078MGS2")).toBe("Japan");
    expect(ps2SaveRegion("BREXEC-SYSTEM")).toBe("");
  });
});
