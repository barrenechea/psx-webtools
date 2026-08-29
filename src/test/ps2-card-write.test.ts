// PS2MemoryCard write side: console-style delete, copy and single-save import
// with page-granular undo/redo, plus formatCard resizing. Created layouts are
// pinned to real-card values (entry modes, dir_entry ordinals, FAT chains).

import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { checkPage } from "@/lib/ps2/ps2-ecc";
import { buildIconSys, ICON_SYS_SIZE } from "@/lib/ps2/ps2-iconsys";
import {
  CLUSTER_DATA_SIZE,
  clusterChain,
  FAT_ALLOCATED_BIT,
  FAT_EOF,
  fatGet,
  fatSet,
  findFreeCluster,
  format2,
  PAGE_SIZE,
  PARENT_ENTRY,
  parseSuperblock,
  type Ps2Superblock,
  readDirectory,
  readDirEntry,
  SELF_ENTRY,
  writeClusterData,
  writeDirEntry,
} from "@/lib/ps2/ps2-pfs";
import { readPs2Container } from "@/lib/ps2/ps2-single-save";
import type { Ps2DateTime } from "@/lib/ps2/ps2-types";

import { toFile } from "./psx-helpers";

const T: Ps2DateTime = {
  sec: 41,
  min: 0,
  hour: 6,
  day: 12,
  month: 1,
  year: 2000,
};

function pattern(len: number, seed = 0): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 7 + 13 + seed) & 0xff;
  return out;
}

function everyPageClean(raw: Uint8Array): void {
  for (let p = 0; p < raw.length; p += PAGE_SIZE) {
    expect(checkPage(raw.subarray(p, p + PAGE_SIZE))).not.toBe("corrupt");
  }
}

function mustFree(raw: Uint8Array, sb: Ps2Superblock): number {
  const free = findFreeCluster(raw, sb);
  if (free === null) throw new Error("card full");
  return free;
}

// Allocate `count` clusters and link them into one chain. Each cluster is
// claimed (self-linked) the moment it is allocated so findFreeCluster skips
// it before the final links are written.
function allocChain(
  raw: Uint8Array,
  sb: Ps2Superblock,
  count: number,
): number[] {
  const chain: number[] = [];
  for (let i = 0; i < count; i++) {
    const cl = mustFree(raw, sb);
    chain.push(cl);
    fatSet(raw, sb, cl, FAT_ALLOCATED_BIT | cl);
  }
  for (let i = 0; i < chain.length - 1; i++) {
    fatSet(raw, sb, chain[i], FAT_ALLOCATED_BIT | chain[i + 1]);
  }
  fatSet(raw, sb, chain[chain.length - 1], FAT_EOF);
  return chain;
}

function padded(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(CLUSTER_DATA_SIZE);
  out.set(data);
  return out;
}

// A save whose data file is NOT named after the directory (the model API
// always uses the save name), to exercise the single-save fallback pick.
function foreignFileCard(): PS2MemoryCard {
  const raw = format2(8192);
  const sb = parseSuperblock(raw);
  const icon = buildIconSys({ title: "Foreign" });
  const data = pattern(500, 9);
  const dirChain = allocChain(raw, sb, 2);
  const iconChain = allocChain(raw, sb, 1);
  const dataChain = allocChain(raw, sb, 1);
  writeClusterData(raw, sb.allocOffset + iconChain[0], padded(icon));
  writeClusterData(raw, sb.allocOffset + dataChain[0], padded(data));
  writeDirEntry(raw, sb, dirChain[0], 0, {
    name: SELF_ENTRY,
    mode: 0x8427,
    length: 0,
    cluster: 0,
    dirEntry: 2,
    created: T,
    modified: T,
    attr: 0,
  });
  writeDirEntry(raw, sb, dirChain[0], 1, {
    name: PARENT_ENTRY,
    mode: 0x8427,
    length: 0,
    cluster: 0,
    dirEntry: 0,
    created: T,
    modified: T,
    attr: 0,
  });
  writeDirEntry(raw, sb, dirChain[1], 0, {
    name: "icon.sys",
    mode: 0x8497,
    length: ICON_SYS_SIZE,
    cluster: iconChain[0],
    dirEntry: 0,
    created: T,
    modified: T,
    attr: 0,
  });
  writeDirEntry(raw, sb, dirChain[1], 1, {
    name: "DATA01",
    mode: 0x8497,
    length: data.length,
    cluster: dataChain[0],
    dirEntry: 0,
    created: T,
    modified: T,
    attr: 0,
  });
  const rootRel = allocChain(raw, sb, 1)[0];
  fatSet(raw, sb, 0, FAT_ALLOCATED_BIT | rootRel);
  fatSet(raw, sb, rootRel, FAT_EOF);
  writeDirEntry(raw, sb, rootRel, 0, {
    name: "SAVE-FFF0001",
    mode: 0x8427,
    length: 4,
    cluster: dirChain[0],
    dirEntry: 0,
    created: T,
    modified: T,
    attr: 0,
  });
  return PS2MemoryCard.fromRaw(raw);
}

