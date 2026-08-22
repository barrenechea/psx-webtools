import { aesCbcDecrypt, aesCbcEncrypt, getHmac } from "@/lib/crypto-utils";
import {
  generateSaltSeed,
  mcxIv,
  mcxKey,
  saveIv,
  saveKey,
} from "@/lib/ps1-keys";

// Constants
const SLOT_COUNT = 15;
const BYTES_PER_SLOT = 8192;
const HEADER_SIZE = 128;
const ICON_SIZE = 16;
const TOTAL_CARD_SIZE = 131072; // 128 KB

// Enums
export enum CardTypes {
  Raw,
  Gme,
  Vgs,
  Vmp,
  Mcx,
}

export enum SlotTypes {
  Formatted = 0xa0,
  Initial = 0x51,
  MiddleLink = 0x52,
  EndLink = 0x53,
  DeletedInitial = 0xa1,
  DeletedMiddleLink = 0xa2,
  DeletedEndLink = 0xa3,
  Corrupted = 0xff,
}

export enum SingleSaveTypes {
  Raw,
  Mcs,
  Psv,
  Psx,
}

// The kind of data a card slot holds: a regular save or a PocketStation
// application (called "software" in the PS2 browser).
export enum DataTypes {
  Save = 0,
  Software = 1,
}

// The two monochromatic icon formats a PocketStation save can carry.
export enum IconTypes {
  MCIcon = 0,
  APIcon = 1,
}

export const CardExtensions = {
  [CardTypes.Raw]: ".mcr",
  [CardTypes.Gme]: ".gme",
  [CardTypes.Vgs]: ".vgs",
  [CardTypes.Vmp]: ".vmp",
  [CardTypes.Mcx]: ".mcx",
} as const;

export const SingleSaveExtensions = {
  [SingleSaveTypes.Mcs]: ".mcs",
  [SingleSaveTypes.Raw]: ".raw",
  [SingleSaveTypes.Psv]: ".psv",
  [SingleSaveTypes.Psx]: ".mcb",
} as const;

// Extensions accepted for a raw/standard memory card (mirrors the reference
// "Standard Memory Card" import group). The card content is identical; only
// the file name suffix differs.
export const RAW_EXTENSIONS: string[] = [
  ".mcr",
  ".bin",
  ".ddf",
  ".mc",
  ".mcd",
  ".mci",
  ".ps",
  ".psm",
  ".srm",
  ".vm1",
  ".vmc",
  ".sav",
];

// All known PS1 card / single-save extensions. Derived from the format maps
// above so every extension the UI can produce is also stripped by
// withSingleExtension (prevents stacked names like "card.mci.mcd").
const KNOWN_FILE_EXTENSIONS = Array.from(
  new Set([
    ...Object.values(CardExtensions),
    ...Object.values(SingleSaveExtensions),
    ...RAW_EXTENSIONS,
    // Additional raw/import variants accepted on load but not tied to a
    // specific save format.
    ".ps1",
    ".mem",
    ".mc1",
    ".mc2",
    ".pda",
    ".psx",
  ]),
);

/**
 * Strips any stacked known extensions from a file name and appends the target
 * extension exactly once, so the result always ends with a single, correct
 * extension (e.g. "card.mcr.mcr" + ".gme" -> "card.gme").
 */
export function withSingleExtension(
  fileName: string,
  targetExtension: string,
): string {
  let name = fileName.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const lower = name.toLowerCase();
    for (const ext of KNOWN_FILE_EXTENSIONS) {
      if (lower.endsWith(ext)) {
        name = name.slice(0, name.length - ext.length);
        changed = true;
        break;
      }
    }
  }
  if (!name.toLowerCase().endsWith(targetExtension.toLowerCase())) {
    name += targetExtension;
  }
  return name;
}

export function hasFileExtension(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  const lastDot = base.lastIndexOf(".");
  return lastDot > 0 && lastDot < base.length - 1;
}

export function getFileExtension(name: string): string {
  const base = name.split("/").pop() ?? name;
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot >= base.length - 1) return "";
  return base.slice(lastDot).toLowerCase();
}

export interface SaveInfo {
  slotNumber: number;
  name: string;
  productCode: string;
  identifier: string;
  region: string;
  regionRaw: string;
  blockCount: number;
  iconFrameCount: number;
  slotType: SlotTypes;
  comment: string;
}

// A whole-slot snapshot used by the undo/redo history. Each affected slot
// stores its full 128-byte header and 8192-byte data; the GME comment is
// captured for the first (master) slot only.
interface UndoItem {
  slots: number[];
  header: Uint8Array[];
  data: Uint8Array[];
  saveComment: string;
}

type RGBAColor = [number, number, number, number];
export type IconPalette = RGBAColor[];
type IconData = number[]; // Single icon data is a 1D array of numbers
export type SlotIconData = IconData[]; // Icons for a single slot (up to 3 icons)
// A slot's palette-resolved icon colors (up to 3 frames, each 256 pixels).
export type SlotIconColors = RGBAColor[][];
const BLANK_COLOR: RGBAColor = [0, 0, 0, 0];

class PS1MemoryCard {
  private rawData: Uint8Array;
  private cardType: CardTypes = CardTypes.Raw;

  getCardType(): CardTypes {
    return this.cardType;
  }

  private saves: SaveInfo[] = [];
  private slotTypes: SlotTypes[] = new Array<SlotTypes>(SLOT_COUNT).fill(
    SlotTypes.Formatted,
  );
  private iconPalette: IconPalette[] = [];
  private iconData: SlotIconData[] = [];
  // Palette-resolved icon colors (per pixel), so the UI can draw a slot directly.
  // Filled from the master slot and shared across its linked slots.
  private iconColorData: RGBAColor[][][] = [];
  private cardName: string | null = null;
  //private cardLocation: string | null = null;
  private changedFlag = false;
  private savedState: Uint8Array | null = null;

  private undoList: UndoItem[] = [];
  private redoList: UndoItem[] = [];

  public get changed(): boolean {
    if (!this.changedFlag) return false;
    // The card was edited but may have since been reverted (e.g. fully undone);
    // clear the indicator once its bytes match the last saved/loaded state.
    return !(this.savedState !== null && this.rawDataEquals(this.savedState));
  }

