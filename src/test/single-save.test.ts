import { SlotTypes } from "@/lib/ps1-memory-card";

import {
  bytesAt,
  equalBytes,
  HEADER_SIZE,
  makeSavePayload,
  newCard,
  toBytes,
  toFile,
} from "./psx-helpers";

// Synthetic Action Replay single-save: a 54-byte header (region + product code +
// identifier in the first 20 bytes) followed by the raw data block, which must
// begin with "SC" at offset 54.
function makeArFile(): Uint8Array {
  const dataBlock = makeSavePayload(1).slice(HEADER_SIZE); // [0..1]=="SC", name at [4..7]
  const file = new Uint8Array(54 + dataBlock.length);
  file.set(toBytes("BA"), 0); // region
  file.set(toBytes("SCES-00001"), 2); // product code
  file.set(toBytes("TESTGAME"), 12); // identifier
  file.set(dataBlock, 54);
  return file;
}

// Synthetic PSV container sized for the import path: [1]=="V", [60]==1, region +
// product code + identifier at [100..120], and the data block starting at 132.
function makePsvFile(): Uint8Array {
  const dataBlock = makeSavePayload(1).slice(HEADER_SIZE);
  const file = new Uint8Array(132 + dataBlock.length);
  file[1] = 0x56; // 'V'
  file[60] = 1; // PS1 type marker
  file.set(toBytes("BA"), 100);
  file.set(toBytes("SCES-00001"), 102);
  file.set(toBytes("TESTGAME"), 112);
  file.set(dataBlock, 132);
  return file;
}

describe("I. single-save import (openSingleSave)", () => {
  it("I1 imports an MCS ('Q') save", async () => {
    const payload = makeSavePayload(1); // header[0] == 0x51 'Q'
    const target = newCard();
    const ok = await target.openSingleSave(toFile(payload, "save.mcs"), 0);
    expect(ok).toBe(true);
    expect(target.getSaves()[0].name).toBe("Hiro");
    expect(target.getSaves()[0].slotType).toBe(SlotTypes.Initial);
  });

  it("I2/I8 imports a raw ('SC') save and builds the header from the filename", async () => {
    const data = makeSavePayload(1).slice(HEADER_SIZE); // data block: [0..1] == "SC"
    const target = newCard();
    const ok = await target.openSingleSave(
      toFile(data, "BASCES-00001TESTGAME"),
      0,
    );
    expect(ok).toBe(true);
    const s = target.getSaves()[0];
    expect(s.name).toBe("Hiro");
    expect(s.slotType).toBe(SlotTypes.Initial);
    // the filename is written into the header (region / product code / id)
    expect(s.regionRaw).toBe("BA");
    expect(s.region).toBe("America");
    expect(s.productCode).toBe("SCES-00001");
    expect(s.identifier).toBe("TESTGAME");
  });

  it("I13 accepts a lowercase 'sc' raw save", async () => {
    const data = makeSavePayload(1).slice(HEADER_SIZE);
    data[0] = 0x73; // 's'
    data[1] = 0x63; // 'c' -> full magic "sc"
    const target = newCard();
    const ok = await target.openSingleSave(
      toFile(data, "BASCES-00001TESTGAME"),
      0,
    );
    expect(ok).toBe(true);
    expect(target.getSaves()[0].name).toBe("Hiro");
  });

  it("I3/I9 imports an Action Replay save (header from the file)", async () => {
    const target = newCard();
    const ok = await target.openSingleSave(toFile(makeArFile(), "save.psv"), 0);
    expect(ok).toBe(true);
    const s = target.getSaves()[0];
    expect(s.name).toBe("Hiro");
    expect(s.slotType).toBe(SlotTypes.Initial);
    expect(s.regionRaw).toBe("BA");
    expect(s.productCode).toBe("SCES-00001");
    expect(s.identifier).toBe("TESTGAME");
  });

  it("I4 imports a PSV save (header at [100..120], data at [132..])", async () => {
    const target = newCard();
    const ok = await target.openSingleSave(
      toFile(makePsvFile(), "save.psv"),
      0,
    );
    expect(ok).toBe(true);
    const s = target.getSaves()[0];
    expect(s.name).toBe("Hiro");
    expect(s.slotType).toBe(SlotTypes.Initial);
    expect(s.regionRaw).toBe("BA");
    expect(s.productCode).toBe("SCES-00001");
    expect(s.identifier).toBe("TESTGAME");
  });

  it("I12 rejects a PSV file whose type byte is not 1", async () => {
    const file = makePsvFile();
    file[60] = 0; // not a PS1 save
    const target = newCard();
    expect(await target.openSingleSave(toFile(file, "save.psv"), 0)).toBe(
      false,
    );
  });

  it("I6 rejects a file that is none of the known magics", async () => {
    const data = new Uint8Array(200); // no Q / SC / V magic
    const target = newCard();
    const ok = await target.openSingleSave(toFile(data, "bad.xyz"), 0);
    expect(ok).toBe(false);
  });
});

describe("I. single-save export (makePsvSave)", () => {
  it("I4 exports a PSV save with the fixed container layout and the data block intact", async () => {
    type MakePsvSave = { makePsvSave(save: Uint8Array): Promise<Uint8Array> };
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const save = card.getSaveBytes(0);
    const psv = await (card as unknown as MakePsvSave).makePsvSave(save);

    expect(psv.length).toBe(save.length + 4); // 8324
    expect(bytesAt(psv, 1, 3)).toEqual(toBytes("VSP"));
    expect(psv[0x38]).toBe(0x14);
    expect(psv[0x3c]).toBe(1);
    expect(psv[0x44]).toBe(0x84);
    expect(psv[0x49]).toBe(2);
    expect(psv[0x60]).toBe(3);
    expect(psv[0x61]).toBe(0x90);
    // size fields (LE32) == the data-block size
    expect(new DataView(psv.buffer).getUint32(0x40, true)).toBe(8192);
    expect(new DataView(psv.buffer).getUint32(0x5c, true)).toBe(8192);
    // the header region (region / product code / id) is carried into [100..120]
    expect(bytesAt(psv, 100, 2)).toEqual(toBytes("BA"));
    expect(bytesAt(psv, 102, 10)).toEqual(toBytes("SCES-00001"));
    // the full 8192-byte data block is preserved 1:1
    expect(
      equalBytes(psv.slice(0x84, 0x84 + 8192), save.slice(0x80, 0x80 + 8192)),
    ).toBe(true);
  });
});