describe("PS2MemoryCard importSingleSave", () => {
  it("creates a real-card-faithful save directory", () => {
    const card = PS2MemoryCard.format(8192);
    const data = pattern(2500);
    expect(
      card.importSingleSave("BASLUS-21590GTA40001", data, {
        title: "Grand Theft Auto IV",
      }),
    ).toBe(true);

    const saves = card.getSaves();
    expect(saves.map((s) => s.name)).toEqual(["BASLUS-21590GTA40001"]);
    expect(saves[0].title).toBe("Grand Theft Auto IV");
    expect(saves[0].hidden).toBe(false);
    expect(saves[0].totalSize).toBe(2500);
    expect(saves[0].files.map((f) => [f.name, f.size])).toEqual([
      ["icon.sys", ICON_SYS_SIZE],
      ["BASLUS-21590GTA40001", 2500],
    ]);
    expect([
      ...card.readFile("BASLUS-21590GTA40001", "BASLUS-21590GTA40001"),
    ]).toEqual([...data]);
    expect(card.getIconSys("BASLUS-21590GTA40001")?.title).toBe(
      "Grand Theft Auto IV",
    );

    // Layout: first save extends the root chain; root entry in cluster 1.
    const raw = card.getRawData();
    const sb = card.getSuperblock();
    expect(clusterChain(raw, sb, 0)).toEqual([0, 1]);
    const root = readDirEntry(raw, sb, 1, 0);
    expect(root.name).toBe("BASLUS-21590GTA40001");
    expect(root.mode).toBe(0x8427);
    expect(root.length).toBe(4);
    expect(root.cluster).toBe(2);
    // Save dir (relative 2): "." and ".." exactly as on a real card.
    const dot = readDirEntry(raw, sb, 2, 0);
    expect([dot.name, dot.mode, dot.length, dot.cluster, dot.dirEntry]).toEqual(
      [SELF_ENTRY, 0x8427, 0, 0, 2],
    );
    const dotdot = readDirEntry(raw, sb, 2, 1);
    expect([dotdot.name, dotdot.mode, dotdot.cluster]).toEqual([
      PARENT_ENTRY,
      0x8427,
      0,
    ]);
    // File entries: icon.sys then the data file (chain 5,6,7).
    const icon = readDirEntry(raw, sb, 3, 0);
    expect([icon.name, icon.mode, icon.length, icon.cluster]).toEqual([
      "icon.sys",
      0x8497,
      ICON_SYS_SIZE,
      4,
    ]);
    const file = readDirEntry(raw, sb, 3, 1);
    expect([file.name, file.mode, file.length, file.cluster]).toEqual([
      "BASLUS-21590GTA40001",
      0x8497,
      2500,
      5,
    ]);
    // FAT chains (fatGet returns unsigned values).
    expect(fatGet(raw, sb, 0)).toBe((FAT_ALLOCATED_BIT | 1) >>> 0);
    expect(fatGet(raw, sb, 1)).toBe(FAT_EOF);
    expect(fatGet(raw, sb, 2)).toBe((FAT_ALLOCATED_BIT | 3) >>> 0);
    expect(fatGet(raw, sb, 3)).toBe(FAT_EOF);
    expect(fatGet(raw, sb, 4)).toBe(FAT_EOF);
    expect(fatGet(raw, sb, 5)).toBe((FAT_ALLOCATED_BIT | 6) >>> 0);
    expect(fatGet(raw, sb, 6)).toBe((FAT_ALLOCATED_BIT | 7) >>> 0);
    expect(fatGet(raw, sb, 7)).toBe(FAT_EOF);
    everyPageClean(raw);
  });

  it("rejects invalid names, duplicates and empty data", () => {
    const card = PS2MemoryCard.format(8192);
    const before = card.getRawChecksum();
    for (const name of [
      "A".repeat(33),
      "SAVE/NAME",
      "SAVE?NAME",
      "SAVE*NAME",
      ".",
      "..",
      "",
    ]) {
      expect(card.importSingleSave(name, pattern(100))).toBe(false);
    }
    expect(card.importSingleSave("VALID-NAME1", new Uint8Array(0))).toBe(false);
    expect(card.getRawChecksum()).toBe(before);
    expect(card.undoCount).toBe(0);

    expect(card.importSingleSave("VALID-NAME1", pattern(100))).toBe(true);
    expect(card.importSingleSave("VALID-NAME1", pattern(100))).toBe(false);
    expect(card.getSaves().map((s) => s.name)).toEqual(["VALID-NAME1"]);
    expect(card.undoCount).toBe(1);
  });

  it("sets PS1/PocketStation/hidden flags", () => {
    const card = PS2MemoryCard.format(8192);
    expect(
      card.importSingleSave("SAVE-PS10001", pattern(100), {
        ps1: true,
        hidden: true,
      }),
    ).toBe(true);
    const save = card.getSaves()[0];
    expect(save.hidden).toBe(true);
    expect(save.ps1).toBe(true);
    expect(save.pocketStation).toBe(false);
    const raw = card.getRawData();
    const sb = card.getSuperblock();
    expect(readDirEntry(raw, sb, 1, 0).mode).toBe(0x8427 | 0x2000 | 0x1000);
  });
});

