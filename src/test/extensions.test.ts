import {
  CardExtensions,
  CardTypes,
  getFileExtension,
  hasFileExtension,
  RAW_EXTENSIONS,
  SingleSaveExtensions,
  SingleSaveTypes,
  SlotTypes,
  withSingleExtension,
} from "@/lib/ps1-memory-card";
import {
  PS2_RAW_EXTENSIONS,
  PS2_SINGLE_SAVE_EXTENSIONS,
  Ps2CardFormats,
  Ps2SingleSaveTypes,
} from "@/lib/ps2/ps2-types";

describe("Contracts. enums & extension maps", () => {
  it("CardTypes values are stable", () => {
    expect(CardTypes.Raw).toBe(0);
    expect(CardTypes.Gme).toBe(1);
    expect(CardTypes.Vgs).toBe(2);
    expect(CardTypes.Vmp).toBe(3);
    expect(CardTypes.Mcx).toBe(4);
  });

  it("SlotTypes are the on-disk header bytes", () => {
    expect(SlotTypes.Formatted).toBe(0xa0);
    expect(SlotTypes.Initial).toBe(0x51);
    expect(SlotTypes.MiddleLink).toBe(0x52);
    expect(SlotTypes.EndLink).toBe(0x53);
    expect(SlotTypes.DeletedInitial).toBe(0xa1);
    expect(SlotTypes.DeletedMiddleLink).toBe(0xa2);
    expect(SlotTypes.DeletedEndLink).toBe(0xa3);
    expect(SlotTypes.Corrupted).toBe(0xff);
  });

  it("SingleSaveTypes values are stable", () => {
    expect(SingleSaveTypes.Raw).toBe(0);
    expect(SingleSaveTypes.Mcs).toBe(1);
    expect(SingleSaveTypes.Psv).toBe(2);
    expect(SingleSaveTypes.Psx).toBe(3);
  });

  it("CardExtensions map", () => {
    expect(CardExtensions[CardTypes.Raw]).toBe(".mcr");
    expect(CardExtensions[CardTypes.Gme]).toBe(".gme");
    expect(CardExtensions[CardTypes.Vgs]).toBe(".vgs");
    expect(CardExtensions[CardTypes.Vmp]).toBe(".vmp");
    expect(CardExtensions[CardTypes.Mcx]).toBe(".mcx");
  });

  it("SingleSaveExtensions map", () => {
    expect(SingleSaveExtensions[SingleSaveTypes.Mcs]).toBe(".mcs");
    expect(SingleSaveExtensions[SingleSaveTypes.Raw]).toBe(".raw");
    expect(SingleSaveExtensions[SingleSaveTypes.Psv]).toBe(".psv");
    expect(SingleSaveExtensions[SingleSaveTypes.Psx]).toBe(".mcb");
  });

  it("RAW_EXTENSIONS covers the raw/import variants", () => {
    expect(RAW_EXTENSIONS).toContain(".mcr");
    expect(RAW_EXTENSIONS).toContain(".bin");
    expect(RAW_EXTENSIONS).toContain(".srm");
  });

  it("PS2 format enums and extension lists are stable", () => {
    expect(Ps2CardFormats.Raw).toBe(0);
    expect(Ps2SingleSaveTypes.Sdt).toBe(0);
    expect([...PS2_RAW_EXTENSIONS]).toEqual([".mcd", ".bin", ".ps2"]);
    expect([...PS2_SINGLE_SAVE_EXTENSIONS]).toEqual([".sdt"]);
  });
});

describe("free functions: extension handling", () => {
  it("withSingleExtension strips stacked known extensions and appends once", () => {
    expect(withSingleExtension("card.mcr", ".gme")).toBe("card.gme");
    expect(withSingleExtension("card", ".gme")).toBe("card.gme");
    expect(withSingleExtension("card.mcr.mcr", ".mcx")).toBe("card.mcx");
    expect(withSingleExtension("card.gme", ".gme")).toBe("card.gme");
    expect(withSingleExtension("card.ps2", ".mcd")).toBe("card.mcd");
    expect(withSingleExtension("card.sdt", ".sdt")).toBe("card.sdt");
    expect(withSingleExtension("save.sdt", ".psu")).toBe("save.psu");
    expect(withSingleExtension("save.psu", ".sdt")).toBe("save.sdt");
    expect(withSingleExtension("save.max", ".psu")).toBe("save.psu");
  });

  it("hasFileExtension", () => {
    expect(hasFileExtension("card.mcr")).toBe(true);
    expect(hasFileExtension("card")).toBe(false);
    expect(hasFileExtension(".hidden")).toBe(false);
    expect(hasFileExtension("card.")).toBe(false);
  });

  it("getFileExtension", () => {
    expect(getFileExtension("card.mcr")).toBe(".mcr");
    expect(getFileExtension("card")).toBe("");
    expect(getFileExtension("a/b/c.gme")).toBe(".gme");
  });
});
