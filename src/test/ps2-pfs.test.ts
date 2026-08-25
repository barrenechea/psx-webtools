// PFS (PS2 memory card file system) primitives. The format2 builder is pinned
// to the geometry of a real 8 MB Sony card; the root-directory mirrors
// reproduce the save lists of two real cards (names, chains, entry counts).

import { checkPage } from "@/lib/ps2/ps2-ecc";
import {
  CLUSTER_DATA_SIZE,
  clusterChain,
  FAT_ALLOCATED_BIT,
  FAT_EOF,
  FAT_FREE,
  fatGet,
  fatSet,
  findFreeCluster,
  format2,
  PAGE_SIZE,
  PARENT_ENTRY,
  parseSuperblock,
  PS2_FORMAT_VERSION,
  type Ps2Superblock,
  readChainBytes,
  readDirectory,
  readDirEntry,
  ROOT_CLUSTER,
  SELF_ENTRY,
  writeClusterData,
  writeDirEntry,
} from "@/lib/ps2/ps2-pfs";
import type { Ps2DateTime } from "@/lib/ps2/ps2-types";

const T: Ps2DateTime = {
  sec: 41,
  min: 0,
  hour: 6,
  day: 12,
  month: 1,
  year: 2000,
};

interface Image {
  raw: Uint8Array;
  sb: Ps2Superblock;
}

function blankCard(clusters = 8192): Image {
  const raw = format2(clusters);
  return { raw, sb: parseSuperblock(raw) };
}

function everyPageClean(raw: Uint8Array): void {
  for (let p = 0; p < raw.length; p += PAGE_SIZE) {
    expect(checkPage(raw.subarray(p, p + PAGE_SIZE))).not.toBe("corrupt");
  }
}

function dirEntry(
  raw: Uint8Array,
  sb: Ps2Superblock,
  rel: number,
  slot: 0 | 1,
  fields: {
    name: string;
    mode: number;
    length: number;
    cluster: number;
    dirEntry: number;
  },
): void {
  writeDirEntry(raw, sb, rel, slot, {
    name: fields.name,
    mode: fields.mode,
    length: fields.length,
    cluster: fields.cluster,
    dirEntry: fields.dirEntry,
    created: T,
    modified: T,
    attr: 0,
  });
}

function setChain(
  raw: Uint8Array,
  sb: Ps2Superblock,
  first: number,
  rest: number[],
): void {
  for (let i = 0; i < rest.length; i++) {
    fatSet(raw, sb, i === 0 ? first : rest[i - 1], FAT_ALLOCATED_BIT | rest[i]);
  }
  fatSet(raw, sb, rest[rest.length - 1], FAT_EOF);
}

describe("format2 geometry", () => {
  it("matches the layout of a real 8 MB card", () => {
    const { raw, sb } = blankCard();
    expect(raw.length).toBe(8192 * 2 * PAGE_SIZE);
    expect(sb.version).toBe(PS2_FORMAT_VERSION);
    expect(sb.pageSize).toBe(512);
    expect(sb.pagesPerCluster).toBe(2);
    expect(sb.pagesPerBlock).toBe(16);
    expect(sb.clustersPerCard).toBe(8192);
    expect(sb.allocOffset).toBe(41);
    expect(sb.allocEnd).toBe(8135);
    expect(sb.rootdirCluster).toBe(0);
    expect(sb.backupBlock1).toBe(1023);
    expect(sb.backupBlock2).toBe(1022);
    expect(sb.ifcList[0]).toBe(8);
    expect(sb.ifcList[1]).toBe(0);
    expect(sb.badBlockList.every((b) => b === 0xffffffff)).toBe(true);
    expect(sb.cardType).toBe(2);
    expect(sb.cardFlags).toBe(0x2b);
    expect(sb.clusterSize).toBe(CLUSTER_DATA_SIZE);
    expect(sb.fatEntriesPerCluster).toBe(256);
    expect(sb.clustersPerBlock).toBe(8);
    expect(sb.cardForm).toBe(FAT_EOF);
    expect(sb.rootdirCluster2).toBe(0);
    expect(sb.maxAllocatableClusters).toBe(8001);
  });

  it("leaves the allocation range free and the tail erased", () => {
    const { raw, sb } = blankCard();
    expect(fatGet(raw, sb, 0)).toBe(FAT_EOF);
    for (const rel of [1, 2, 100, 4096, 8134]) {
      expect(fatGet(raw, sb, rel)).toBe(FAT_FREE);
    }
    // Beyond alloc_end the FAT stays erased (reads back as 0xFFFFFFFF).
    for (const rel of [8135, 8191]) {
      expect(fatGet(raw, sb, rel)).toBe(0xffffffff);
    }
    // Every FAT cluster is reachable through the IFC.
    for (let j = 0; j < 32; j++) {
      expect(fatGet(raw, sb, j * 256 + 100)).toBe(FAT_FREE);
    }
  });

  it("starts with an empty two-slot root", () => {
    const { raw, sb } = blankCard();
    const entries = readDirectory(raw, sb, ROOT_CLUSTER);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe(SELF_ENTRY);
    expect(entries[0].mode).toBe(0x8427);
    expect(entries[0].length).toBe(2);
    expect(entries[0].created).toEqual(T);
    expect(entries[1].name).toBe(PARENT_ENTRY);
    expect(entries[1].mode).toBe(0xa426);
  });

  it("keeps every page ECC-clean", () => {
    everyPageClean(blankCard().raw);
  });

  it("supports small cards (64 clusters)", () => {
    const { raw, sb } = blankCard(64);
    expect(raw.length).toBe(128 * PAGE_SIZE);
    expect(sb.allocOffset).toBe(10);
    expect(sb.allocEnd).toBe(38);
    expect(sb.backupBlock1).toBe(7);
    expect(sb.backupBlock2).toBe(6);
    expect(sb.maxAllocatableClusters).toBe(1);
    expect(fatGet(raw, sb, 0)).toBe(FAT_EOF);
    expect(fatGet(raw, sb, 37)).toBe(FAT_FREE);
    expect(fatGet(raw, sb, 38)).toBe(0xffffffff);
    everyPageClean(raw);
  });

  it("rejects unaligned cluster counts", () => {
    expect(() => format2(8191)).toThrow();
    expect(() => format2(8)).toThrow();
  });
});