describe("PS2MemoryCard importContainer", () => {
  it("creates a save from a container's files and generates icon.sys", () => {
    const card = PS2MemoryCard.format(8192);
    const a = pattern(300, 1);
    const b = pattern(600, 2);
    expect(
      card.importContainer(
        "SAVE-MAX0001",
        [
          { name: "SAVE01.BIN", data: a },
          { name: "PIC.PNG", data: b },
        ],
        { title: "Container Game" },
      ),
    ).toBe(true);
    const save = card.getSaves()[0];
    expect(save.name).toBe("SAVE-MAX0001");
    expect(save.title).toBe("Container Game");
    expect(save.files.map((f) => f.name).sort()).toEqual([
      "PIC.PNG",
      "SAVE01.BIN",
      "icon.sys",
    ]);
    expect([...card.readFile("SAVE-MAX0001", "SAVE01.BIN")]).toEqual([...a]);
    expect([...card.readFile("SAVE-MAX0001", "PIC.PNG")]).toEqual([...b]);
    expect(card.getIconSys("SAVE-MAX0001")?.title).toBe("Container Game");
  });

  it("keeps the container's icon.sys when present", () => {
    const card = PS2MemoryCard.format(8192);
    const icon = buildIconSys({ title: "Original" });
    const a = pattern(100, 3);
    card.importContainer("SAVE-ICN0001", [
      { name: "icon.sys", data: icon },
      { name: "SAVE01.BIN", data: a },
    ]);
    expect(
      card
        .getSaves()[0]
        .files.map((f) => f.name)
        .sort(),
    ).toEqual(["SAVE01.BIN", "icon.sys"]);
    expect(card.getIconSys("SAVE-ICN0001")?.title).toBe("Original");
  });

  it("rejects empty file sets and duplicate names", () => {
    const card = PS2MemoryCard.format(8192);
    expect(card.importContainer("SAVE-EMPTY0001", [])).toBe(false);
    card.importContainer("SAVE-DUP0001", [
      { name: "A.BIN", data: pattern(50) },
    ]);
    expect(
      card.importContainer("SAVE-DUP0001", [
        { name: "B.BIN", data: pattern(50) },
      ]),
    ).toBe(false);
  });
});

