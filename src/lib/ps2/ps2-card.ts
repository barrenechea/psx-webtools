// PS2 memory card model: raw image in, card queries out (saves, files, icons),
// plus the console-style write side (delete, copy, single-save import) with
// page-granular undo/redo.

import { crc32, formatCrc32 } from "../crc32";
import type { Ps2IconModel } from "./ps2-icon";
import { parsePs2Icon } from "./ps2-icon";
import type { Ps2IconCorner, Ps2IconSys } from "./ps2-iconsys";
import { buildIconSys, parseIconSys } from "./ps2-iconsys";
import {
  CLUSTER_DATA_SIZE,
  clusterChain,
  FAT_ALLOCATED_BIT,
  FAT_EOF,
  fatEntryPage,
  fatGet,
  fatSet,
  format2,
  MODE_EXISTS,
  MODE_HIDDEN,
  MODE_PDA,
  MODE_PSX,
  normalizeCardImage,
  PAGE_SIZE,
  PAGES_PER_CLUSTER,
  PARENT_ENTRY,
  parseSuperblock,
  type Ps2DirEntry,
  type Ps2Superblock,
  readChainBytes,
  readDirectory,
  readDirEntry,
  ROOT_CLUSTER,
  SELF_ENTRY,
  stripImageSpares,
  writeClusterData,
  writeDirEntry,
} from "./ps2-pfs";
import {
  type Ps2Container,
  Ps2ContainerFormat,
  writePs2Container,
} from "./ps2-single-save";
import type { Ps2DateTime, Ps2FileInfo, Ps2SaveInfo } from "./ps2-types";

/** Container export formats (map 1:1 to the UI's single-save types). */
export type Ps2SingleSaveFormat =
  "max" | "ems" | "sharkport" | "xport" | "codebreaker" | "psv";

function toContainerFormat(format: Ps2SingleSaveFormat): Ps2ContainerFormat {
  switch (format) {
    case "max":
      return Ps2ContainerFormat.MaxDrive;
    case "ems":
      return Ps2ContainerFormat.Ems;
    case "sharkport":
      return Ps2ContainerFormat.SharkPort;
    case "xport":
      return Ps2ContainerFormat.XPort;
    case "codebreaker":
      return Ps2ContainerFormat.CodeBreaker;
    case "psv":
      return Ps2ContainerFormat.Psv;
  }
}

// Entry modes as written by the console (verified on real cards).
const DIR_MODE = 0x8427;
const FILE_MODE = 0x8497;

const ZERO_TIME: Ps2DateTime = {
  sec: 0,
  min: 0,
  hour: 0,
  day: 0,
  month: 0,
  year: 0,
};

// One undo step: the affected 528-byte pages and their pre-change contents.
interface PageSnapshot {
  pages: number[];
  data: Uint8Array[];
}

export interface Ps2ImportOptions {
  title?: string;
  hidden?: boolean;
  ps1?: boolean;
  pocketStation?: boolean;
  bgColors?: Ps2IconCorner[];
}

interface FileSpec {
  name: string;
  mode: number;
  data: Uint8Array;
}

export class PS2MemoryCard {
  readonly kind = "ps2" as const;

  private constructor(
    private raw: Uint8Array,
    private sb: Ps2Superblock,
    private loadedEcc: boolean,
  ) {
    this.savedState = raw.slice();
  }

  private changedFlag = false;
  private savedState: Uint8Array | null;
  private undoList: PageSnapshot[] = [];
  private redoList: PageSnapshot[] = [];
  private savesCache: Ps2SaveInfo[] | null = null;
  // A single large save can occupy most of the card; cap history so an
  // 8 MB card in undo steps stays a small fraction of the image size.
  private readonly undoLimit = 50;

  static fromRaw(raw: Uint8Array): PS2MemoryCard {
    const image = normalizeCardImage(raw);
    const sb = parseSuperblock(image);
    if (image.length < sb.clustersPerCard * PAGES_PER_CLUSTER * PAGE_SIZE) {
      throw new Error("PS2 card image is truncated");
    }
    // A 528-stride input carried real ECC spares; a 512-stride input had none
    // and was inflated, so its original stride was data-only.
    const loadedEcc = raw.length % PAGE_SIZE === 0;
    return new PS2MemoryCard(image, sb, loadedEcc);
  }

