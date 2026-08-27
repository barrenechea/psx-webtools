// PS2MemoryCard model: build cards with low-level PFS primitives (the model
// is read-only in P0) and verify saves, files, icons, sizes and checksums.

import { crc32, formatCrc32 } from "@/lib/crc32";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { checkPage } from "@/lib/ps2/ps2-ecc";
import {
  buildIconSys,
  ICON_SYS_SIZE,
  parseIconSys,
  type Ps2IconCorner,
} from "@/lib/ps2/ps2-iconsys";
import {
  CLUSTER_DATA_SIZE,
  clusterChain,
  FAT_ALLOCATED_BIT,
  FAT_EOF,
  fatSet,
  findFreeCluster,
  format2,
  PAGE_DATA_SIZE,
  PAGE_SIZE,
  parseSuperblock,
  type Ps2Superblock,
  readDirEntry,
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

function blankCard(): Image {
  const raw = format2(8192);
  return { raw, sb: parseSuperblock(raw) };
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

interface FileSpec {
  name: string;
  data: Uint8Array;
}

interface SaveSpec {
  name: string;
  hidden?: boolean;
  title?: string;
  bgColors?: Ps2IconCorner[];
  viewIcon?: string;
  files?: FileSpec[];
}

// Write a complete save: its directory chain (., .., icon.sys, files) plus
// the file data chains, then link the save into the root directory.
function addSave(raw: Uint8Array, sb: Ps2Superblock, spec: SaveSpec): void {
  const icon = buildIconSys({
    title: spec.title ?? spec.name,
    bgColors: spec.bgColors,
    viewIcon: spec.viewIcon,
  });
  const files: FileSpec[] = [
    { name: "icon.sys", data: icon },
    ...(spec.files ?? []),
  ];
  const entryCount = 2 + files.length;

  // Save directory chain (2 entries per cluster).
  const dirChain = allocChain(raw, sb, Math.ceil(entryCount / 2));

  // File data chains.
  const firstClusters: number[] = [];
  for (const f of files) {
    const dataChain = allocChain(
      raw,
      sb,
      Math.max(1, Math.ceil(f.data.length / CLUSTER_DATA_SIZE)),
    );
    for (let i = 0; i < dataChain.length; i++) {
      const buf = new Uint8Array(CLUSTER_DATA_SIZE);
      buf.set(
        f.data.subarray(i * CLUSTER_DATA_SIZE, (i + 1) * CLUSTER_DATA_SIZE),
      );
      writeClusterData(raw, sb.allocOffset + dataChain[i], buf);
    }
    firstClusters.push(dataChain[0]);
  }

  // Directory entries: ., .., icon.sys, then the data files.
  const entries = [
    { name: ".", mode: 0x8427, length: entryCount, cluster: dirChain[0] },
    { name: "..", mode: 0xa426, length: 0, cluster: 0 },
    ...files.map((f, i) => ({
      name: f.name,
      mode: 0x8497,
      length: f.data.length,
      cluster: firstClusters[i],
    })),
  ];
  entries.forEach((e, i) => {
    writeDirEntry(raw, sb, dirChain[Math.floor(i / 2)], (i % 2) as 0 | 1, {
      name: e.name,
      mode: e.mode,
      length: e.length,
      cluster: e.cluster,
      dirEntry: i,
      created: T,
      modified: T,
      attr: 0,
    });
  });

  // Root: place the save entry in the first free slot, extending the root
  // chain when every slot is used.
  const rootChain = clusterChain(raw, sb, 0);
  let hostRel = -1;
  let hostSlot: 0 | 1 = 0;
  outer: for (let ci = 0; ci < rootChain.length; ci++) {
    for (const slot of [0, 1] as const) {
      if (!readDirEntry(raw, sb, rootChain[ci], slot).exists) {
        hostRel = rootChain[ci];
        hostSlot = slot;
        break outer;
      }
    }
  }
  if (hostRel === -1) {
    hostRel = mustFree(raw, sb);
    fatSet(
      raw,
      sb,
      rootChain[rootChain.length - 1],
      FAT_ALLOCATED_BIT | hostRel,
    );
    fatSet(raw, sb, hostRel, FAT_EOF);
    hostSlot = 0;
  }
  writeDirEntry(raw, sb, hostRel, hostSlot, {
    name: spec.name,
    mode: spec.hidden ? 0xa027 : 0x8427,
    length: entryCount,
    cluster: dirChain[0],
    dirEntry: 0,
    created: T,
    modified: T,
    attr: 0,
  });
}

function pattern(len: number, seed = 0): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 7 + 13 + seed) & 0xff;
  return out;
}