describe("PS2MemoryCard container export", () => {
  const extFor: Record<string, string> = {
    max: "x.max",
    ems: "x.psu",
    sharkport: "x.sps",
    xport: "x.xps",
    codebreaker: "x.cbs",
    psv: "x.psv",
  };
  it("round-trips a save through every container format", async () => {
    const card = PS2MemoryCard.format(8192);
    const a = pattern(300, 1);
    const b = pattern(600, 2);
    card.importContainer("SAVE-MAX0001", [
      { name: "SAVE01.BIN", data: a },
      { name: "PIC.PNG", data: b },
    ]);
    expect(
      card
        .getSaveFiles("SAVE-MAX0001")
        .map((f) => f.name)
        .sort(),
    ).toEqual(["PIC.PNG", "SAVE01.BIN", "icon.sys"]);

    for (const format of [
      "max",
      "ems",
      "sharkport",
      "xport",
      "codebreaker",
      "psv",
    ] as const) {
      const bytes = (await card.getContainerBytes("SAVE-MAX0001", format))!;
      const container = await readPs2Container(bytes, extFor[format]);
      expect(container.title).toBe("SAVE-MAX0001");
      const byName = new Map(container.files.map((f) => [f.name, f.data]));
      expect([...byName.get("SAVE01.BIN")!]).toEqual([...a]);
      expect([...byName.get("PIC.PNG")!]).toEqual([...b]);
    }
  });

  it("returns null/empty for unknown saves", async () => {
    const card = PS2MemoryCard.format(8192);
    expect(await card.getContainerBytes("NOPE", "max")).toBeNull();
    expect(card.getSaveFiles("NOPE")).toEqual([]);
  });
});

describe("PS2MemoryCard deleteSave", () => {
  it("clears the exists bit, keeps name and chain, and is undoable", () => {
    const card = PS2MemoryCard.format(8192);
    card.importSingleSave("SAVE-AAA0001", pattern(1000));
    card.importSingleSave("SAVE-BBB0002", pattern(2000));
    const sb = card.getSuperblock();
    const before = readDirEntry(card.getRawData(), sb, 1, 0);

    expect(card.deleteSave("SAVE-AAA0001")).toBe(true);
    const raw = card.getRawData();
    const entry = readDirEntry(raw, sb, before.relCluster, before.slot);
    expect(entry.exists).toBe(false);
    expect(entry.mode).toBe(0x427); // 0x8427 with the exists bit cleared
    expect(entry.name).toBe("SAVE-AAA0001");
    expect(entry.cluster).toBe(before.cluster);
    // The save's clusters stay allocated in their chains.
    expect(fatGet(raw, sb, before.cluster)).toBe(
      (FAT_ALLOCATED_BIT | (before.cluster + 1)) >>> 0,
    );
    expect(card.getSaves().map((s) => s.name)).toEqual(["SAVE-BBB0002"]);
    expect([...card.readFile("SAVE-BBB0002", "SAVE-BBB0002")]).toEqual([
      ...pattern(2000),
    ]);
    everyPageClean(raw);

    expect(card.deleteSave("SAVE-AAA0001")).toBe(false); // already gone
    expect(card.deleteSave("NOPE")).toBe(false);

    expect(card.undo()).toBe(true);
    expect(card.getSaves().map((s) => s.name)).toEqual([
      "SAVE-AAA0001",
      "SAVE-BBB0002",
    ]);
    const restored = readDirEntry(
      card.getRawData(),
      sb,
      before.relCluster,
      before.slot,
    );
    expect(restored.exists).toBe(true);
    expect(restored.mode).toBe(0x8427);
    expect(card.redo()).toBe(true);
    expect(card.getSaves().map((s) => s.name)).toEqual(["SAVE-BBB0002"]);
    everyPageClean(card.getRawData());
  });
});

