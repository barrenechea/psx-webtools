// PS2 memory card model: raw image in, card queries out (saves, files, icon).

import { crc32, formatCrc32 } from "../crc32";
import type { Ps2IconSys } from "./ps2-iconsys";
import { parseIconSys } from "./ps2-iconsys";
import {
  format2,
  PAGE_SIZE,
  PAGES_PER_CLUSTER,
  PARENT_ENTRY,
  parseSuperblock,
  type Ps2DirEntry,
  type Ps2Superblock,
  readChainBytes,
  readDirectory,
  ROOT_CLUSTER,
  SELF_ENTRY,
} from "./ps2-pfs";
import type { Ps2FileInfo, Ps2SaveInfo } from "./ps2-types";

export class PS2MemoryCard {
  readonly kind = "ps2" as const;

  private constructor(
    private readonly raw: Uint8Array,
    private readonly sb: Ps2Superblock,
  ) {}

  static fromRaw(raw: Uint8Array): PS2MemoryCard {
    if (raw.length === 0 || raw.length % PAGE_SIZE !== 0) {
      throw new Error("Invalid PS2 card image size");
    }
    const sb = parseSuperblock(raw);
    if (raw.length < sb.clustersPerCard * PAGES_PER_CLUSTER * PAGE_SIZE) {
      throw new Error("PS2 card image is truncated");
    }
    return new PS2MemoryCard(raw, sb);
  }

  static format(clustersPerCard = 8192): PS2MemoryCard {
    const raw = format2(clustersPerCard);
    return PS2MemoryCard.fromRaw(raw);
  }

  getSuperblock(): Ps2Superblock {
    return this.sb;
  }

  getRawData(): Uint8Array {
    return this.raw;
  }

  getRawChecksum(): string {
    return formatCrc32(crc32(this.raw));
  }

  /** Existing save directories in the root, in on-card order. */
  getSaves(): Ps2SaveInfo[] {
    const saves: Ps2SaveInfo[] = [];
    for (const entry of readDirectory(this.raw, this.sb, ROOT_CLUSTER)) {
      if (
        !entry.isDir ||
        entry.name === SELF_ENTRY ||
        entry.name === PARENT_ENTRY
      ) {
        continue;
      }
      saves.push(this.describeSave(entry));
    }
    return saves;
  }

  getIconSys(saveName: string): Ps2IconSys | null {
    const saveDir = this.getRootDirEntry(saveName);
    if (saveDir === null) return null;
    for (const file of readDirectory(
      this.raw,
      this.sb,
      saveDir.cluster,
      saveDir.length,
    )) {
      if (file.isFile && file.name.toLowerCase() === "icon.sys") {
        try {
          return parseIconSys(this.readChainBytes(file));
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /** File bytes of one file in one save (exact name match). */
  readFile(saveName: string, fileName: string): Uint8Array {
    const saveDir = this.getRootDirEntry(saveName);
    if (saveDir === null) {
      throw new Error(`Save not found: ${saveName}`);
    }
    for (const file of readDirectory(
      this.raw,
      this.sb,
      saveDir.cluster,
      saveDir.length,
    )) {
      if (file.isFile && file.name === fileName) {
        return this.readChainBytes(file);
      }
    }
    throw new Error(`File not found: ${saveName}/${fileName}`);
  }

  // -------------------------------------------------------------------

  private describeSave(entry: Ps2DirEntry): Ps2SaveInfo {
    const files = readDirectory(
      this.raw,
      this.sb,
      entry.cluster,
      entry.length,
    ).filter((f) => f.isFile);
    let icon: Ps2IconSys | null = null;
    for (const file of files) {
      if (file.name.toLowerCase() === "icon.sys") {
        try {
          icon = parseIconSys(this.readChainBytes(file));
        } catch {
          icon = null;
        }
        break;
      }
    }
    const iconFiles = new Set(
      [icon?.viewIcon, icon?.copyIcon, icon?.delIcon].filter(
        (n) => n !== undefined && n !== "",
      ),
    );
    const list: Ps2FileInfo[] = [];
    let totalSize = 0;
    for (const file of files) {
      list.push({ name: file.name, size: file.length });
      if (file.name.toLowerCase() !== "icon.sys" && !iconFiles.has(file.name)) {
        totalSize += file.length;
      }
    }
    return {
      name: entry.name,
      title: icon?.title ?? entry.name,
      iconType: icon?.type ?? 0,
      created: entry.created,
      modified: entry.modified,
      entryCount: entry.length,
      dataCluster: entry.cluster,
      hidden: entry.hidden,
      ps1: entry.ps1,
      pocketStation: entry.pocketStation,
      totalSize,
      files: list,
      background: icon ? icon.bgColors.map((c) => [c.r, c.g, c.b, c.a]) : [],
    };
  }

  private getRootDirEntry(saveName: string): Ps2DirEntry | null {
    for (const entry of readDirectory(this.raw, this.sb, ROOT_CLUSTER)) {
      if (entry.isDir && entry.name === saveName) {
        return entry;
      }
    }
    return null;
  }

  private readChainBytes(file: Ps2DirEntry): Uint8Array {
    return readChainBytes(this.raw, this.sb, file.cluster, file.length);
  }
}