  // Probe helper for open flows: returns null instead of throwing so callers
  // can fall back to other card formats.
  static tryFromBytes(raw: Uint8Array): PS2MemoryCard | null {
    try {
      return PS2MemoryCard.fromRaw(raw);
    } catch {
      return null;
    }
  }

  static format(clustersPerCard = 8192): PS2MemoryCard {
    const raw = format2(clustersPerCard);
    return PS2MemoryCard.fromRaw(raw);
  }

  static async loadFromFile(file: File): Promise<PS2MemoryCard> {
    const arrayBuffer = await file.arrayBuffer();
    return PS2MemoryCard.fromRaw(new Uint8Array(arrayBuffer));
  }

  // Replace the card's contents in place, mirroring the PS1
  // loadFromRawData surface (validates, then resets state to clean).
  loadFromRawData(data: Uint8Array): void {
    const image = normalizeCardImage(data);
    const sb = parseSuperblock(image);
    if (image.length < sb.clustersPerCard * PAGES_PER_CLUSTER * PAGE_SIZE) {
      throw new Error("PS2 card image is truncated");
    }
    this.raw = image.slice();
    this.sb = sb;
    this.loadedEcc = data.length % PAGE_SIZE === 0;
    this.savedState = this.raw.slice();
    this.changedFlag = false;
    this.undoList = [];
    this.redoList = [];
    this.savesCache = null;
  }

  getSuperblock(): Ps2Superblock {
    return this.sb;
  }

  /** True when the source image carried 528-byte (ECC) pages, else 512. */
  getLoadedEcc(): boolean {
    return this.loadedEcc;
  }

  /** The image bytes in the requested stride: 528 (ECC) or 512 (spares dropped). */
  getCardImage(ecc: boolean): Uint8Array {
    return ecc ? this.raw : stripImageSpares(this.raw);
  }

  getRawData(offset = 0, length = this.raw.length - offset): Uint8Array {
    return this.raw.slice(offset, offset + length);
  }

  getRawChecksum(): string {
    return formatCrc32(crc32(this.raw));
  }

  public get changed(): boolean {
    if (!this.changedFlag) return false;
    return !(this.savedState !== null && this.rawEquals(this.savedState));
  }

  // A card read from a device is of unknown origin, so it is treated as
  // edited until the user saves or reverts it.
  public markChanged(): void {
    this.changedFlag = true;
    this.savedState = null;
  }

  public get undoCount(): number {
    return this.undoList.length;
  }

  public get redoCount(): number {
    return this.redoList.length;
  }

  public undo(): boolean {
    const item = this.undoList[this.undoList.length - 1];
    if (!item) return false;
    this.redoList.push(this.capturePages(item.pages));
    this.restorePages(item);
    this.undoList.pop();
    return true;
  }

  public redo(): boolean {
    const item = this.redoList[this.redoList.length - 1];
    if (!item) return false;
    this.undoList.push(this.capturePages(item.pages));
    this.restorePages(item);
    this.redoList.pop();
    return true;
  }

  // -------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------