  // A card read from a device is of unknown origin, so it is treated as edited
  // (mirrors the reference's OpenMemoryCardStream).
  public markChanged(): void {
    this.changedFlag = true;
    this.savedState = null;
  }

  private rawDataEquals(other: Uint8Array): boolean {
    if (other.length !== this.rawData.length) return false;
    for (let i = 0; i < this.rawData.length; i++) {
      if (this.rawData[i] !== other[i]) return false;
    }
    return true;
  }

  public get undoCount(): number {
    return this.undoList.length;
  }

  public get redoCount(): number {
    return this.redoList.length;
  }

  // New properties to match C# implementation
  private headerData: Uint8Array[] = Array.from(
    { length: SLOT_COUNT },
    () => new Uint8Array(HEADER_SIZE),
  );
  private saveData: Uint8Array[] = Array.from(
    { length: SLOT_COUNT },
    () => new Uint8Array(BYTES_PER_SLOT),
  );

  private saveComments: string[] = new Array<string>(SLOT_COUNT).fill("");
  private saveDataTypes: DataTypes[] = new Array<DataTypes>(SLOT_COUNT).fill(
    DataTypes.Save,
  );
  //private masterSlot: number[] = new Array<number>(SLOT_COUNT).fill(0);

  constructor() {
    this.rawData = new Uint8Array(TOTAL_CARD_SIZE);
    this.initializeIconData();
  }

  private initializeIconData(): void {
    this.iconPalette = Array.from({ length: SLOT_COUNT }, () =>
      Array.from({ length: 16 }, (): RGBAColor => [0, 0, 0, 0]),
    );

    this.iconData = Array.from({ length: SLOT_COUNT }, () =>
      Array.from({ length: 3 }, () =>
        Array.from({ length: ICON_SIZE * ICON_SIZE }, () => 0),
      ),
    );

    this.iconColorData = Array.from({ length: SLOT_COUNT }, () =>
      Array.from({ length: 3 }, () =>
        Array.from({ length: ICON_SIZE * ICON_SIZE }, () => BLANK_COLOR),
      ),
    );
  }

  public getRawData(offset: number, length: number): Uint8Array {
    return this.rawData.slice(offset, offset + length);
  }

  public setRawData(offset: number, data: Uint8Array, fixData = false): void {
    this.rawData.set(data, offset);
    this.loadMemoryCardData(fixData);
  }

  public loadFromRawData(data: Uint8Array, fixData = false): void {
    if (data.length !== TOTAL_CARD_SIZE) {
      throw new Error(
        `Invalid data size. Expected ${TOTAL_CARD_SIZE} bytes, got ${data.length} bytes.`,
      );
    }
    this.rawData = data.slice();
    this.loadMemoryCardData(fixData);
    this.savedState = this.rawData.slice();
  }

  async loadFromFile(file: File, fixData = false): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(arrayBuffer);

    this.cardName = file.name;
    const { cardType, startOffset, loadComments } =
      await this.determineCardType(fileData);
    this.cardType = cardType;

    // Extract raw data based on the determined offset. Copy into a full-size
    // buffer so a truncated file can't leave a short rawData (which would
    // overrun the next save).
    const raw = fileData.slice(startOffset, startOffset + TOTAL_CARD_SIZE);
    this.rawData = new Uint8Array(TOTAL_CARD_SIZE);
    this.rawData.set(raw);

    if (loadComments) {
      this.loadGMEComments(fileData);
    } else if (this.cardType === CardTypes.Mcx) {
      const decrypted = await this.decryptMcxCard(fileData);
      this.rawData = decrypted.slice(0x80, 0x80 + TOTAL_CARD_SIZE);
    }