describe("allocation and chains", () => {
  it("finds free clusters and walks allocated chains", () => {
    const { raw, sb } = blankCard();
    expect(findFreeCluster(raw, sb)).toBe(1);
    fatSet(raw, sb, 1, FAT_ALLOCATED_BIT | 2);
    fatSet(raw, sb, 2, FAT_ALLOCATED_BIT | 3);
    fatSet(raw, sb, 3, FAT_EOF);
    expect(clusterChain(raw, sb, 1)).toEqual([1, 2, 3]);
    expect(clusterChain(raw, sb, 0)).toEqual([0]);
    expect(findFreeCluster(raw, sb)).toBe(4);
  });

  it("detects FAT cycles", () => {
    const { raw, sb } = blankCard();
    fatSet(raw, sb, 5, FAT_ALLOCATED_BIT | 6);
    fatSet(raw, sb, 6, FAT_ALLOCATED_BIT | 5);
    expect(() => clusterChain(raw, sb, 5)).toThrow();
  });

  it("round-trips file data across a multi-cluster chain", () => {
    const { raw, sb } = blankCard();
    const total = 2500;
    const pattern = new Uint8Array(total);
    for (let i = 0; i < total; i++) pattern[i] = (i * 7 + 13) & 0xff;
    const chain = [1, 2, 3];
    setChain(raw, sb, chain[0], chain.slice(1));
    for (let i = 0; i < chain.length; i++) {
      const buf = new Uint8Array(CLUSTER_DATA_SIZE);
      buf.set(
        pattern.subarray(i * CLUSTER_DATA_SIZE, (i + 1) * CLUSTER_DATA_SIZE),
      );
      writeClusterData(raw, sb.allocOffset + chain[i], buf);
    }
    expect([...readChainBytes(raw, sb, 1, total)]).toEqual([...pattern]);
    expect([...readChainBytes(raw, sb, 1, 500)]).toEqual([
      ...pattern.subarray(0, 500),
    ]);
    everyPageClean(raw);
  });
});

