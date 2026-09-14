import * as ps1Actions from "@/components/memory-card/ps1-card-actions";
import * as ps2Actions from "@/components/memory-card/ps2-card-actions";
import type { TempBuffer } from "@/hooks/use-memory-card-workspace";
import { SlotTypes } from "@/lib/ps1-memory-card";
import { PS2MemoryCard, type Ps2SaveSnapshot } from "@/lib/ps2/ps2-card";
import {
  Ps2ContainerFormat,
  writePs2Container,
  ZERO_TIME,
} from "@/lib/ps2/ps2-single-save";

import { makeSavePayload, newCard, toFile } from "./psx-helpers";

const { ps1CardActions } = ps1Actions;
const { ps2CardActions, ps2SnapshotCompareBytes } = ps2Actions;

function ps1Caps(
  card: ReturnType<typeof newCard>,
  selectedSlot: number | null,
) {
  return ps1CardActions({
    card,
    saves: card.getSaves(),
    cardId: 1,
    selectedSlot,
    tempBuffer: null,
    commit: () => true,
    commitAsync: () => Promise.resolve(true),
    setSelectedSlot: () => undefined,
    setTempBuffer: () => undefined,
    setError: () => undefined,
  }).caps;
}

function ps2Caps(card: PS2MemoryCard, selectedSave: string | null) {
  return ps2CardActions({
    card,
    saves: card.getSaves(),
    cardId: 1,
    selectedSave,
    tempBuffer: null,
    commit: () => true,
    setPendingReplace: () => undefined,
    setSelectedSave: () => undefined,
    setTempBuffer: () => undefined,
    setError: () => undefined,
  }).caps;
}

describe("PS1 card action caps", () => {
  it("a formatted slot is importable, not deletable", () => {
    const card = newCard();
    expect(ps1Caps(card, null).canImport).toBe(false);
    expect(ps1Caps(card, null).canDelete).toBe(false);
    const empty = ps1Caps(card, 0);
    expect(empty.canImport).toBe(true);
    expect(empty.canDelete).toBe(false);
    expect(empty.canCopy).toBe(false);
    expect(empty.deleteLabel).toBe("Delete save");
  });

  it("copy/paste round-trips a save onto an empty slot", () => {
    const src = newCard();
    src.setSaveBytes(0, makeSavePayload(1));
    expect(ps1Caps(src, 0).canImport).toBe(false);
    expect(ps1Caps(src, 0).canDelete).toBe(true);
    expect(ps1Caps(src, 0).canCopy).toBe(true);

    const copied: { buffer: TempBuffer } = { buffer: null };
    ps1CardActions({
      card: src,
      saves: src.getSaves(),
      cardId: 1,
      selectedSlot: 0,
      tempBuffer: null,
      commit: () => true,
      commitAsync: () => Promise.resolve(true),
      setSelectedSlot: () => undefined,
      setTempBuffer: (next) => {
        copied.buffer = next;
      },
      setError: () => undefined,
    }).copy();
    expect(copied.buffer?.kind).toBe("ps1");

    const dst = newCard();
    const pasted = ps1CardActions({
      card: dst,
      saves: dst.getSaves(),
      cardId: 2,
      selectedSlot: 0,
      tempBuffer: copied.buffer,
      commit: (_id, _label, mutate) => mutate() !== false,
      commitAsync: () => Promise.resolve(true),
      setSelectedSlot: () => undefined,
      setTempBuffer: () => undefined,
      setError: () => undefined,
    });
    expect(pasted.caps.canPaste).toBe(true);
    pasted.paste();
    expect(dst.getSaves()[0].productCode).toBe(src.getSaves()[0].productCode);

    src.toggleDeleteSave(0);
    expect(ps1Caps(src, 0).deleteLabel).toBe("Restore save");
    expect(src.getSaves()[0].slotType).toBe(SlotTypes.DeletedInitial);
  });

  it("move copies then formats the source slot", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const copied: { buffer: TempBuffer } = { buffer: null };
    const selected: Array<number | null> = [];
    const labels: Array<string | readonly string[]> = [];
    const actions = ps1CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSlot: 0,
      tempBuffer: null,
      commit: (_id, label, mutate) => {
        labels.push(label);
        mutate();
        return true;
      },
      commitAsync: () => Promise.resolve(true),
      setSelectedSlot: (slot) => {
        selected.push(slot);
      },
      setTempBuffer: (next) => {
        copied.buffer = next;
      },
      setError: () => undefined,
    });
    expect(actions.caps.canMove).toBe(true);
    actions.move();
    expect(copied.buffer?.kind).toBe("ps1");
    expect(labels).toEqual(["Save moved"]);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Formatted);
    expect(selected).toEqual([null]);
  });

  it("eraseSave formats the slot through commit", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const labels: Array<string | readonly string[]> = [];
    const selected: Array<number | null> = [];
    ps1CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSlot: 0,
      tempBuffer: null,
      commit: (_id, label, mutate) => {
        labels.push(label);
        mutate();
        return true;
      },
      commitAsync: () => Promise.resolve(true),
      setSelectedSlot: (slot) => {
        selected.push(slot);
      },
      setTempBuffer: () => undefined,
      setError: () => undefined,
    }).eraseSave(0);
    expect(labels).toEqual(["Save removed"]);
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Formatted);
    expect(selected).toEqual([null]);
  });
});