describe("PS2MemoryCard copySave", () => {
  it("clones files and flags under a new name", () => {
    const card = PS2MemoryCard.format(8192);
    const data = pattern(3000);
    card.importSingleSave("SAVE-AAA0001", data, {
      title: "Original",
      hidden: true,
      ps1: true,
    });
    expect(card.copySave("NOPE", "SAVE-XXX0001")).toBe(false);
    expect(card.copySave("SAVE-AAA0001", "SAVE-AAA0001")).toBe(false);
    expect(card.copySave("SAVE-AAA0001", "SAVE-CCC0003")).toBe(true);

    const saves = card.getSaves();
    expect(saves.map((s) => s.name)).toEqual(["SAVE-AAA0001", "SAVE-CCC0003"]);
    expect(saves[0].hidden).toBe(true);
    expect(saves[0].ps1).toBe(true);
    expect(saves[1].hidden).toBe(true);
    expect(saves[1].ps1).toBe(true);
    const original = card.readFile("SAVE-AAA0001", "SAVE-AAA0001");
    expect([...card.readFile("SAVE-CCC0003", "SAVE-CCC0003")]).toEqual([
      ...original,
    ]);

    // Copy root entry: second slot, hidden+PS1 mode, dir_entry ordinal 3.
    const raw = card.getRawData();
    const sb = card.getSuperblock();
    const copy = readDirEntry(raw, sb, 1, 1);
    expect(copy.name).toBe("SAVE-CCC0003");
    expect(copy.mode).toBe(0x8427 | 0x2000 | 0x1000);
    expect(readDirEntry(raw, sb, copy.cluster, 0).dirEntry).toBe(3);
    // File modes carried over: icon.sys plain, data file PS1.
    const copyFiles = readDirectory(raw, sb, copy.cluster).filter(
      (f) => f.isFile,
    );
    expect(copyFiles.map((f) => [f.name, f.mode, f.ps1])).toEqual([
      ["icon.sys", 0x8497, false],
      ["SAVE-CCC0003", 0x9497, true],
    ]);
    everyPageClean(raw);

    // Independence: deleting the original leaves the copy fully readable.
    expect(card.deleteSave("SAVE-AAA0001")).toBe(true);
    expect([...card.readFile("SAVE-CCC0003", "SAVE-CCC0003")]).toEqual([
      ...original,
    ]);
    everyPageClean(card.getRawData());
  });
});

describe("PS2MemoryCard undo/redo", () => {
  it("tracks edits, clears the redo branch, and caps history", () => {
    const card = PS2MemoryCard.format(8192);
    expect(card.undoCount).toBe(0);
    expect(card.redoCount).toBe(0);
    expect(card.undo()).toBe(false);
    expect(card.redo()).toBe(false);

    for (let i = 0; i < 3; i++) {
      card.importSingleSave(
        `SAVE-XXX${String(i).padStart(3, "0")}`,
        pattern(100 + i),
      );
    }
    expect(card.undoCount).toBe(3);
    card.undo();
    expect(card.redoCount).toBe(1);
    expect(card.getSaves().length).toBe(2);
    card.redo();
    expect(card.getSaves().length).toBe(3);
    expect(card.redoCount).toBe(0);
    // A new edit invalidates the redo branch.
    card.undo();
    card.undo();
    expect(card.redoCount).toBe(2);
    card.importSingleSave("SAVE-NEW0001", pattern(50));
    expect(card.redoCount).toBe(0);

    // History is capped; the oldest step is evicted.
    const big = PS2MemoryCard.format(8192);
    for (let i = 0; i < 51; i++) {
      big.importSingleSave(
        `SAVE-YYY${String(i).padStart(3, "0")}`,
        pattern(100),
      );
    }
    expect(big.undoCount).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(big.undo()).toBe(true);
    }
    expect(big.getSaves().length).toBe(1); // the first import is unrecoverable
    expect(big.getSaves()[0].name).toBe("SAVE-YYY000");
    expect(big.undo()).toBe(false);
  });
});