describe("directory entries", () => {
  it("round-trips every field of an entry", () => {
    const { raw, sb } = blankCard();
    const rel = findFreeCluster(raw, sb)!;
    writeDirEntry(raw, sb, rel, 0, {
      name: "BASLUS-21590GTA40001",
      mode: 0x8497,
      length: 12345,
      cluster: 77,
      dirEntry: 3,
      created: T,
      modified: { ...T, sec: 59, hour: 23, day: 31, month: 12, year: 2007 },
      attr: 0x12,
    });
    const e = readDirEntry(raw, sb, rel, 0);
    expect(e.name).toBe("BASLUS-21590GTA40001");
    expect(e.mode).toBe(0x8497);
    expect(e.exists).toBe(true);
    expect(e.isFile).toBe(true);
    expect(e.isDir).toBe(false);
    expect(e.length).toBe(12345);
    expect(e.cluster).toBe(77);
    expect(e.dirEntry).toBe(3);
    expect(e.created).toEqual(T);
    expect(e.modified).toEqual({
      ...T,
      sec: 59,
      hour: 23,
      day: 31,
      month: 12,
      year: 2007,
    });
    expect(e.attr).toBe(0x12);
    everyPageClean(raw);
  });

  it("truncates names to 32 characters", () => {
    const { raw, sb } = blankCard();
    const rel = findFreeCluster(raw, sb)!;
    const name = "A".repeat(40);
    dirEntry(raw, sb, rel, 1, {
      name,
      mode: 0x8427,
      length: 0,
      cluster: 0,
      dirEntry: 0,
    });
    expect(readDirEntry(raw, sb, rel, 1).name).toBe("A".repeat(32));
  });

  it("skips deleted and never-written slots", () => {
    const { raw, sb } = blankCard();
    const rel = findFreeCluster(raw, sb)!;
    dirEntry(raw, sb, rel, 0, {
      name: "LIVESAVE",
      mode: 0x8427,
      length: 1,
      cluster: 9,
      dirEntry: 0,
    });
    dirEntry(raw, sb, rel, 1, {
      name: "DEADSAVE",
      mode: 0x427,
      length: 1,
      cluster: 10,
      dirEntry: 1,
    });
    const entries = readDirectory(raw, sb, rel);
    expect(entries.map((e) => e.name)).toEqual(["LIVESAVE"]);
    // A cluster that was never written reads back as mode 0xFFFF with an
    // invalid name; it must be invisible, not an error. (rel + 1 is free and
    // untouched; dir-entry writes above do not change the FAT.)
    const erased = rel + 1;
    expect(readDirectory(raw, sb, erased)).toEqual([]);
  });
});

describe("superblock validation", () => {
  it("rejects foreign images", () => {
    const { raw } = blankCard();
    expect(() => parseSuperblock(new Uint8Array(527))).toThrow();
    const badMagic = new Uint8Array(raw.subarray(0, PAGE_SIZE));
    badMagic[0] = 0xff;
    expect(() => parseSuperblock(badMagic)).toThrow(/magic/i);
    const oldVersion = new Uint8Array(raw.subarray(0, PAGE_SIZE));
    oldVersion.set(new TextEncoder().encode("1.0.0.0"), 0x1c);
    expect(() => parseSuperblock(oldVersion)).toThrow(/version/i);
    const badType = new Uint8Array(raw.subarray(0, PAGE_SIZE));
    badType[0x150] = 3;
    expect(() => parseSuperblock(badType)).toThrow(/type/i);
  });

  it("tolerates a zeroed extended region (older cards)", () => {
    const { raw } = blankCard();
    raw.fill(0, 0x154, 0x17c);
    const sb2 = parseSuperblock(raw);
    expect(sb2.clusterSize).toBe(0);
    expect(sb2.maxAllocatableClusters).toBe(0);
    expect(readDirectory(raw, sb2, ROOT_CLUSTER)).toHaveLength(2);
  });
});

// Root mirrors of two real cards: exact chains, entry order, lengths and data
// clusters as verified against the hardware.
const MCD001_ROOT = {
  chain: [0, 1, 950, 1933, 4497, 4763, 1931],
  saves: [
    { name: "BASLUS-21590GTA40001", cluster: 2, length: 10, hidden: false },
    { name: "BASLUS-21423GTA30001", cluster: 520, length: 10, hidden: false },
    { name: "BASLUS-20946GTA50000", cluster: 951, length: 16, hidden: false },
    { name: "BEDATA-SYSTEM", cluster: 1549, length: 4, hidden: true },
    { name: "BASLUS-20552GTA40000", cluster: 1934, length: 13, hidden: false },
    { name: "BASLUS-20062GTA30000", cluster: 3603, length: 9, hidden: false },
    { name: "BADATA-SYSTEM", cluster: 4525, length: 4, hidden: true },
    { name: "BESCES-53133GodOfWar", cluster: 424, length: 10, hidden: false },
  ],
  deleted: [
    "BASLUS-21134DATA01",
    "BASLUS-21134SYS",
    "BASLUS-21134ICON01",
    "BASLUS-21134ICON02",
  ],
} as const;

type SlotFields = {
  name: string;
  mode: number;
  length: number;
  cluster: number;
};

const saveFields = (s: {
  name: string;
  cluster: number;
  length: number;
  hidden?: boolean;
}): SlotFields => ({
  name: s.name,
  mode: s.hidden ? 0xa027 : 0x8427,
  length: s.length,
  cluster: s.cluster,
});

