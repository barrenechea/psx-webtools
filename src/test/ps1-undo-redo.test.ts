import { SlotTypes } from "@/lib/ps1-memory-card";

import { equalBytes, makeSavePayload, newCard } from "./psx-helpers";

describe("J. undo / redo", () => {
  it("J6 undo/redo on an empty history return false", () => {
    const card = newCard();
    expect(card.undo()).toBe(false);
    expect(card.redo()).toBe(false);
    expect(card.undoCount).toBe(0);
    expect(card.redoCount).toBe(0);
  });

  it("J1 undo restores a header change", () => {
    const card = newCard();
    const before = card.getSaves()[0].productCode; // blank card -> ""
    card.setHeaderData(0, "NEWPROD1", "NEWID", "America");
    expect(card.getSaves()[0].productCode).toContain("NEWPROD1");
    expect(card.undoCount).toBe(1);

    expect(card.undo()).toBe(true);
    expect(card.getSaves()[0].productCode).toBe(before);
    expect(card.undoCount).toBe(0);
  });

  it("J2 redo re-applies and a new op clears the redo branch", () => {
    const card = newCard();
    card.setHeaderData(0, "AAA", "ID", "America");
    expect(card.undo()).toBe(true);
    expect(card.redoCount).toBe(1);
    expect(card.redo()).toBe(true);
    expect(card.getSaves()[0].productCode).toContain("AAA");

    // a new mutation clears the redo branch
    card.setHeaderData(0, "BBB", "ID", "America");
    expect(card.redoCount).toBe(0);
  });

  it("J3 undo restores a whole multi-block chain", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(2)); // slots 0 and 1
    const before = card.getSaveBytes(0);

    card.formatSave(0);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Formatted);

    expect(card.undo()).toBe(true);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial);
    expect(card.getSaves()[1].slotType).toBe(SlotTypes.EndLink);
    // the data blocks are restored
    const after = card.getSaveBytes(0);
    expect(equalBytes(after.slice(128), before.slice(128))).toBe(true);
  });

  it("J4 each mutating op pushes exactly one undo; undo/redo shift the counts", () => {
    const card = newCard();
    const u = card.undoCount;
    card.setSaveBytes(0, makeSavePayload(1));
    expect(card.undoCount).toBe(u + 1);
    card.setHeaderData(0, "SCES-00001", "NEWGAME", "America");
    expect(card.undoCount).toBe(u + 2);
    card.setComment(0, "x");
    expect(card.undoCount).toBe(u + 3);
    card.toggleDeleteSave(0);
    expect(card.undoCount).toBe(u + 4);
    card.formatSave(0);
    expect(card.undoCount).toBe(u + 5);

    expect(card.undo()).toBe(true);
    expect(card.undoCount).toBe(u + 4);
    expect(card.redoCount).toBe(1);
    expect(card.redo()).toBe(true);
    expect(card.undoCount).toBe(u + 5);
    expect(card.redoCount).toBe(0);
  });

  it("J5 toggleDeleteSave leaves the data block untouched (only [0] and the XOR change)", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const before = card.getSaveBytes(0);
    card.toggleDeleteSave(0);
    const after = card.getSaveBytes(0);
    expect(after.length).toBe(before.length);
    const diffs: number[] = [];
    for (let i = 0; i < 128; i++) if (before[i] !== after[i]) diffs.push(i);
    expect(diffs).toEqual([0, 127]);
    expect(equalBytes(after.slice(128), before.slice(128))).toBe(true);
  });

  it("J7 undo restores a prior comment; redo re-applies it", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    card.setComment(0, "first");
    card.setComment(0, "second");
    expect(card.undo()).toBe(true);
    expect(card.getSaves()[0].comment).toBe("first");
    expect(card.redo()).toBe(true);
    expect(card.getSaves()[0].comment).toBe("second");
  });
});