describe("PS2MemoryCard changed flag", () => {
  it("follows edits, reverts and device reads", () => {
    const card = PS2MemoryCard.format(8192);
    expect(card.changed).toBe(false);
    expect(card.importSingleSave("SAVE-AAA0001", pattern(100))).toBe(true);
    expect(card.changed).toBe(true);
    expect(card.undo()).toBe(true);
    expect(card.changed).toBe(false); // back to the saved state
    card.markChanged();
    expect(card.changed).toBe(true);
  });
});

describe("PS2MemoryCard getSingleSaveBytes", () => {
  it("prefers the file named after the save, else the largest data file", () => {
    const card = PS2MemoryCard.format(8192);
    const data = pattern(700, 5);
    card.importSingleSave("SAVE-AAA0001", data);
    expect([...card.getSingleSaveBytes("SAVE-AAA0001")!]).toEqual([...data]);
    expect(card.getSingleSaveBytes("NOPE")).toBeNull();

    const foreign = foreignFileCard();
    expect([...foreign.getSingleSaveBytes("SAVE-FFF0001")!]).toEqual([
      ...pattern(500, 9),
    ]);
  });
});

describe("PS2MemoryCard formatCard", () => {
  it("resizes the image and resets state", () => {
    const card = PS2MemoryCard.format(8192);
    card.importSingleSave("SAVE-AAA0001", pattern(100));
    expect(card.formatCard(16)).toBe(true);
    // Image bytes include ECC spare: nominal 16 MB = 16384 clusters.
    expect(card.getRawData().length).toBe(16384 * 2 * PAGE_SIZE);
    expect(card.getSuperblock().clustersPerCard).toBe(16384);
    expect(card.getSaves()).toEqual([]);
    expect(card.undoCount).toBe(0);
    expect(card.redoCount).toBe(0);
    expect(card.undo()).toBe(false);
    expect(card.changed).toBe(false);
    everyPageClean(card.getRawData());

    expect(card.formatCard(4)).toBe(false);
    expect(card.formatCard(12)).toBe(false);
    expect(card.formatCard(256)).toBe(false);
    expect(card.formatCard(8)).toBe(true);
    expect(card.getSuperblock().clustersPerCard).toBe(8192);
  });
});

describe("PS2MemoryCard loadFromFile", () => {
  it("reads a raw card image", async () => {
    const card = PS2MemoryCard.format(8192);
    const data = pattern(123);
    card.importSingleSave("SAVE-AAA0001", data);
    const loaded = await PS2MemoryCard.loadFromFile(
      toFile(card.getRawData(), "memcard.mcd"),
    );
    expect(loaded.getSaves().map((s) => s.name)).toEqual(["SAVE-AAA0001"]);
    expect(loaded.getRawChecksum()).toBe(card.getRawChecksum());
    expect(loaded.changed).toBe(false);
  });
});

describe("PS2MemoryCard loadFromRawData", () => {
  it("replaces the contents and resets state", () => {
    const card = PS2MemoryCard.format(8192);
    const other = PS2MemoryCard.format(8192);
    other.importSingleSave("SAVE-BBB0001", pattern(300, 3));

    card.loadFromRawData(other.getRawData());
    expect(card.getRawChecksum()).toBe(other.getRawChecksum());
    expect(card.getSaves().map((s) => s.name)).toEqual(["SAVE-BBB0001"]);
    expect(card.changed).toBe(false);
    expect(card.undoCount).toBe(0);
    expect(card.redoCount).toBe(0);
    everyPageClean(card.getRawData());
  });

  it("rejects invalid images without modifying the card", () => {
    const card = PS2MemoryCard.format(8192);
    const before = card.getRawChecksum();
    expect(() => card.loadFromRawData(new Uint8Array(3 * PAGE_SIZE))).toThrow();
    expect(() => card.loadFromRawData(pattern(8192 * 2 * PAGE_SIZE))).toThrow();
    expect(card.getRawChecksum()).toBe(before);
    expect(card.getSaves()).toEqual([]);
    expect(card.undoCount).toBe(0);
  });
});