  /** Existing save directories in the root, in on-card order. */
  getSaves(): Ps2SaveInfo[] {
    if (this.savesCache) return this.savesCache;
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
    this.savesCache = saves;
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

  /**
   * User-data bytes for single-save export: the file named after the save,
   * else the largest file that is not icon.sys. Null when the save has none.
   */
  getSingleSaveBytes(saveName: string): Uint8Array | null {
    const saveDir = this.getRootDirEntry(saveName);
    if (saveDir === null) return null;
    const files = readDirectory(
      this.raw,
      this.sb,
      saveDir.cluster,
      saveDir.length,
    ).filter((f) => f.isFile);
    let picked: Ps2DirEntry | null = null;
    for (const file of files) {
      if (file.name === saveName) {
        picked = file;
        break;
      }
    }
    if (picked === null) {
      let bestSize = -1;
      for (const file of files) {
        if (file.name.toLowerCase() === "icon.sys") continue;
        if (file.length > bestSize) {
          bestSize = file.length;
          picked = file;
        }
      }
    }
    return picked === null ? null : this.readChainBytes(picked);
  }

  /** Every file in a save as name + bytes (container export input). */
  getSaveFiles(saveName: string): { name: string; data: Uint8Array }[] {
    const saveDir = this.getRootDirEntry(saveName);
    if (saveDir === null) return [];
    const out: { name: string; data: Uint8Array }[] = [];
    for (const entry of readDirectory(
      this.raw,
      this.sb,
      saveDir.cluster,
      saveDir.length,
    )) {
      if (entry.isFile) {
        out.push({ name: entry.name, data: this.readChainBytes(entry) });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------
  // File I/O (downloads)
  // -------------------------------------------------------------------

  public async saveMemoryCard(
    fileName: string,
    ecc?: boolean,
  ): Promise<boolean> {
    const ok = this.download(
      fileName,
      this.getCardImage(ecc ?? this.loadedEcc),
    );
    if (ok) {
      this.changedFlag = false;
      this.savedState = this.raw.slice();
    }
    return ok;
  }

  public async saveSingleSave(
    fileName: string,
    saveName: string,
  ): Promise<boolean> {
    const data = this.getSingleSaveBytes(saveName);
    if (data === null) return false;
    return this.download(fileName, data);
  }

  /** Container bytes for a save, or null when it has no files. */
  public async getContainerBytes(
    saveName: string,
    format: Ps2SingleSaveFormat,
  ): Promise<Uint8Array | null> {
    const files = this.getSaveFiles(saveName);
    if (files.length === 0) return null;
    const save = this.getSaves().find((s) => s.name === saveName);
    const time = save?.created ?? ZERO_TIME;
    const container: Ps2Container = {
      format: toContainerFormat(format),
      title: saveName,
      created: time,
      modified: save?.modified ?? ZERO_TIME,
      files: files.map((f) => ({
        name: f.name,
        data: f.data,
        created: time,
        modified: time,
      })),
    };
    return writePs2Container(container);
  }

  public async saveSingleSaveContainer(
    fileName: string,
    saveName: string,
    format: Ps2SingleSaveFormat,
  ): Promise<boolean> {
    // A container writer can reject (e.g. a CompressionStream failure). Catch
    // it here — in the card model, not the UI — and report it like a failed
    // download instead of throwing into the React export handler.
    let data: Uint8Array | null;
    try {
      data = await this.getContainerBytes(saveName, format);
    } catch (error) {
      console.error("Failed to build save container:", error);
      return false;
    }
    if (data === null) return false;
    return this.download(fileName, data);
  }

  private download(fileName: string, data: Uint8Array): boolean {
    try {
      const blob = new Blob([new Uint8Array(data)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error("Failed to save file:", error);
      return false;
    }
  }

  // -------------------------------------------------------------------
  // Write side
  // -------------------------------------------------------------------

  /**
   * Console-style delete: clear the exists bit of the root entry. The name,
   * the entry's slot and the save's cluster chain all stay on the card; the
   * slot becomes reusable for the next save.
   */
  public deleteSave(name: string): boolean {
    const entry = this.getRootDirEntry(name);
    if (entry === null) return false;
    this.pushHistory([this.entryPage(entry.relCluster, entry.slot)]);
    writeDirEntry(this.raw, this.sb, entry.relCluster, entry.slot, {
      name: entry.name,
      mode: entry.mode & ~MODE_EXISTS,
      length: entry.length,
      cluster: entry.cluster,
      dirEntry: entry.dirEntry,
      created: entry.created,
      modified: entry.modified,
      attr: entry.attr,
    });
    this.changedFlag = true;
    return true;
  }

  /**
   * Clone an existing save (files, flags and all) under a new name. The
   * data file named after the source is renamed to the new save name,
   * keeping the "data file carries the save name" convention.
   */
  public copySave(sourceName: string, newName: string): boolean {
    const source = this.getRootDirEntry(sourceName);
    if (source === null) return false;
    const files: FileSpec[] = [];
    for (const entry of readDirectory(
      this.raw,
      this.sb,
      source.cluster,
      source.length,
    )) {
      if (!entry.isFile) continue;
      files.push({
        name: entry.name === sourceName ? newName : entry.name,
        mode: entry.mode,
        data: this.readChainBytes(entry),
      });
    }
    return this.createSave(newName, source.mode, files);
  }

  /** Create a new save holding one user-data file named after the save. */
  public importSingleSave(
    name: string,
    data: Uint8Array,
    opts: Ps2ImportOptions = {},
  ): boolean {
    if (data.length === 0) return false;
    let mode = DIR_MODE;
    let fileMode = FILE_MODE;
    if (opts.hidden) mode |= MODE_HIDDEN;
    if (opts.ps1) {
      mode |= MODE_PSX;
      fileMode |= MODE_PSX;
    }
    if (opts.pocketStation) {
      mode |= MODE_PDA;
      fileMode |= MODE_PDA;
    }
    const icon = buildIconSys({
      title: opts.title ?? name,
      bgColors: opts.bgColors,
    });
    return this.createSave(name, mode, [
      { name: "icon.sys", mode: FILE_MODE, data: icon },
      { name, mode: fileMode, data },
    ]);
  }

  /**
   * Create a save from a container's file set: the files land verbatim and an
   * icon.sys is generated only when the container does not carry one.
   */
  public importContainer(
    name: string,
    files: { name: string; data: Uint8Array }[],
    opts: Ps2ImportOptions = {},
  ): boolean {
    if (files.length === 0) return false;
    let mode = DIR_MODE;
    let fileMode = FILE_MODE;
    if (opts.hidden) mode |= MODE_HIDDEN;
    if (opts.ps1) {
      mode |= MODE_PSX;
      fileMode |= MODE_PSX;
    }
    if (opts.pocketStation) {
      mode |= MODE_PDA;
      fileMode |= MODE_PDA;
    }
    const specs: FileSpec[] = [];
    let hasIcon = false;
    for (const f of files) {
      if (f.name.toLowerCase() === "icon.sys") hasIcon = true;
      specs.push({ name: f.name, mode: fileMode, data: f.data });
    }
    if (!hasIcon) {
      const icon = buildIconSys({
        title: opts.title ?? name,
        bgColors: opts.bgColors,
      });
      specs.push({ name: "icon.sys", mode: FILE_MODE, data: icon });
    }
    return this.createSave(name, mode, specs);
  }

  /**
   * Rebuild the image as a freshly formatted card of the given size
   * (8 MB default; 8–128 MB). Clears the undo/redo history, like creating
   * a new PS1 card.
   */
  public formatCard(sizeMb = 8): boolean {
    if (sizeMb < 8 || sizeMb > 128 || sizeMb % 8 !== 0) return false;
    const raw = format2(sizeMb * 1024);
    this.raw = raw;
    this.sb = parseSuperblock(raw);
    this.loadedEcc = true;
    this.undoList = [];
    this.redoList = [];
    this.changedFlag = false;
    this.savedState = raw.slice();
    this.savesCache = null;
    return true;
  }

  // -------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------

  private capturePages(pages: number[]): PageSnapshot {
    return {
      pages: [...pages],
      data: pages.map((p) =>
        this.raw.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE),
      ),
    };
  }

  private restorePages(item: PageSnapshot): void {
    for (let i = 0; i < item.pages.length; i++) {
      this.raw.set(item.data[i], item.pages[i] * PAGE_SIZE);
    }
    this.savesCache = null;
  }

  // Snapshot the given pages before a mutation runs; clears the redo branch
  // (any new edit invalidates it).
  private pushHistory(pages: number[]): void {
    const unique = [...new Set(pages)].sort((a, b) => a - b);
    if (unique.length === 0) return;
    this.undoList.push(this.capturePages(unique));
    while (this.undoList.length > this.undoLimit) this.undoList.shift();
    this.redoList = [];
    this.savesCache = null;
  }

  // -------------------------------------------------------------------
  // Create/delete internals
  // -------------------------------------------------------------------

  // Layout of one created save, planned read-only before any mutation.
  private createSave(name: string, mode: number, files: FileSpec[]): boolean {
    if (!PS2MemoryCard.isValidName(name)) return false;
    if (this.getRootDirEntry(name) !== null) return false;
    if (files.length === 0) return false;

    const sb = this.sb;
    const entryCount = 2 + files.length;
    const dirCount = Math.ceil(entryCount / 2);
    const dataCounts = files.map((f) =>
      Math.max(1, Math.ceil(f.data.length / CLUSTER_DATA_SIZE)),
    );

    // Where the new root entry goes: first slot without the exists bit,
    // extending the root chain when every slot is used.
    const rootChain = clusterChain(this.raw, sb, ROOT_CLUSTER);
    let hostRel = -1;
    let hostSlot: 0 | 1 = 0;
    let ordinal = 0;
    outer: for (let ci = 0; ci < rootChain.length; ci++) {
      for (const slot of [0, 1] as const) {
        const entry = readDirEntry(this.raw, sb, rootChain[ci], slot);
        if (!entry.exists) {
          hostRel = rootChain[ci];
          hostSlot = slot;
          break outer;
        }
        ordinal++;
      }
    }
    const extendsRoot = hostRel === -1;

    const free = this.collectFree();
    const needed =
      (extendsRoot ? 1 : 0) + dirCount + dataCounts.reduce((a, b) => a + b, 0);
    if (free.length < needed) return false;
    let cursor = 0;
    const take = (count: number): number[] => {
      const out = free.slice(cursor, cursor + count);
      cursor += count;
      return out;
    };
    const newRootRel = extendsRoot ? take(1)[0] : -1;
    if (extendsRoot) hostRel = newRootRel;
    const dirChain = take(dirCount);
    const dataChains = dataCounts.map((count) => take(count));

    // Snapshot everything the mutation will touch (read-only up to here).
    const touched: number[] = [];
    const markCluster = (rel: number) => {
      const abs = sb.allocOffset + rel;
      touched.push(abs * PAGES_PER_CLUSTER, abs * PAGES_PER_CLUSTER + 1);
      const fatPage = fatEntryPage(this.raw, sb, rel);
      if (fatPage >= 0) touched.push(fatPage);
    };
    if (extendsRoot) {
      markCluster(newRootRel);
      const lastFat = fatEntryPage(
        this.raw,
        sb,
        rootChain[rootChain.length - 1],
      );
      if (lastFat >= 0) touched.push(lastFat);
    }
    dirChain.forEach(markCluster);
    dataChains.forEach((chain) => chain.forEach(markCluster));
    touched.push(this.entryPage(hostRel, hostSlot));
    this.pushHistory(touched);

    // File data chains.
    for (let i = 0; i < files.length; i++) {
      const chain = dataChains[i];
      const data = files[i].data;
      for (let c = 0; c < chain.length; c++) {
        const buf = new Uint8Array(CLUSTER_DATA_SIZE);
        buf.set(
          data.subarray(
            c * CLUSTER_DATA_SIZE,
            Math.min(data.length, (c + 1) * CLUSTER_DATA_SIZE),
          ),
        );
        writeClusterData(this.raw, sb.allocOffset + chain[c], buf);
      }
      this.linkChain(chain);
    }
    this.linkChain(dirChain);

    if (extendsRoot) {
      fatSet(
        this.raw,
        sb,
        rootChain[rootChain.length - 1],
        FAT_ALLOCATED_BIT | newRootRel,
      );
      fatSet(this.raw, sb, newRootRel, FAT_EOF);
      // The sibling slot is initialized as an empty entry so every slot in
      // the chain is explicit (erased slots read back as mode 0xFFFF, which
      // would look like a used entry).
      writeDirEntry(this.raw, sb, newRootRel, 1, {
        name: "",
        mode: 0,
        length: 0,
        cluster: 0,
        dirEntry: 0,
        created: ZERO_TIME,
        modified: ZERO_TIME,
        attr: 0,
      });
    }

    // Save directory: "." (dir_entry = our slot in the parent), "..", files.
    const time = PS2MemoryCard.nowJst();
    writeDirEntry(this.raw, sb, dirChain[0], 0, {
      name: SELF_ENTRY,
      mode: DIR_MODE,
      length: 0,
      cluster: 0,
      dirEntry: ordinal,
      created: time,
      modified: time,
      attr: 0,
    });
    writeDirEntry(this.raw, sb, dirChain[0], 1, {
      name: PARENT_ENTRY,
      mode: DIR_MODE,
      length: 0,
      cluster: 0,
      dirEntry: 0,
      created: time,
      modified: time,
      attr: 0,
    });
    for (let i = 0; i < files.length; i++) {
      const pos = 2 + i; // entries after "." and ".."
      writeDirEntry(
        this.raw,
        sb,
        dirChain[Math.floor(pos / 2)],
        (pos % 2) as 0 | 1,
        {
          name: files[i].name,
          mode: files[i].mode,
          length: files[i].data.length,
          cluster: dataChains[i][0],
          dirEntry: 0,
          created: time,
          modified: time,
          attr: 0,
        },
      );
    }

    // Root entry.
    writeDirEntry(this.raw, sb, hostRel, hostSlot, {
      name,
      mode,
      length: entryCount,
      cluster: dirChain[0],
      dirEntry: 0,
      created: time,
      modified: time,
      attr: 0,
    });
    this.changedFlag = true;
    return true;
  }

  /** Link an allocated chain (all clusters already claimed). */
  private linkChain(chain: number[]): void {
    for (let i = 0; i < chain.length; i++) {
      fatSet(
        this.raw,
        this.sb,
        chain[i],
        i < chain.length - 1 ? FAT_ALLOCATED_BIT | chain[i + 1] : FAT_EOF,
      );
    }
  }

  // Free clusters in ascending order (MSB-clear FAT entries).
  private collectFree(): number[] {
    const out: number[] = [];
    for (let rel = 1; rel < this.sb.allocEnd; rel++) {
      if (!(fatGet(this.raw, this.sb, rel) & FAT_ALLOCATED_BIT)) out.push(rel);
    }
    return out;
  }

  // Absolute page index of a directory entry slot.
  private entryPage(relCluster: number, slot: number): number {
    return (this.sb.allocOffset + relCluster) * PAGES_PER_CLUSTER + slot;
  }

  private rawEquals(other: Uint8Array): boolean {
    if (other.length !== this.raw.length) return false;
    for (let i = 0; i < this.raw.length; i++) {
      if (this.raw[i] !== other[i]) return false;
    }
    return true;
  }

  // Card names: 1–32 printable ASCII, no `? * /`, not "." or "..".
  static isValidName(name: string): boolean {
    if (name.length === 0 || name.length > 32) return false;
    if (name === SELF_ENTRY || name === PARENT_ENTRY) return false;
    for (let i = 0; i < name.length; i++) {
      const code = name.charCodeAt(i);
      const c = name[i];
      if (code < 0x20 || code > 0x7e || c === "?" || c === "*" || c === "/") {
        return false;
      }
    }
    return true;
  }

  // Cards store Japan Standard Time wall clocks.
  static nowJst(): Ps2DateTime {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return {
      sec: d.getUTCSeconds(),
      min: d.getUTCMinutes(),
      hour: d.getUTCHours(),
      day: d.getUTCDate(),
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
    };
  }

  // -------------------------------------------------------------------
  // Read internals
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
      [icon?.viewIcon, icon?.copyIcon, icon?.delIcon]
        .filter((name): name is string => name !== undefined && name !== "")
        .map((name) => name.toLowerCase()),
    );
    const list: Ps2FileInfo[] = [];
    let totalSize = 0;
    for (const file of files) {
      list.push({ name: file.name, size: file.length });
      const normalizedName = file.name.toLowerCase();
      if (normalizedName !== "icon.sys" && !iconFiles.has(normalizedName)) {
        totalSize += file.length;
      }
    }
    let iconModel: Ps2IconModel | null = null;
    const viewIcon = icon?.viewIcon;
    if (viewIcon) {
      const normalizedViewIcon = viewIcon.toLowerCase();
      const iconFile = files.find(
        (file) => file.name.toLowerCase() === normalizedViewIcon,
      );
      if (iconFile) {
        iconModel = parsePs2Icon(this.readChainBytes(iconFile));
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
      backgroundTransparency: icon?.transparency ?? 0,
      viewIcon: icon?.viewIcon ?? "",
      iconModel,
      iconLighting: icon
        ? {
            dirs: icon.lightDir.slice(0, 3),
            cols: icon.lightCol.slice(0, 3),
            ambient: icon.lightAmbient,
          }
        : null,
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
