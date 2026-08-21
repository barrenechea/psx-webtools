import { SlotTypes } from "@/lib/ps1-memory-card";

import { makeSavePayload, newCard, toFile } from "./psx-helpers";

describe("I. single-save import (openSingleSave)", () => {
  it("I1 imports an MCS ('Q') save", async () => {
    const payload = makeSavePayload(1); // header[0] == 0x51 'Q'
    const target = newCard();
    const ok = await target.openSingleSave(toFile(payload, "save.mcs"), 0);
    expect(ok).toBe(true);
    expect(target.getSaves()[0].name).toBe("Hiro");
    expect(target.getSaves()[0].slotType).toBe(SlotTypes.Initial);
  });

  it("I2 imports a raw ('SC') save and builds the header from the filename", async () => {
    const data = makeSavePayload(1).slice(128); // data block: [0..1] == "SC"
    const target = newCard();
    const ok = await target.openSingleSave(
      toFile(data, "BA-SCES-00001-TESTGAME"),
      0,
    );
    expect(ok).toBe(true);
    expect(target.getSaves()[0].name).toBe("Hiro");
    expect(target.getSaves()[0].slotType).toBe(SlotTypes.Initial);
  });

  it("I6 rejects a file that is none of the known magics", async () => {
    const data = new Uint8Array(200); // no Q / SC / V magic
    const target = newCard();
    const ok = await target.openSingleSave(toFile(data, "bad.xyz"), 0);
    expect(ok).toBe(false);
  });
});