describe("PS2 save helpers", () => {
  it("does not export copy/format helpers", () => {
    expect(ps1Actions).not.toHaveProperty("copyPs1Save");
    expect(ps1Actions).not.toHaveProperty("formatPs1Save");
    expect(ps2Actions).not.toHaveProperty("copyPs2Save");
    expect(ps2Actions).not.toHaveProperty("eraseSave");
    expect(ps2Actions).toHaveProperty("ps2SnapshotCompareBytes");
  });

  it("copy/paste and delete flags follow the directory entry", () => {
    const src = PS2MemoryCard.format(8192);
    src.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
      title: "T",
    });
    expect(ps2Caps(src, "SAVE-AAA0001").canDelete).toBe(true);
    expect(ps2Caps(src, "SAVE-AAA0001").deleteLabel).toBe("Delete save");
    expect(ps2Caps(src, "SAVE-AAA0001").canCopy).toBe(true);

    const copied: { buffer: TempBuffer } = { buffer: null };
    ps2CardActions({
      card: src,
      saves: src.getSaves(),
      cardId: 1,
      selectedSave: "SAVE-AAA0001",
      tempBuffer: null,
      commit: () => true,
      setPendingReplace: () => undefined,
      setSelectedSave: () => undefined,
      setTempBuffer: (next) => {
        copied.buffer = next;
      },
      setError: () => undefined,
    }).copy();
    expect(copied.buffer?.kind).toBe("ps2");

    const dst = PS2MemoryCard.format(8192);
    const pasted = ps2CardActions({
      card: dst,
      saves: dst.getSaves(),
      cardId: 2,
      selectedSave: null,
      tempBuffer: copied.buffer,
      commit: (_id, _label, mutate) => mutate() !== false,
      setPendingReplace: () => undefined,
      setSelectedSave: () => undefined,
      setTempBuffer: () => undefined,
      setError: () => undefined,
    });
    expect(pasted.caps.canPaste).toBe(true);
    pasted.paste();
    expect(dst.getSaves().map((s) => s.name)).toEqual(["SAVE-AAA0001"]);

    expect(src.toggleDeleteSave("SAVE-AAA0001")).toBe(true);
    expect(ps2Caps(src, "SAVE-AAA0001").deleteLabel).toBe("Restore save");
    expect(ps2Caps(src, "SAVE-AAA0001").canDelete).toBe(true);
  });

  it("eraseSave permanently removes the save through commit", () => {
    const card = PS2MemoryCard.format(8192);
    card.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
      title: "T",
    });
    const labels: Array<string | readonly string[]> = [];
    const selected: Array<string | null> = [];
    const errors: string[] = [];
    ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: "SAVE-AAA0001",
      tempBuffer: null,
      commit: (_id, label, mutate) => {
        labels.push(label);
        return mutate() !== false;
      },
      setPendingReplace: () => undefined,
      setSelectedSave: (name) => {
        selected.push(name);
      },
      setTempBuffer: () => undefined,
      setError: (message) => {
        if (message !== null) errors.push(message);
      },
    }).eraseSave("SAVE-AAA0001");
    expect(labels).toEqual(["Save removed"]);
    expect(card.getSaves().map((s) => s.name)).toEqual([]);
    expect(selected).toEqual([null]);
    expect(errors).toEqual([]);
  });

  it("eraseSave reports failure without clearing selection", () => {
    const card = PS2MemoryCard.format(8192);
    card.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
      title: "T",
    });
    const selected: Array<string | null> = [];
    const errors: string[] = [];
    ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: "SAVE-AAA0001",
      tempBuffer: null,
      commit: () => false,
      setPendingReplace: () => undefined,
      setSelectedSave: (name) => {
        selected.push(name);
      },
      setTempBuffer: () => undefined,
      setError: (message) => {
        if (message !== null) errors.push(message);
      },
    }).eraseSave("SAVE-AAA0001");
    expect(selected).toEqual([]);
    expect(errors).toEqual(["Failed to erase save"]);
  });

  it("paste on a taken name confirms through commit with two labels", () => {
    const card = PS2MemoryCard.format(8192);
    card.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
      title: "T",
    });
    const copied: { buffer: TempBuffer } = { buffer: null };
    ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: "SAVE-AAA0001",
      tempBuffer: null,
      commit: () => true,
      setPendingReplace: () => undefined,
      setSelectedSave: () => undefined,
      setTempBuffer: (next) => {
        copied.buffer = next;
      },
      setError: () => undefined,
    }).copy();
    const labels: Array<string | readonly string[]> = [];
    let pending = false;
    const actions = ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: "SAVE-AAA0001",
      tempBuffer: copied.buffer,
      commit: (_id, label, mutate) => {
        labels.push(label);
        return mutate() !== false;
      },
      setPendingReplace: (open) => {
        pending = open;
      },
      setSelectedSave: () => undefined,
      setTempBuffer: () => undefined,
      setError: () => undefined,
    });
    expect(actions.caps.canPaste).toBe(true);
    actions.paste();
    expect(pending).toBe(true);
    expect(labels).toEqual([]);
    actions.confirmReplace();
    expect(pending).toBe(false);
    expect(labels).toEqual([["Removed SAVE-AAA0001", "Pasted SAVE-AAA0001"]]);
    expect(actions).not.toHaveProperty("cancelReplace");
  });

  it("importFile commits a raw dump as a single save", async () => {
    const card = PS2MemoryCard.format(8192);
    const selected: string[] = [];
    const actions = ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: null,
      tempBuffer: null,
      commit: (_id, label, mutate) => {
        expect(label).toBe("Save imported");
        return mutate() !== false;
      },
      setPendingReplace: () => undefined,
      setSelectedSave: (name) => {
        if (name !== null) selected.push(name);
      },
      setTempBuffer: () => undefined,
      setError: () => undefined,
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], "save.sdt");
    expect(await actions.importFile(file, "SAVE-RAW0001", "Title")).toBe(true);
    expect(card.getSaves().map((s) => s.name)).toEqual(["SAVE-RAW0001"]);
    expect(selected).toEqual(["SAVE-RAW0001"]);
  });

  it("importFile commits a PSU container and uses its title when none is given", async () => {
    const bytes = await writePs2Container({
      format: Ps2ContainerFormat.Ems,
      title: "FromPsu",
      created: ZERO_TIME,
      modified: ZERO_TIME,
      files: [
        {
          name: "DATA.BIN",
          data: new Uint8Array([9, 8, 7]),
          created: ZERO_TIME,
          modified: ZERO_TIME,
        },
      ],
    });
    const card = PS2MemoryCard.format(8192);
    const actions = ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: null,
      tempBuffer: null,
      commit: (_id, _label, mutate) => mutate() !== false,
      setPendingReplace: () => undefined,
      setSelectedSave: () => undefined,
      setTempBuffer: () => undefined,
      setError: () => undefined,
    });
    const file = toFile(bytes, "save.psu");
    expect(await actions.importFile(file, "SAVE-PSU0001", "")).toBe(true);
    expect(card.getSaves().map((s) => s.name)).toEqual(["SAVE-PSU0001"]);
  });

  it("importFile returns false when a detected container cannot be read", async () => {
    const card = PS2MemoryCard.format(8192);
    const errors: string[] = [];
    const actions = ps2CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSave: null,
      tempBuffer: null,
      commit: () => true,
      setPendingReplace: () => undefined,
      setSelectedSave: () => undefined,
      setTempBuffer: () => undefined,
      setError: (message) => {
        if (message !== null) errors.push(message);
      },
    });
    const file = new File([new TextEncoder().encode("nPort")], "x.npo");
    expect(await actions.importFile(file, "SAVE-BAD0001", "")).toBe(false);
    expect(card.getSaves()).toHaveLength(0);
    expect(errors).toEqual(["Failed to import save"]);
  });
});