    //this.cardLocation = URL.createObjectURL(file);
    this.loadMemoryCardData(fixData);
    this.savedState = this.rawData.slice();
  }

  private async determineCardType(data: Uint8Array): Promise<{
    cardType: CardTypes;
    startOffset: number;
    loadComments: boolean;
  }> {
    const fileSize = data.length;
    const headerString = this.getHeaderString(data);

    switch (headerString) {
      case "MC":
        return { cardType: CardTypes.Raw, startOffset: 0, loadComments: false };
      case "123-456-STD":
        return {
          cardType: CardTypes.Gme,
          startOffset: 3904,
          loadComments: true,
        };
      case "VgsM":
        return {
          cardType: CardTypes.Vgs,
          startOffset: 64,
          loadComments: false,
        };
      case "PMV":
        return {
          cardType: CardTypes.Vmp,
          startOffset: 128,
          loadComments: false,
        };
      default:
        if (await this.isMcxCard(data)) {
          return {
            cardType: CardTypes.Mcx,
            startOffset: 128,
            loadComments: false,
          };
        } else if (
          fileSize === 134976 &&
          data[3904] === 77 &&
          data[3905] === 67
        ) {
          // 'M' and 'C' — GME detected without the "123-456-STD" signature
          // (corrupted header), so the comment area can't be trusted.
          return {
            cardType: CardTypes.Gme,
            startOffset: 3904,
            loadComments: false,
          };
        } else {
          throw new Error(
            `'${this.cardName}' is not a supported Memory Card format.`,
          );
        }
    }
  }

  private getHeaderString(data: Uint8Array): string {
    const headerBytes = data.slice(0, 11);
    const trimmedBytes = headerBytes.filter(
      // added 0x80 for PMV
      (byte) => byte !== 0x0 && byte !== 0x1 && byte !== 0x3f && byte !== 0x80,
    );
    return new TextDecoder("ascii").decode(trimmedBytes);
  }

  private async isMcxCard(data: Uint8Array): Promise<boolean> {
    const decrypted = await this.decryptMcxCard(data);
    return this.arrayToString(decrypted.slice(0x80, 0x82)) === "MC";
  }

  private decryptMcxCard(rawCard: Uint8Array): Promise<Uint8Array> {
    const mcxCard = new Uint8Array(0x200a0);
    mcxCard.set(rawCard.subarray(0, mcxCard.length));
    return aesCbcDecrypt(mcxCard, mcxKey, mcxIv);
  }

  private loadGMEComments(data: Uint8Array): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const comment = this.arrayToString(
        data.slice(64 + 256 * i, 64 + 256 * (i + 1)),
      ).replace(/\0/g, "");
      this.saveComments[i] = comment;
    }
  }

  private arrayToString(array: Uint8Array): string {
    return String.fromCharCode.apply(null, Array.from(array));
  }

  // Detect whether a slot holds a PocketStation "software" save: an
  // initial/deleted slot whose header marks "P" and whose data carries the
  // MCX0/MCX1 signature (CRD0 does not trigger the software display).
  private loadSlotDataTypes(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      this.saveDataTypes[slotNumber] = DataTypes.Save;
      const isInitial =
        this.slotTypes[slotNumber] === SlotTypes.Initial ||
        this.slotTypes[slotNumber] === SlotTypes.DeletedInitial;
      if (!isInitial || this.headerData[slotNumber][0x10] !== 0x50) continue;
      const data = this.saveData[slotNumber];
      if (
        data[0x52] === 0x4d &&
        data[0x53] === 0x43 &&
        data[0x54] === 0x58 &&
        (data[0x55] === 0x30 || data[0x55] === 0x31)
      ) {
        this.saveDataTypes[slotNumber] = DataTypes.Software;
      }
    }
  }

  private loadMemoryCardData(fixXor: boolean = true): void {
    this.loadDataFromRawCard();
    this.loadSlotTypes();
    this.loadSlotDataTypes();
    this.findBrokenLinks();
    this.loadStringData();
    this.loadSaveSize();
    this.loadPalette();
    this.loadIcons();
    this.loadIconFrames();
    // Only recompute header XOR checksums when asked. On load this is opt-in
    // (see "try to fix corrupted cards"); after in-card edits it's always done
    // so the headers stay valid. FreePSXBoot/bootable cards must NOT be fixed.
    if (fixXor) this.calculateXOR();
  }

  private loadDataFromRawCard(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      // Load header data
      this.headerData[slotNumber].set(
        this.rawData.slice(128 + slotNumber * 128, 256 + slotNumber * 128),
      );

      // Load save data
      this.saveData[slotNumber].set(
        this.rawData.slice(8192 + slotNumber * 8192, 16384 + slotNumber * 8192),
      );
    }
  }

  private writeDataToRawCard(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      // Write header data
      this.rawData.set(this.headerData[slotNumber], 128 + slotNumber * 128);

      // Write save data
      this.rawData.set(this.saveData[slotNumber], 8192 + slotNumber * 8192);
    }
  }

  // Rebuild the raw buffer from the in-memory header/save data so a save
  // always reflects the current state (including any "fix corrupted cards" XOR
  // repair done at load time). When fixData is set the card is rebuilt as a
  // clean card (fresh signature and reserved slots).
  private loadDataToRawCard(fixData: boolean): void {
    if (fixData) {
      this.rawData.fill(0);
      this.rawData[0] = 0x4d; // M
      this.rawData[1] = 0x43; // C
      this.rawData[127] = 0x0e; // XOR (precalculated)
      this.rawData[8064] = 0x4d; // M
      this.rawData[8065] = 0x43; // C
      this.rawData[8191] = 0x0e; // XOR (precalculated)
    }

    this.writeDataToRawCard();

    if (!fixData) return;

    // Create authentic data (just for completeness)
    for (let i = 0; i < 20; i++) {
      this.rawData[2048 + i * 128] = 0xff;
      this.rawData[2048 + i * 128 + 1] = 0xff;
      this.rawData[2048 + i * 128 + 2] = 0xff;
      this.rawData[2048 + i * 128 + 3] = 0xff;
      this.rawData[2048 + i * 128 + 8] = 0xff;
      this.rawData[2048 + i * 128 + 9] = 0xff;
    }
  }

  private loadSlotTypes(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      switch (this.headerData[i][0]) {
        case 0xa0: // Formatted
        case 0x51: // Initial
        case 0x52: // MiddleLink
        case 0x53: // EndLink
        case 0xa1: // DeletedInitial
        case 0xa2: // DeletedMiddleLink
        case 0xa3: // DeletedEndLink
          this.slotTypes[i] = this.headerData[i][0] as SlotTypes;
          break;
        default:
          this.slotTypes[i] = SlotTypes.Corrupted;
          break;
      }
    }
  }

  private findBrokenLinks(): void {
    const slotTouched = new Array(SLOT_COUNT).fill(false);

    for (let i = 0; i < SLOT_COUNT; i++) {
      if (
        this.slotTypes[i] === SlotTypes.Initial ||
        this.slotTypes[i] === SlotTypes.DeletedInitial
      ) {
        this.findSaveLinks(i).forEach((slot) => (slotTouched[slot] = true));
      }
    }

    for (let i = 0; i < SLOT_COUNT; i++) {
      if (
        (this.slotTypes[i] === SlotTypes.MiddleLink ||
          this.slotTypes[i] === SlotTypes.EndLink ||
          this.slotTypes[i] === SlotTypes.DeletedMiddleLink ||
          this.slotTypes[i] === SlotTypes.DeletedEndLink) &&
        !slotTouched[i]
      ) {
        this.slotTypes[i] = SlotTypes.Formatted;
      }
    }
  }

  private findSaveLinks(initialSlot: number): number[] {
    const links: number[] = [];
    let currentSlot = initialSlot;

    // Add the current slot before advancing, so a link cycle (a corrupted card)
    // terminates at exactly SLOT_COUNT entries, matching the reference.
    for (let i = 0; i < SLOT_COUNT; i++) {
      links.push(currentSlot);

      if (this.slotTypes[currentSlot] === SlotTypes.Corrupted) break;

      const nextSlot = this.headerData[currentSlot][8];

      if (nextSlot === 0xff || nextSlot >= SLOT_COUNT) break;

      const nextSlotType = this.slotTypes[nextSlot];
      if (
        nextSlotType !== SlotTypes.MiddleLink &&
        nextSlotType !== SlotTypes.EndLink &&
        nextSlotType !== SlotTypes.DeletedMiddleLink &&
        nextSlotType !== SlotTypes.DeletedEndLink
      )
        break;

      currentSlot = nextSlot;
    }

    return links;
  }

  // Public view of a save's full slot chain (initial first), used by the info
  // dialog and per-slot actions.
  public getSaveLinks(slotNumber: number): number[] {
    return this.findSaveLinks(slotNumber);
  }

  // The master (initial) slot of the linked save that `slot` belongs to. A slot
  // that is not a middle/end link is its own master; a link slot resolves to the
  // initial slot whose pointer chain contains it.
  public getMasterLinkForSlot(slot: number): number {
    const isLink = (type: SlotTypes): boolean =>
      type === SlotTypes.MiddleLink ||
      type === SlotTypes.EndLink ||
      type === SlotTypes.DeletedMiddleLink ||
      type === SlotTypes.DeletedEndLink;
    if (!isLink(this.slotTypes[slot])) return slot;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const type = this.slotTypes[i];
      if (type !== SlotTypes.Initial && type !== SlotTypes.DeletedInitial)
        continue;
      if (this.findSaveLinks(i).includes(slot)) return i;
    }
    return slot;
  }

  private loadStringData(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slotType = this.slotTypes[i];
      // A linked slot is reported by its role and inherits the master's region;
      // its own prod/identifier stay empty (mirrors the reference's per-slot view).
      const isMiddleLink =
        slotType === SlotTypes.MiddleLink ||
        slotType === SlotTypes.DeletedMiddleLink;
      const isEndLink =
        slotType === SlotTypes.EndLink || slotType === SlotTypes.DeletedEndLink;
      const isLink = isMiddleLink || isEndLink;
      const master = isLink ? this.getMasterLinkForSlot(i) : i;
      const name = isLink
        ? isMiddleLink
          ? "Linked slot (middle link)"
          : "Linked slot (end link)"
        : this.getSaveName(i);

      this.saves[i] = {
        slotNumber: i,
        name,
        productCode: this.getProductCode(i),
        identifier: this.getIdentifier(i),
        region: this.getRegion(master),
        regionRaw: this.getRegionRaw(i),
        blockCount: this.getSaveSize(i),
        iconFrameCount: this.getIconFrameCount(i),
        slotType,
        comment: this.saveComments[i],
      };
    }
  }

  private getRegion(slotNumber: number): string {
    const regionCode = this.getRegionRaw(slotNumber);
    switch (regionCode) {
      case "BI":
        return "Japan";
      case "BA":
        return "America";
      case "BE":
        return "Europe";
      default:
        return regionCode;
    }
  }

  private getRegionRaw(slotNumber: number): string {
    return this.arrayToString(this.headerData[slotNumber].slice(10, 12));
  }

  private getProductCode(slotNumber: number): string {
    return this.arrayToString(
      this.headerData[slotNumber].slice(12, 22),
    ).replace(/\0/g, "");
  }

  private getIdentifier(slotNumber: number): string {
    return this.arrayToString(
      this.headerData[slotNumber].slice(22, 30),
    ).replace(/\0/g, "");
  }

  private getSaveName(slotNumber: number): string {
    const nameBytes = this.saveData[slotNumber].slice(4, 68);
    let nullTerminator = nameBytes.findIndex(
      (byte, index) =>
        index % 2 === 0 && byte === 0 && nameBytes[index + 1] === 0,
    );
    if (nullTerminator === -1) nullTerminator = 64;

    // First, try Shift-JIS decoding
    try {
      const shiftJisDecoder = new TextDecoder("shift-jis");
      const decodedName = shiftJisDecoder.decode(
        nameBytes.slice(0, nullTerminator),
      );
      return this.normalizeFullWidthChars(decodedName);
    } catch (error) {
      console.warn("Failed to decode save name using Shift-JIS:", error);
    }

    // If Shift-JIS fails, fall back to ASCII
    try {
      const asciiDecoder = new TextDecoder("ascii");
      return asciiDecoder.decode(nameBytes.slice(0, nullTerminator));
    } catch (error) {
      console.error("Failed to decode save name:", error);
      return "Unknown";
    }
  }

  private normalizeFullWidthChars(input: string): string {
    return input.normalize("NFKC");
  }

  private getSaveSize(slotNumber: number): number {
    const size =
      this.headerData[slotNumber][4] |
      (this.headerData[slotNumber][5] << 8) |
      (this.headerData[slotNumber][6] << 16);
    return Math.trunc(size / 1024);
  }

  private getIconFrameCount(slotNumber: number): number {
    switch (this.saveData[slotNumber][2]) {
      case 0x11:
        return 1;
      case 0x12:
        return 2;
      case 0x13:
        return 3;
      default:
        return 0;
    }
  }

  private loadSaveSize(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.saves[i].blockCount = this.getSaveSize(i);
    }
  }

  private loadPalette(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      const paletteStart = 96;
      for (let colorIndex = 0; colorIndex < 16; colorIndex++) {
        const colorValue =
          this.saveData[slotNumber][paletteStart + colorIndex * 2] |
          (this.saveData[slotNumber][paletteStart + colorIndex * 2 + 1] << 8);
        const r = ((colorValue & 0x1f) << 3) | ((colorValue & 0x1f) >> 2);
        const g =
          (((colorValue >> 5) & 0x1f) << 3) | (((colorValue >> 5) & 0x1f) >> 2);
        const b =
          (((colorValue >> 10) & 0x1f) << 3) |
          (((colorValue >> 10) & 0x1f) >> 2);
        const a = colorValue & 0x8000 ? 255 : 0;
        this.iconPalette[slotNumber][colorIndex] = [r, g, b, a];
      }
    }
  }

  private loadIcons(): void {
    // Reset the resolved colors; each master re-fills its own slot plus every
    // linked slot below, so a formatted/empty slot ends up blank.
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      for (let iconNumber = 0; iconNumber < 3; iconNumber++) {
        const frame = this.iconColorData[slotNumber][iconNumber];
        for (let pixel = 0; pixel < ICON_SIZE * ICON_SIZE; pixel++) {
          frame[pixel] = BLANK_COLOR;
        }
      }
    }

    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      if (
        this.slotTypes[slotNumber] === SlotTypes.Initial ||
        this.slotTypes[slotNumber] === SlotTypes.DeletedInitial
      ) {
        const saveLinks = this.findSaveLinks(slotNumber);
        const iconDataStart = 128;
        for (let iconNumber = 0; iconNumber < 3; iconNumber++) {
          const iconStart = iconDataStart + iconNumber * 128;
          for (let y = 0; y < ICON_SIZE; y++) {
            for (let x = 0; x < ICON_SIZE / 2; x++) {
              const pixelData =
                this.saveData[slotNumber][iconStart + y * 8 + x];
              const low = pixelData & 0xf;
              const high = pixelData >> 4;
              this.iconData[slotNumber][iconNumber][y * ICON_SIZE + x * 2] =
                low;
              this.iconData[slotNumber][iconNumber][y * ICON_SIZE + x * 2 + 1] =
                high;
              // The master's palette-resolved colors are shared by the whole
              // link chain, so a linked slot draws the master's icon.
              for (const selectedSlot of saveLinks) {
                const frame = this.iconColorData[selectedSlot][iconNumber];
                frame[y * ICON_SIZE + x * 2] =
                  this.iconPalette[slotNumber][low];
                frame[y * ICON_SIZE + x * 2 + 1] =
                  this.iconPalette[slotNumber][high];
              }
            }
          }
        }
      }
    }
  }

  private loadIconFrames(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.saves[i].iconFrameCount = this.getIconFrameCount(i);
    }
  }

  private calculateXOR(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      let xorChecksum = 0;
      for (let i = 0; i < 127; i++) {
        xorChecksum ^= this.headerData[slotNumber][i];
      }
      this.headerData[slotNumber][127] = xorChecksum;
      // Keep the serialized buffer in sync so a hardware write (which reads
      // rawData directly) carries a valid checksum, not the pre-edit value.
      this.rawData[128 + slotNumber * 128 + 127] = xorChecksum;
    }
  }

  public getSaves(): SaveInfo[] {
    return this.saves;
  }

  public toggleDeleteSave(slotNumber: number): void {
    const saveSlots = this.findSaveLinks(slotNumber);
    this.pushToUndoRedoBuffer(saveSlots, this.undoList, true);

    for (const slot of saveSlots) {
      switch (this.slotTypes[slot]) {
        case SlotTypes.Initial:
          this.headerData[slot][0] = SlotTypes.DeletedInitial;
          break;
        case SlotTypes.MiddleLink:
          this.headerData[slot][0] = SlotTypes.DeletedMiddleLink;
          break;
        case SlotTypes.EndLink:
          this.headerData[slot][0] = SlotTypes.DeletedEndLink;
          break;
        case SlotTypes.DeletedInitial:
          this.headerData[slot][0] = SlotTypes.Initial;
          break;
        case SlotTypes.DeletedMiddleLink:
          this.headerData[slot][0] = SlotTypes.MiddleLink;
          break;
        case SlotTypes.DeletedEndLink:
          this.headerData[slot][0] = SlotTypes.EndLink;
          break;
      }
    }

    this.writeDataToRawCard();
    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  public formatSave(slotNumber: number): void {
    const saveSlots = this.findSaveLinks(slotNumber);
    this.pushToUndoRedoBuffer(saveSlots, this.undoList, true);

    for (const slot of saveSlots) {
      this.formatSlot(slot);
    }

    this.writeDataToRawCard();
    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  private formatSlot(slotNumber: number): void {
    this.headerData[slotNumber].fill(0);
    this.saveData[slotNumber].fill(0);
    this.headerData[slotNumber][0] = SlotTypes.Formatted;
    this.headerData[slotNumber][8] = 0xff;
    this.headerData[slotNumber][9] = 0xff;
    this.saveComments[slotNumber] = "";
  }

  // Format every slot on the card into a clean, blank state. Used to create a
  // new card; leaves the card unmodified (changedFlag stays false). Rebuilds the
  // raw buffer as a clean card (signature + reserved area) so the result is a
  // valid card even when saved without "fix corrupted".
  public formatCard(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.formatSlot(i);
    }
    this.loadDataToRawCard(true);
    this.loadMemoryCardData();
    this.changedFlag = false;
    this.savedState = this.rawData.slice();
  }

  // Snapshot the current state of the given slots onto a history buffer before
  // a mutation runs. `clearRedo` wipes the redo branch (any new edit invalidates
  // it); the undo/redo operations pass false so they don't clobber the branch
  // they are moving into.
  private pushToUndoRedoBuffer(
    slots: number[],
    target: UndoItem[],
    clearRedo: boolean,
  ): void {
    target.push({
      slots: [...slots],
      header: slots.map((slot) => this.headerData[slot].slice()),
      data: slots.map((slot) => this.saveData[slot].slice()),
      saveComment: this.saveComments[slots[0]] ?? "",
    });
    if (clearRedo) {
      this.redoList = [];
    }
  }

  private restoreSlotsFromUndoRedo(buffer: UndoItem[]): void {
    const item = buffer[buffer.length - 1];
    for (let i = 0; i < item.slots.length; i++) {
      const slot = item.slots[i];
      this.headerData[slot].set(item.header[i]);
      this.saveData[slot].set(item.data[i]);
    }
    this.saveComments[item.slots[0]] = item.saveComment;
    buffer.pop();
    this.writeDataToRawCard();
    this.loadMemoryCardData();
  }

  public undo(): boolean {
    if (this.undoList.length < 1) return false;
    const lastUndo = this.undoList[this.undoList.length - 1];
    this.pushToUndoRedoBuffer(lastUndo.slots, this.redoList, false);
    this.restoreSlotsFromUndoRedo(this.undoList);
    return true;
  }

  public redo(): boolean {
    if (this.redoList.length < 1) return false;
    const lastRedo = this.redoList[this.redoList.length - 1];
    this.pushToUndoRedoBuffer(lastRedo.slots, this.undoList, false);
    this.restoreSlotsFromUndoRedo(this.redoList);
    return true;
  }

  public getSaveBytes(slotNumber: number): Uint8Array {
    const saveSlots = this.findSaveLinks(slotNumber);
    const saveSize = HEADER_SIZE + saveSlots.length * BYTES_PER_SLOT;
    const saveBytes = new Uint8Array(saveSize);

    // Copy header
    saveBytes.set(this.headerData[slotNumber], 0);

    // Copy data
    for (let i = 0; i < saveSlots.length; i++) {
      saveBytes.set(
        this.saveData[saveSlots[i]],
        HEADER_SIZE + i * BYTES_PER_SLOT,
      );
    }

    return saveBytes;
  }

  public setSaveBytes(slotNumber: number, saveBytes: Uint8Array): boolean {
    const requiredSlots = Math.ceil(
      (saveBytes.length - HEADER_SIZE) / BYTES_PER_SLOT,
    );
    if (requiredSlots < 1) {
      return false;
    }
    const freeSlots = this.findFreeSlots(slotNumber, requiredSlots);

    if (freeSlots.length < requiredSlots) {
      return false;
    }

    this.pushToUndoRedoBuffer(freeSlots, this.undoList, true);

    // Copy header to the first slot of the new save (matches the reference,
    // which places the header at freeSlots[0], not necessarily slotNumber).
    this.headerData[freeSlots[0]].set(saveBytes.slice(0, HEADER_SIZE));

    // Set save size in header
    const saveSize = saveBytes.length - HEADER_SIZE;
    this.headerData[freeSlots[0]][4] = saveSize & 0xff;
    this.headerData[freeSlots[0]][5] = (saveSize >> 8) & 0xff;
    this.headerData[freeSlots[0]][6] = (saveSize >> 16) & 0xff;

    // Copy data
    for (let i = 0; i < requiredSlots; i++) {
      const srcStart = HEADER_SIZE + i * BYTES_PER_SLOT;
      this.saveData[freeSlots[i]].set(
        saveBytes.slice(srcStart, srcStart + BYTES_PER_SLOT),
      );
    }

    // Set slot types and links
    for (let i = 0; i < requiredSlots; i++) {
      if (i === 0) {
        this.headerData[freeSlots[i]][0] = SlotTypes.Initial;
      } else if (i === requiredSlots - 1) {
        this.headerData[freeSlots[i]][0] = SlotTypes.EndLink;
      } else {
        this.headerData[freeSlots[i]][0] = SlotTypes.MiddleLink;
      }

      if (i < requiredSlots - 1) {
        this.headerData[freeSlots[i]][8] = freeSlots[i + 1];
        this.headerData[freeSlots[i]][9] = 0x00;
      } else {
        this.headerData[freeSlots[i]][8] = 0xff;
        this.headerData[freeSlots[i]][9] = 0xff;
      }
    }

    this.writeDataToRawCard();
    this.loadMemoryCardData();
    this.changedFlag = true;
    return true;
  }

  public replaceSaveBytes(slotNumber: number, saveBytes: Uint8Array): void {
    // Rewrite an existing save in place: reuse its current slot chain and copy
    // the new bytes over it. The payload is trusted (a plugin edit writes back
    // a same-size save), so — like the reference — the size is not validated.
    const saveSlots = this.findSaveLinks(slotNumber);
    this.pushToUndoRedoBuffer(saveSlots, this.undoList, true);

    // Header goes to the master slot; each linked slot gets its data block.
    this.headerData[saveSlots[0]].set(saveBytes.slice(0, HEADER_SIZE));
    for (let i = 0; i < saveSlots.length; i++) {
      this.saveData[saveSlots[i]].set(
        saveBytes.slice(
          HEADER_SIZE + i * BYTES_PER_SLOT,
          HEADER_SIZE + (i + 1) * BYTES_PER_SLOT,
        ),
      );
    }

    this.writeDataToRawCard();
    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  private findFreeSlots(startSlot: number, count: number): number[] {
    const freeSlots: number[] = [];
    // Scan `count`-worth of slots starting at startSlot, wrapping around the
    // end of the card back to slot 0 (matches the reference).
    for (let i = 0; i < SLOT_COUNT && freeSlots.length < count; i++) {
      const currentSlot = (i + startSlot) % SLOT_COUNT;
      if (this.slotTypes[currentSlot] === SlotTypes.Formatted) {
        freeSlots.push(currentSlot);
      }
    }
    return freeSlots;
  }

  public setHeaderData(
    slotNumber: number,
    productCode: string,
    identifier: string,
    region: string,
  ): void {
    this.pushToUndoRedoBuffer([slotNumber], this.undoList, true);
    productCode = productCode.padEnd(10, " ").slice(0, 10);
    identifier = identifier.padEnd(8, "\0").slice(0, 8);

    switch (region) {
      case "America":
        region = "BA";
        break;
      case "Europe":
        region = "BE";
        break;
      case "Japan":
        region = "BI";
        break;
      default:
        region = region.padEnd(2, " ").slice(0, 2);
    }

    const headerStart = 10;
    // Single-byte encode (like the reference's default codepage) so the fixed
    // field widths can't be overflowed by multi-byte characters.
    const toBytes = (s: string): Uint8Array =>
      Uint8Array.from(Array.from(s), (c) => c.charCodeAt(0) & 0xff);
    this.headerData[slotNumber].set(toBytes(region), headerStart);
    this.headerData[slotNumber].set(toBytes(productCode), headerStart + 2);
    this.headerData[slotNumber].set(toBytes(identifier), headerStart + 12);

    this.writeDataToRawCard();
    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  // Set the GME comment for a save. Like the reference, this only updates the
  // in-memory comment (materialized into the file on a GME save) and does not
  // mark the card as changed.
  public setComment(slotNumber: number, comment: string): void {
    this.pushToUndoRedoBuffer([slotNumber], this.undoList, true);
    this.saveComments[slotNumber] = comment;
    this.loadStringData();
  }

  public getIconBytes(slotNumber: number): Uint8Array {
    const iconBytes = new Uint8Array(416);
    iconBytes.set(this.saveData[slotNumber].slice(96, 512));
    return iconBytes;
  }

  public setIconBytes(slotNumber: number, iconBytes: Uint8Array): void {
    this.pushToUndoRedoBuffer(
      this.findSaveLinks(slotNumber),
      this.undoList,
      true,
    );
    this.saveData[slotNumber].set(iconBytes.slice(0, 416), 96);
    this.writeDataToRawCard();
    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  private getExtensionForType(cardType: CardTypes): string {
    return CardExtensions[cardType] || ".mcr";
  }

  public async saveMemoryCard(
    fileName: string,
    cardType: CardTypes,
    fixData: boolean,
  ): Promise<boolean> {
    this.loadDataToRawCard(fixData);

    let outputData: Uint8Array;

    switch (cardType) {
      case CardTypes.Gme:
        outputData = this.concatUint8Arrays(this.getGmeHeader(), this.rawData);
        break;
      case CardTypes.Vgs:
        outputData = this.concatUint8Arrays(this.getVgsHeader(), this.rawData);
        break;
      case CardTypes.Vmp:
        outputData = await this.makeVmpCard();
        break;
      case CardTypes.Mcx:
        outputData = await this.makeMcxCard();
        break;
      default:
        outputData = this.rawData;
    }

    try {
      const extension = this.getExtensionForType(cardType);
      const fileNameWithExt = hasFileExtension(fileName)
        ? fileName
        : withSingleExtension(fileName, extension);

      const blob = new Blob([new Uint8Array(outputData)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameWithExt;
      link.click();
      URL.revokeObjectURL(url);

      this.cardName = fileName;
      this.changedFlag = false;
      this.savedState = this.rawData.slice();
      return true;
    } catch (error) {
      console.error("Failed to save memory card:", error);
      return false;
    }
  }

  private concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a);
    result.set(b, a.length);
    return result;
  }

  private getGmeHeader(): Uint8Array {
    const header = new Uint8Array(3904);
    const headerText = new TextEncoder().encode("123-456-STD");
    header.set(headerText, 0);
    header[18] = 0x1;
    header[20] = 0x1;
    header[21] = 0x4d;

    for (let i = 0; i < SLOT_COUNT; i++) {
      header[22 + i] = this.headerData[i][0];
      header[38 + i] = this.headerData[i][8];
      if (this.saveComments[i]) {
        const commentBytes = Uint8Array.from(
          this.saveComments[i],
          (c) => c.charCodeAt(0) & 0xff,
        );
        header.set(commentBytes, 64 + 256 * i);
      }
    }

    return header;
  }

  private getVgsHeader(): Uint8Array {
    const header = new Uint8Array(64);
    const headerText = new TextEncoder().encode("VgsM");
    header.set(headerText, 0);
    header[4] = 0x1;
    header[8] = 0x1;
    header[12] = 0x1;
    header[17] = 0x2;
    return header;
  }

  private async makeVmpCard(): Promise<Uint8Array> {
    const vmpCard = new Uint8Array(0x20080);
    vmpCard[1] = 0x50; // 'P'
    vmpCard[2] = 0x4d; // 'M'
    vmpCard[3] = 0x56; // 'V'
    vmpCard[4] = 0x80; // header length

    vmpCard.set(this.rawData, 0x80);

    const saltSeed = await generateSaltSeed(vmpCard);
    vmpCard.set(saltSeed.subarray(0, 0x14), 0x0c);
    vmpCard.set(await getHmac(vmpCard, saltSeed, saveKey, saveIv), 0x20);
    return vmpCard;
  }

  private async makeMcxCard(): Promise<Uint8Array> {
    const mcxCard = new Uint8Array(0x200a0);
    mcxCard.set(this.rawData.subarray(0, 0x20000), 0x80);

    const hash = await crypto.subtle.digest(
      "SHA-256",
      mcxCard.subarray(0, 0x20080),
    );
    mcxCard.set(new Uint8Array(hash), 0x20080);

    mcxCard.set(await aesCbcEncrypt(mcxCard, mcxKey, mcxIv));
    return mcxCard;
  }

  public async saveSingleSave(
    fileName: string,
    slotNumber: number,
    saveType: SingleSaveTypes,
  ): Promise<boolean> {
    const saveData = this.getSaveBytes(slotNumber);
    let outputData: Uint8Array;

    switch (saveType) {
      case SingleSaveTypes.Mcs:
        outputData = saveData;
        break;
      case SingleSaveTypes.Raw:
        outputData = saveData.slice(HEADER_SIZE);
        break;
      case SingleSaveTypes.Psv:
        outputData = await this.makePsvSave(saveData);
        break;
      default: {
        // Action Replay
        outputData = this.makeArSave(saveData, slotNumber);
        break;
      }
    }

    try {
      const extension = SingleSaveExtensions[saveType] || ".mcs";
      const fileNameWithExt = withSingleExtension(fileName, extension);

      const blob = new Blob([new Uint8Array(outputData)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameWithExt;
      link.click();
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error("Failed to save single save:", error);
      return false;
    }
  }

  private async makePsvSave(save: Uint8Array): Promise<Uint8Array> {
    const psvSave = new Uint8Array(save.length + 4);
    psvSave[1] = 0x56; // 'V'
    psvSave[2] = 0x53; // 'S'
    psvSave[3] = 0x50; // 'P'
    psvSave[0x38] = 0x14;
    psvSave[0x3c] = 1;
    psvSave[0x44] = 0x84;
    psvSave[0x49] = 2;
    psvSave[0x60] = 3;
    psvSave[0x61] = 0x90;

    psvSave.set(save.subarray(0x0a, 0x2a), 0x64);
    new DataView(psvSave.buffer).setUint32(0x40, save.length - 0x80, true);
    new DataView(psvSave.buffer).setUint32(0x5c, save.length - 0x80, true);
    psvSave.set(save.subarray(0x80), 0x84);

    const saltSeed = await generateSaltSeed(psvSave);
    psvSave.set(saltSeed.subarray(0, 0x14), 0x08);
    psvSave.set(await getHmac(psvSave, saltSeed, saveKey, saveIv), 0x1c);
    return psvSave;
  }

  private makeArSave(saveData: Uint8Array, slotNumber: number): Uint8Array {
    // Action Replay single save: a 54-byte header (region / product code /
    // identifier in the first 22 bytes, then the save name) followed by the raw
    // data block(s).
    const arHeader = new Uint8Array(54);
    // Region + product code + identifier (header bytes 10..31) lead the header.
    arHeader.set(this.headerData[slotNumber].slice(10, 32), 0);
    // The name follows, truncated to the 33 free bytes (21..53) so an
    // over-long name cannot overrun the header.
    const nameBytes = Uint8Array.from(
      this.saves[slotNumber].name,
      (c) => c.charCodeAt(0) & 0xff,
    ).slice(0, 33);
    arHeader.set(nameBytes, 21);
    return this.concatUint8Arrays(arHeader, saveData.slice(HEADER_SIZE));
  }

  public async openSingleSave(
    file: File,
    slotNumber: number,
  ): Promise<boolean> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const inputData = new Uint8Array(arrayBuffer);
      let saveData: Uint8Array;

      // Match the reference: read the 2-byte type tag and strip null padding.
      // MCS is "Q\0" -> "Q", PSV is "\0V" -> "V", RAW is "SC"/"sc".
      const saveType = this.arrayToString(inputData.slice(0, 2)).replace(
        /\0/g,
        "",
      );

      if (saveType === "Q") {
        // MCS save
        saveData = inputData;
      } else if (saveType === "SC" || saveType === "sc") {
        // Raw save
        const header = new Uint8Array(HEADER_SIZE);
        header[0] = SlotTypes.Initial;
        // Write the filename into the header (product code/identifier area,
        // bytes 10-29), matching the reference.
        const nameBytes = new TextEncoder().encode(file.name);
        header.set(nameBytes.slice(0, 20), 10);
        saveData = this.concatUint8Arrays(header, inputData);
      } else if (saveType === "V") {
        // PSV save
        if (inputData[60] !== 1) {
          throw new Error("Not a valid PS1 PSV save");
        }
        const header = new Uint8Array(HEADER_SIZE);
        header[0] = SlotTypes.Initial;
        header.set(inputData.slice(100, 120), 10);
        saveData = this.concatUint8Arrays(header, inputData.slice(132));
      } else {
        // Action Replay save
        if (inputData[0x36] !== 0x53 || inputData[0x37] !== 0x43) {
          throw new Error("Not a valid Action Replay save");
        }
        const header = new Uint8Array(HEADER_SIZE);
        header[0] = SlotTypes.Initial;
        header.set(inputData.slice(0, 20), 10);
        saveData = this.concatUint8Arrays(header, inputData.slice(54));
      }

      return this.setSaveBytes(slotNumber, saveData);
    } catch (error) {
      console.error("Failed to open single save:", error);
      return false;
    }
  }

  public getIconData(slotNumber: number): SlotIconData {
    if (this.iconData[slotNumber]) {
      return this.iconData[slotNumber];
    }
    // // Return a blank icon if no data is available
    return new Array<IconData>(3).fill(
      new Array<number>(ICON_SIZE * ICON_SIZE).fill(0),
    );
  }

  // Palette-resolved icon colors for direct drawing (frame -> pixel -> RGBA).
  // A linked slot returns the master's resolved colors.
  public getIconColorData(slotNumber: number): SlotIconColors {
    return this.iconColorData[slotNumber] ?? [];
  }

  public getIconPalette(slotNumber: number): IconPalette {
    if (this.iconPalette[slotNumber]) {
      return this.iconPalette[slotNumber].map(([r, g, b, a]) =>
        (r | g | b | a) === 0 ? [0, 0, 0, 0] : [r, g, b, 255],
      );
    }
    return new Array<RGBAColor>(16).fill([0, 0, 0, 0]); // Return a blank palette if no data is available
  }

  // The kind of data a slot holds (regular save vs. PocketStation software).
  public getSaveDataType(slotNumber: number): DataTypes {
    return this.saveDataTypes[slotNumber];
  }

  // Extract a slot's monochromatic PocketStation icon. Returns the frames plus
  // the APIcon refresh delay, or null when the slot isn't an
  // initial/deleted PocketStation slot or the requested type has no frames.
  public getPocketStationIcon(
    slotNumber: number,
    iconType: IconTypes,
  ): { data: Uint8Array; delay: number } | null {
    const isInitial =
      this.slotTypes[slotNumber] === SlotTypes.Initial ||
      this.slotTypes[slotNumber] === SlotTypes.DeletedInitial;
    if (!isInitial) return null;

    const data = this.saveData[slotNumber];
    const mcIconFrames = data[0x50];
    const apIconEntries = data[0x56];
    const savedSnapOffset = data[0x55] === 0x31 ? 0x800 : 0;
    const funcTableOffset = (data[0x57] * 8 + 0x7f) & ~0x7f;
    const iconFrames = this.getIconFrameCount(slotNumber);

    if (iconType === IconTypes.MCIcon) {
      if (mcIconFrames < 1) return null;
      const iconData = new Uint8Array(mcIconFrames * 0x80);
      for (let i = 0; i < 0x80 * mcIconFrames; i++) {
        iconData[i] =
          data[
            0x80 + 0x80 * iconFrames + i + funcTableOffset + savedSnapOffset
          ];
      }
      return { data: iconData, delay: 0 };
    }

    if (iconType === IconTypes.APIcon) {
      if (apIconEntries < 1) return null;
      const entryOffset =
        0x80 +
        0x80 * iconFrames +
        mcIconFrames * 0x80 +
        funcTableOffset +
        savedSnapOffset;
      const apIconFrames = data[entryOffset];
      const delay = data[entryOffset + 2];
      const iconOffset =
        data[entryOffset + 4] |
        (data[entryOffset + 5] << 8) |
        (data[entryOffset + 6] << 16);
      const iconData = new Uint8Array(apIconFrames * 0x80);
      const apData = this.getSaveBytes(slotNumber);
      for (let i = 0; i < iconData.length; i++) {
        iconData[i] = apData[iconOffset + HEADER_SIZE + i];
      }
      return { data: iconData, delay };
    }

    return null;
  }
}

export default PS1MemoryCard;