const RED: Ps2IconCorner[] = [{ r: 128, g: 0, b: 0, a: 128 }];

describe("PS2MemoryCard", () => {
  it("format() produces a blank card", () => {
    const card = PS2MemoryCard.format(8192);
    expect(card.kind).toBe("ps2");
    expect(card.getSaves()).toEqual([]);
    expect(card.getSuperblock().allocOffset).toBe(41);
    expect(card.getRawData().length).toBe(8192 * 2 * PAGE_SIZE);
    expect(card.getRawChecksum()).toBe(formatCrc32(crc32(card.getRawData())));
  });

  it("fromRaw() rejects malformed images", () => {
    expect(() => PS2MemoryCard.fromRaw(new Uint8Array(527))).toThrow();
    expect(() =>
      PS2MemoryCard.fromRaw(new Uint8Array(2 * PAGE_SIZE).fill(0xff)),
    ).toThrow(/magic/i);
    const blank = blankCard().raw;
    const truncated = blank.subarray(0, 100 * PAGE_SIZE);
    expect(() => PS2MemoryCard.fromRaw(truncated)).toThrow(/truncated/i);
  });

  it("fromRaw() inflates a data-only (512 B/page) image", () => {
    const raw = format2(64);
    const pages = raw.length / PAGE_SIZE;
    const dataOnly = new Uint8Array(pages * PAGE_DATA_SIZE);
    for (let p = 0; p < pages; p++) {
      dataOnly.set(
        raw.subarray(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_DATA_SIZE),
        p * PAGE_DATA_SIZE,
      );
    }
    const card = PS2MemoryCard.fromRaw(dataOnly);
    expect(card.getRawData().length).toBe(raw.length);
    expect(card.getSaves()).toEqual([]);
    for (let p = 0; p < pages; p++) {
      expect(
        checkPage(
          card.getRawData().subarray(p * PAGE_SIZE, (p + 1) * PAGE_SIZE),
        ),
      ).not.toBe("corrupt");
    }
  });

  it("reads saves, files and icons written through the PFS layer", () => {
    const { raw, sb } = blankCard();
    const dataA = pattern(2500);
    addSave(raw, sb, {
      name: "BASLUS-21590GTA40001",
      title: "Grand Theft Auto IV",
      bgColors: RED,
      files: [{ name: "BASLUS-21590GTA40001", data: dataA }],
    });
    addSave(raw, sb, {
      name: "BASLUS-20946GTA50000",
      hidden: true,
      files: [{ name: "BASLUS-20946GTA50000", data: pattern(300, 1) }],
    });
    addSave(raw, sb, {
      name: "BASLUS-21423GTA30001",
      title: "GTA III",
      files: [{ name: "BASLUS-21423GTA30001", data: pattern(1024, 2) }],
    });
    const card = PS2MemoryCard.fromRaw(raw);
    const saves = card.getSaves();
    expect(saves.map((s) => s.name)).toEqual([
      "BASLUS-21590GTA40001",
      "BASLUS-20946GTA50000",
      "BASLUS-21423GTA30001",
    ]);
    const [a, b, c] = saves;
    expect(a.title).toBe("Grand Theft Auto IV");
    expect(a.iconType).toBe(0);
    expect(a.hidden).toBe(false);
    expect(a.entryCount).toBe(4);
    expect(a.created).toEqual(T);
    expect(a.files.map((f) => [f.name, f.size])).toEqual([
      ["icon.sys", ICON_SYS_SIZE],
      ["BASLUS-21590GTA40001", 2500],
    ]);
    expect(a.totalSize).toBe(2500);
    expect(a.background[0]).toEqual([128, 0, 0, 128]);
    expect(a.backgroundTransparency).toBe(0);
    expect(b.hidden).toBe(true);
    expect(b.totalSize).toBe(300);
    expect(c.totalSize).toBe(1024);
    expect([
      ...card.readFile("BASLUS-21590GTA40001", "BASLUS-21590GTA40001"),
    ]).toEqual([...dataA]);
    const icon = card.getIconSys("BASLUS-21590GTA40001");
    expect(icon?.title).toBe("Grand Theft Auto IV");
    expect(icon?.bgColors[0]).toEqual({ r: 128, g: 0, b: 0, a: 128 });
    expect(card.getIconSys("NOPE")).toBeNull();
    expect(() => card.readFile("NOPE", "X")).toThrow(/Save not found/);
    expect(() => card.readFile("BASLUS-21590GTA40001", "NOPE")).toThrow(
      /File not found/,
    );
    // The whole card, save data included, must stay ECC-clean.
    for (let p = 0; p < raw.length; p += PAGE_SIZE) {
      expect(checkPage(raw.subarray(p, p + PAGE_SIZE))).not.toBe("corrupt");
    }
  });

  it("keeps _SCE8 view icons as built-in names with no on-card model", () => {
    const { raw, sb } = blankCard();
    addSave(raw, sb, {
      name: "BEDATA-SYSTEM",
      hidden: true,
      viewIcon: "_SCE8",
      files: [{ name: "BEDATA-SYSTEM", data: pattern(100) }],
    });
    const save = PS2MemoryCard.fromRaw(raw).getSaves()[0];
    expect(save.name).toBe("BEDATA-SYSTEM");
    expect(save.viewIcon).toBe("_SCE8");
    expect(save.iconModel).toBeNull();
  });

  it("ignores stale entries past the declared entry count", () => {
    const { raw, sb } = blankCard();
    addSave(raw, sb, {
      name: "BASLUS-20552GTA40000",
      title: "GTA VCS",
      files: [{ name: "BASLUS-20552GTA40000", data: pattern(100) }],
    });
    // The save has 4 entries filling its 2-cluster chain. The console
    // extends directory chains in chunks and never trims them, so grow the
    // chain without raising the count: the new slot can hold a stale entry
    // that must not be listed.
    const dirFirst = PS2MemoryCard.fromRaw(raw).getSaves()[0].dataCluster;
    const chain = clusterChain(raw, sb, dirFirst);
    const extra = mustFree(raw, sb);
    fatSet(raw, sb, chain[chain.length - 1], FAT_ALLOCATED_BIT | extra);
    fatSet(raw, sb, extra, FAT_EOF);
    writeDirEntry(raw, sb, extra, 0, {
      name: "[2",
      mode: 0xfe5c,
      length: 3228549028,
      cluster: 1078764478,
      dirEntry: 1075000117,
      created: T,
      modified: T,
      attr: 0,
    });
    const card = PS2MemoryCard.fromRaw(raw);
    const save = card.getSaves()[0];
    expect(save.files.map((f) => f.name)).toEqual([
      "icon.sys",
      "BASLUS-20552GTA40000",
    ]);
    expect(save.totalSize).toBe(100);
    expect(save.title).toBe("GTA VCS");
  });

  it("decodes double-byte Shift-JIS titles stored in icon.sys", () => {
    const icon = buildIconSys({ title: "" });
    // "GTA VCS" as the console writes it: fullwidth-ASCII double-byte pairs.
    icon.set(
      [
        0x82, 0x66, 0x82, 0x73, 0x82, 0x60, 0x81, 0x40, 0x82, 0x75, 0x82, 0x62,
        0x82, 0x72,
      ],
      0xc0,
    );
    expect(parseIconSys(icon).title).toBe("GTA VCS");
  });

  it("round-trips all four background corners (uint32 channels)", () => {
    const corners: Ps2IconCorner[] = [
      { r: 128, g: 0, b: 0, a: 0 },
      { r: 0, g: 128, b: 0, a: 0 },
      { r: 0, g: 0, b: 128, a: 0 },
      { r: 128, g: 128, b: 128, a: 0 },
    ];
    const icon = buildIconSys({ bgColors: corners });
    // Each channel is a 4-byte little-endian uint32, one corner per 16 bytes.
    expect([...icon.subarray(16, 20)]).toEqual([128, 0, 0, 0]);
    expect([...icon.subarray(20, 24)]).toEqual([0, 0, 0, 0]);
    expect([...icon.subarray(32, 36)]).toEqual([0, 0, 0, 0]);
    expect([...icon.subarray(36, 40)]).toEqual([128, 0, 0, 0]);
    expect(parseIconSys(icon).bgColors).toEqual(corners);
  });

  it("reads three four-float directional light records", () => {
    const icon = buildIconSys();
    const view = new DataView(icon.buffer);
    const dirs = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const cols = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ];
    for (let light = 0; light < 3; light++) {
      for (let component = 0; component < 3; component++) {
        view.setFloat32(
          0x50 + light * 16 + component * 4,
          dirs[light][component],
          true,
        );
        view.setFloat32(
          0x80 + light * 16 + component * 4,
          cols[light][component],
          true,
        );
      }
      view.setFloat32(0x50 + light * 16 + 12, 100 + light, true);
      view.setFloat32(0x80 + light * 16 + 12, 200 + light, true);
    }
    const parsed = parseIconSys(icon);
    expect(parsed.lightDir).toEqual(dirs);
    for (let light = 0; light < 3; light++) {
      expect(parsed.lightCol[light]).toEqual(
        cols[light].map((value) => Math.fround(value)),
      );
    }
  });

  it("exposes the view icon texture on the save info", () => {
    const { raw, sb } = blankCard();
    // Minimal 3-vertex, 1-frame icon with a uniform raw texture.
    const texBytes = new Uint8Array(128 * 128 * 2);
    for (let i = 0; i < 128 * 128; i++) {
      texBytes[i * 2] = 0xff;
      texBytes[i * 2 + 1] = 0xff;
    }
    const texStart = 20 + 3 * 24 + 20 + 16;
    const ico = new Uint8Array(texStart + texBytes.length);
    const view = new DataView(ico.buffer);
    view.setUint32(0, 0x00010000, true);
    view.setUint32(4, 1, true); // animShapes
    view.setUint32(8, 0x04, true); // texType: has texture, raw
    view.setFloat32(12, 1, true);
    view.setUint32(16, 3, true); // vertexCount
    view.setUint32(20 + 3 * 24, 0x01, true); // animation magic
    view.setUint32(20 + 3 * 24 + 16, 1, true); // frameCount
    view.setUint32(20 + 3 * 24 + 20 + 4, 1, true); // frame keyCount
    ico.set(texBytes, texStart);
    addSave(raw, sb, {
      name: "BESCES-53133GodOfWar",
      viewIcon: "GOD.ICO",
      files: [
        { name: "BESCES-53133GodOfWar", data: pattern(200) },
        { name: "god.ico", data: ico },
      ],
    });
    const card = PS2MemoryCard.fromRaw(raw);
    const save = card.getSaves()[0];
    expect(save.iconModel?.vertexCount).toBe(3);
    // 0xFFFF: bit-replicated 5-bit max, A1 opaque.
    expect([...(save.iconModel?.texture?.subarray(0, 4) ?? [])]).toEqual([
      255, 255, 255, 255,
    ]);
    expect(save.iconLighting).not.toBeNull();
    expect(card.getSaves()[0]).toBe(save);
  });

  it("checksum changes when the card is modified", () => {
    const { raw, sb } = blankCard();
    const before = PS2MemoryCard.fromRaw(raw).getRawChecksum();
    addSave(raw, sb, { name: "BASLUS-21423GTA30001" });
    const after = PS2MemoryCard.fromRaw(raw).getRawChecksum();
    expect(after).not.toBe(before);
  });
});