describe("PS1 card actions", () => {
  it("importFile uses commitAsync instead of undoCount arithmetic", async () => {
    const card = newCard();
    const captured: number[] = [];
    const file = new File([new Uint8Array([0x51, 0])], "save.mcs");
    const actions = ps1CardActions({
      card,
      saves: card.getSaves(),
      cardId: 1,
      selectedSlot: 0,
      tempBuffer: null,
      commit: () => true,
      commitAsync: async (_id, _label, mutate) => {
        captured.push(card.undoCount);
        await mutate();
        return true;
      },
      setSelectedSlot: () => undefined,
      setTempBuffer: () => undefined,
      setError: () => undefined,
    });
    const before = card.undoCount;
    await actions.importFile(file, 0);
    expect(captured).toEqual([before]);
  });
});

describe("ps2SnapshotCompareBytes", () => {
  const t = { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2000 };

  function snap(
    files: Ps2SaveSnapshot["files"],
    name = "SAVE-AAA0001",
  ): Ps2SaveSnapshot {
    return { name, mode: 0, created: t, modified: t, files };
  }

  it("prefers the dirent-named file", () => {
    const named = new Uint8Array([9, 8, 7]);
    expect(
      ps2SnapshotCompareBytes(
        snap([
          { name: "icon.sys", mode: 0, data: new Uint8Array(80) },
          { name: "SAVE-AAA0001", mode: 0, data: named },
          { name: "other.bin", mode: 0, data: new Uint8Array(200) },
        ]),
      ),
    ).toEqual(named);
  });

  it("falls back to the largest non-icon.sys file", () => {
    const small = new Uint8Array([1]);
    const large = new Uint8Array([2, 3, 4]);
    expect(
      ps2SnapshotCompareBytes(
        snap(
          [
            { name: "icon.sys", mode: 0, data: new Uint8Array(80) },
            { name: "a.bin", mode: 0, data: small },
            { name: "b.bin", mode: 0, data: large },
          ],
          "DIR",
        ),
      ),
    ).toEqual(large);
  });
});