const deletedFields = (name: string): SlotFields => ({
  name,
  mode: 0x427,
  length: 1,
  cluster: 0,
});

function buildMcd001Root(): Image {
  const img = blankCard();
  setChain(img.raw, img.sb, 0, MCD001_ROOT.chain.slice(1));
  // cluster, slot -> entry, in on-card order
  const slots: [number, 0 | 1, SlotFields][] = [
    [0, 0, { name: SELF_ENTRY, mode: 0x8427, length: 13, cluster: 0 }],
    [0, 1, { name: PARENT_ENTRY, mode: 0xa426, length: 0, cluster: 0 }],
    [1, 0, saveFields(MCD001_ROOT.saves[0])],
    [1, 1, saveFields(MCD001_ROOT.saves[1])],
    [950, 0, saveFields(MCD001_ROOT.saves[2])],
    [950, 1, saveFields(MCD001_ROOT.saves[3])],
    [1933, 0, saveFields(MCD001_ROOT.saves[4])],
    [1933, 1, saveFields(MCD001_ROOT.saves[5])],
    [4497, 0, saveFields(MCD001_ROOT.saves[6])],
    [4497, 1, deletedFields(MCD001_ROOT.deleted[0])],
    [4763, 0, deletedFields(MCD001_ROOT.deleted[1])],
    [4763, 1, saveFields(MCD001_ROOT.saves[7])],
    [1931, 0, deletedFields(MCD001_ROOT.deleted[2])],
    [1931, 1, deletedFields(MCD001_ROOT.deleted[3])],
  ];
  slots.forEach(([rel, slot, e]) => {
    dirEntry(img.raw, img.sb, rel, slot, {
      name: e.name,
      mode: e.mode,
      length: e.length,
      cluster: e.cluster,
      dirEntry: 0,
    });
  });
  return img;
}

describe("real card root mirrors", () => {
  it("Mcd001: enumerates exactly the 8 user saves in on-card order", () => {
    const { raw, sb } = buildMcd001Root();
    const entries = readDirectory(raw, sb, ROOT_CLUSTER);
    expect(entries.map((e) => e.name)).toEqual([
      SELF_ENTRY,
      PARENT_ENTRY,
      ...MCD001_ROOT.saves.map((s) => s.name),
    ]);
    MCD001_ROOT.saves.forEach((s, i) => {
      const e = entries[2 + i];
      expect(e.name).toBe(s.name);
      expect(e.cluster).toBe(s.cluster);
      expect(e.length).toBe(s.length);
      expect(e.hidden).toBe(s.hidden);
      expect(e.isDir).toBe(true);
    });
    expect(entries[0].length).toBe(13);
    expect(clusterChain(raw, sb, 0)).toEqual([...MCD001_ROOT.chain]);
    everyPageClean(raw);
  });

  it("Mcd002: short chain with gaps enumerates correctly", () => {
    const img = blankCard();
    const chain = [0, 2, 3792, 5582];
    setChain(img.raw, img.sb, chain[0], chain.slice(1));
    const saves = [
      { name: "BASLUS-20946GTA50000", cluster: 1, length: 10 },
      { name: "BASLUS-21423GTA30001", cluster: 3160, length: 9 },
      { name: "BASLUS-20552GTA40000", cluster: 3791, length: 12 },
      { name: "BASLUS-20062GTA30000", cluster: 5084, length: 8 },
    ];
    const slots: [number, 0 | 1, SlotFields][] = [
      [0, 0, { name: SELF_ENTRY, mode: 0x8427, length: 6, cluster: 0 }],
      [0, 1, { name: PARENT_ENTRY, mode: 0xa426, length: 0, cluster: 0 }],
      [2, 0, saveFields(saves[0])],
      [2, 1, saveFields(saves[1])],
      [3792, 0, saveFields(saves[2])],
      [3792, 1, saveFields(saves[3])],
    ];
    slots.forEach(([rel, slot, e]) => {
      dirEntry(img.raw, img.sb, rel, slot, {
        name: e.name,
        mode: e.mode,
        length: e.length,
        cluster: e.cluster,
        dirEntry: 0,
      });
    });
    const entries = readDirectory(img.raw, img.sb, ROOT_CLUSTER);
    expect(entries.map((e) => e.name)).toEqual([
      SELF_ENTRY,
      PARENT_ENTRY,
      ...saves.map((s) => s.name),
    ]);
    expect(clusterChain(img.raw, img.sb, 0)).toEqual(chain);
  });
});
