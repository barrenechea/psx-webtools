// Constants
const SLOT_COUNT = 15;
const BYTES_PER_SLOT = 8192;
const HEADER_SIZE = 128;
const ICON_SIZE = 16;
const TOTAL_CARD_SIZE = SLOT_COUNT * BYTES_PER_SLOT;

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

type RGBAColor = [number, number, number, number];
type IconPalette = RGBAColor[];
type IconData = number[]; // Single icon data is a 1D array of numbers
type SlotIconData = IconData[]; // Icons for a single slot (up to 3 icons)

class PS1MemoryCard {
  private rawData: Uint8Array;
  private cardType: CardTypes = CardTypes.Raw;
  private saves: SaveInfo[] = [];
  private slotTypes: SlotTypes[] = new Array<SlotTypes>(SLOT_COUNT).fill(
    SlotTypes.Formatted
  );
  private iconPalette: IconPalette[] = [];
  private iconData: SlotIconData[] = [];
  private cardName: string | null = null;
  private cardLocation: string | null = null;
  private changedFlag = false;

  constructor() {
    this.rawData = new Uint8Array(TOTAL_CARD_SIZE);
    this.initializeIconData();
  }

  private initializeIconData(): void {
    this.iconPalette = Array.from({ length: SLOT_COUNT }, () =>
      Array.from({ length: 16 }, (): RGBAColor => [0, 0, 0, 0])
    );

    this.iconData = Array.from({ length: SLOT_COUNT }, () =>
      Array.from({ length: 3 }, () =>
        Array.from({ length: ICON_SIZE * ICON_SIZE }, () => 0)
      )
    );
  }

  async loadFromFile(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(arrayBuffer);

    // Determine card type and extract raw data
    if (this.isGmeFormat(fileData)) {
      this.cardType = CardTypes.Gme;
      this.rawData = fileData.slice(3904, 3904 + TOTAL_CARD_SIZE);
      this.loadGMEComments(fileData);
    } else if (this.isVgsFormat(fileData)) {
      this.cardType = CardTypes.Vgs;
      this.rawData = fileData.slice(64, 64 + TOTAL_CARD_SIZE);
    } else if (this.isVmpFormat(fileData)) {
      this.cardType = CardTypes.Vmp;
      this.rawData = fileData.slice(128, 128 + TOTAL_CARD_SIZE);
    } else if (this.isMcxFormat(fileData)) {
      this.cardType = CardTypes.Mcx;
      this.rawData = this.decryptMcxCard(fileData);
    } else {
      this.cardType = CardTypes.Raw;
      this.rawData = fileData.slice(0, TOTAL_CARD_SIZE);
    }

    this.cardName = file.name;
    this.cardLocation = URL.createObjectURL(file);
    this.loadMemoryCardData();
  }

  private isGmeFormat(data: Uint8Array): boolean {
    return this.arrayToString(data.slice(0, 11)) === "123-456-STD";
  }

  private isVgsFormat(data: Uint8Array): boolean {
    return this.arrayToString(data.slice(0, 4)) === "VgsM";
  }

  private isVmpFormat(data: Uint8Array): boolean {
    return this.arrayToString(data.slice(0, 3)) === "PMV";
  }

  private isMcxFormat(data: Uint8Array): boolean {
    const decrypted = this.decryptMcxCard(data);
    return this.arrayToString(decrypted.slice(0x80, 0x82)) === "MC";
  }

  private decryptMcxCard(data: Uint8Array): Uint8Array {
    // Implement MCX decryption here
    // This is a placeholder and should be replaced with actual decryption logic
    return data.slice(0, TOTAL_CARD_SIZE);
  }

  private loadGMEComments(data: Uint8Array): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const comment = this.arrayToString(
        data.slice(64 + 256 * i, 64 + 256 * (i + 1))
      ).replace(/\0/g, "");
      if (this.saves[i]) {
        this.saves[i].comment = comment;
      }
    }
  }

  private arrayToString(array: Uint8Array): string {
    return String.fromCharCode.apply(null, Array.from(array));
  }

  private loadMemoryCardData(): void {
    this.loadSlotTypes();
    this.findBrokenLinks();
    this.loadStringData();
    this.loadSaveSize();
    this.loadPalette();
    this.loadIcons();
    this.loadIconFrames();
    this.calculateXOR();
  }

  private loadSlotTypes(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const headerStart = i * BYTES_PER_SLOT;
      this.slotTypes[i] = this.rawData[headerStart] as SlotTypes;
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
    const links = [initialSlot];
    let currentSlot = initialSlot;

    for (let i = 0; i < SLOT_COUNT; i++) {
      const headerStart = currentSlot * BYTES_PER_SLOT;
      const nextSlot = this.rawData[headerStart + 8];

      if (nextSlot === 0xff || nextSlot >= SLOT_COUNT) break;

      const nextSlotType = this.slotTypes[nextSlot];
      if (
        nextSlotType !== SlotTypes.MiddleLink &&
        nextSlotType !== SlotTypes.EndLink &&
        nextSlotType !== SlotTypes.DeletedMiddleLink &&
        nextSlotType !== SlotTypes.DeletedEndLink
      )
        break;

      links.push(nextSlot);
      currentSlot = nextSlot;
    }

    return links;
  }

  private loadStringData(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const headerStart = i * BYTES_PER_SLOT;
      const dataStart = headerStart + HEADER_SIZE;

      const region = this.getRegion(headerStart);
      const productCode = this.getProductCode(headerStart);
      const identifier = this.getIdentifier(headerStart);
      const name = this.getSaveName(dataStart);
      const blockCount = this.getSaveSize(headerStart);
      const iconFrameCount = this.getIconFrameCount(dataStart);

      this.saves[i] = {
        slotNumber: i,
        name,
        productCode,
        identifier,
        region,
        regionRaw: this.getRegionRaw(headerStart),
        blockCount,
        iconFrameCount,
        slotType: this.slotTypes[i],
        comment: "",
      };
    }
  }

  private getRegion(headerStart: number): string {
    const regionCode = this.arrayToString(
      this.rawData.slice(headerStart + 10, headerStart + 12)
    );
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

  private getRegionRaw(headerStart: number): string {
    return this.arrayToString(
      this.rawData.slice(headerStart + 10, headerStart + 12)
    );
  }

  private getProductCode(headerStart: number): string {
    return this.arrayToString(
      this.rawData.slice(headerStart + 12, headerStart + 22)
    ).replace(/\0/g, "");
  }

  private getIdentifier(headerStart: number): string {
    return this.arrayToString(
      this.rawData.slice(headerStart + 22, headerStart + 30)
    ).replace(/\0/g, "");
  }

  private getSaveName(dataStart: number): string {
    const nameBytes = this.rawData.slice(dataStart + 4, dataStart + 68);
    const nullTerminator = nameBytes.indexOf(0);
    return this.decodeUTF16LE(
      nameBytes.slice(0, nullTerminator !== -1 ? nullTerminator : undefined)
    );
  }

  private decodeUTF16LE(bytes: Uint8Array): string {
    const decoder = new TextDecoder("utf-16le");
    return decoder.decode(bytes);
  }

  private getSaveSize(headerStart: number): number {
    return (
      (this.rawData[headerStart + 4] |
        (this.rawData[headerStart + 5] << 8) |
        (this.rawData[headerStart + 6] << 16)) /
      1024
    );
  }

  private getIconFrameCount(dataStart: number): number {
    switch (this.rawData[dataStart + 2]) {
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
      const headerStart = i * BYTES_PER_SLOT;
      this.saves[i].blockCount = this.getSaveSize(headerStart);
    }
  }

  private loadPalette(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      const paletteStart = slotNumber * BYTES_PER_SLOT + HEADER_SIZE + 96;
      for (let colorIndex = 0; colorIndex < 16; colorIndex++) {
        const colorValue =
          this.rawData[paletteStart + colorIndex * 2] |
          (this.rawData[paletteStart + colorIndex * 2 + 1] << 8);
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
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      if (
        this.slotTypes[slotNumber] === SlotTypes.Initial ||
        this.slotTypes[slotNumber] === SlotTypes.DeletedInitial
      ) {
        const iconDataStart = slotNumber * BYTES_PER_SLOT + HEADER_SIZE + 128;
        for (let iconNumber = 0; iconNumber < 3; iconNumber++) {
          const iconStart = iconDataStart + iconNumber * 128;
          for (let y = 0; y < ICON_SIZE; y++) {
            for (let x = 0; x < ICON_SIZE / 2; x++) {
              const pixelData = this.rawData[iconStart + y * 8 + x];
              this.iconData[slotNumber][iconNumber][y * ICON_SIZE + x * 2] =
                pixelData & 0xf;
              this.iconData[slotNumber][iconNumber][y * ICON_SIZE + x * 2 + 1] =
                pixelData >> 4;
            }
          }
        }
      }
    }
  }

  private loadIconFrames(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const dataStart = i * BYTES_PER_SLOT + HEADER_SIZE;
      this.saves[i].iconFrameCount = this.getIconFrameCount(dataStart);
    }
  }

  private calculateXOR(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      const headerStart = slotNumber * BYTES_PER_SLOT;
      let xorChecksum = 0;
      for (let i = 0; i < 127; i++) {
        xorChecksum ^= this.rawData[headerStart + i];
      }
      this.rawData[headerStart + 127] = xorChecksum;
    }
  }

  public getSaves(): SaveInfo[] {
    return this.saves.filter(
      (save) =>
        save.slotType === SlotTypes.Initial ||
        save.slotType === SlotTypes.DeletedInitial ||
        save.slotType === SlotTypes.Formatted
    );
  }

  public toggleDeleteSave(slotNumber: number): void {
    const saveSlots = this.findSaveLinks(slotNumber);

    for (const slot of saveSlots) {
      switch (this.slotTypes[slot]) {
        case SlotTypes.Initial:
          this.rawData[slot * BYTES_PER_SLOT] = SlotTypes.DeletedInitial;
          break;
        case SlotTypes.MiddleLink:
          this.rawData[slot * BYTES_PER_SLOT] = SlotTypes.DeletedMiddleLink;
          break;
        case SlotTypes.EndLink:
          this.rawData[slot * BYTES_PER_SLOT] = SlotTypes.DeletedEndLink;
          break;
        case SlotTypes.DeletedInitial:
          this.rawData[slot * BYTES_PER_SLOT] = SlotTypes.Initial;
          break;
        case SlotTypes.DeletedMiddleLink:
          this.rawData[slot * BYTES_PER_SLOT] = SlotTypes.MiddleLink;
          break;
        case SlotTypes.DeletedEndLink:
          this.rawData[slot * BYTES_PER_SLOT] = SlotTypes.EndLink;
          break;
      }
    }

    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  public formatSave(slotNumber: number): void {
    const saveSlots = this.findSaveLinks(slotNumber);

    for (const slot of saveSlots) {
      this.formatSlot(slot);
    }

    this.loadMemoryCardData();
    this.changedFlag = true;
  }

  private formatSlot(slotNumber: number): void {
    const slotStart = slotNumber * BYTES_PER_SLOT;
    this.rawData.fill(0, slotStart, slotStart + BYTES_PER_SLOT);
    this.rawData[slotStart] = SlotTypes.Formatted;
    this.rawData[slotStart + 8] = 0xff;
    this.rawData[slotStart + 9] = 0xff;
  }

  public getSaveBytes(slotNumber: number): Uint8Array {
    const saveSlots = this.findSaveLinks(slotNumber);
    const saveSize = HEADER_SIZE + saveSlots.length * BYTES_PER_SLOT;
    const saveBytes = new Uint8Array(saveSize);

    // Copy header
    saveBytes.set(
      this.rawData.slice(
        slotNumber * BYTES_PER_SLOT,
        slotNumber * BYTES_PER_SLOT + HEADER_SIZE
      ),
      0
    );

    // Copy data
    for (let i = 0; i < saveSlots.length; i++) {
      const dataStart = saveSlots[i] * BYTES_PER_SLOT + HEADER_SIZE;
      saveBytes.set(
        this.rawData.slice(dataStart, dataStart + BYTES_PER_SLOT),
        HEADER_SIZE + i * BYTES_PER_SLOT
      );
    }

    return saveBytes;
  }

  public setSaveBytes(slotNumber: number, saveBytes: Uint8Array): boolean {
    const requiredSlots = Math.ceil(
      (saveBytes.length - HEADER_SIZE) / BYTES_PER_SLOT
    );
    const freeSlots = this.findFreeSlots(slotNumber, requiredSlots);

    if (freeSlots.length < requiredSlots) {
      return false;
    }

    // Copy header
    this.rawData.set(
      saveBytes.slice(0, HEADER_SIZE),
      slotNumber * BYTES_PER_SLOT
    );

    // Set save size in header
    const saveSize = saveBytes.length - HEADER_SIZE;
    this.rawData[slotNumber * BYTES_PER_SLOT + 4] = saveSize & 0xff;
    this.rawData[slotNumber * BYTES_PER_SLOT + 5] = (saveSize >> 8) & 0xff;
    this.rawData[slotNumber * BYTES_PER_SLOT + 6] = (saveSize >> 16) & 0xff;

    // Copy data
    for (let i = 0; i < requiredSlots; i++) {
      const srcStart = HEADER_SIZE + i * BYTES_PER_SLOT;
      const dstStart = freeSlots[i] * BYTES_PER_SLOT + HEADER_SIZE;
      this.rawData.set(
        saveBytes.slice(srcStart, srcStart + BYTES_PER_SLOT),
        dstStart
      );
    }

    // Set slot types and links
    for (let i = 0; i < requiredSlots; i++) {
      const slotStart = freeSlots[i] * BYTES_PER_SLOT;
      if (i === 0) {
        this.rawData[slotStart] = SlotTypes.Initial;
      } else if (i === requiredSlots - 1) {
        this.rawData[slotStart] = SlotTypes.EndLink;
      } else {
        this.rawData[slotStart] = SlotTypes.MiddleLink;
      }

      if (i < requiredSlots - 1) {
        this.rawData[slotStart + 8] = freeSlots[i + 1];
        this.rawData[slotStart + 9] = 0x00;
      } else {
        this.rawData[slotStart + 8] = 0xff;
        this.rawData[slotStart + 9] = 0xff;
      }
    }

    this.loadMemoryCardData();
    this.changedFlag = true;
    return true;
  }

  private findFreeSlots(startSlot: number, count: number): number[] {
    const freeSlots: number[] = [];
    for (let i = startSlot; i < SLOT_COUNT && freeSlots.length < count; i++) {
      if (this.slotTypes[i] === SlotTypes.Formatted) {
        freeSlots.push(i);
      }
    }
    return freeSlots;
  }

  public setHeaderData(
    slotNumber: number,
    productCode: string,
    identifier: string,
    region: string
  ): void {
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

    const headerStart = slotNumber * BYTES_PER_SLOT + 10;
    this.rawData.set(new TextEncoder().encode(region), headerStart);
    this.rawData.set(new TextEncoder().encode(productCode), headerStart + 2);
    this.rawData.set(new TextEncoder().encode(identifier), headerStart + 12);

    this.loadStringData();
    this.calculateXOR();
    this.changedFlag = true;
  }

  public getIconBytes(slotNumber: number): Uint8Array {
    const iconBytes = new Uint8Array(416);
    const srcStart = slotNumber * BYTES_PER_SLOT + HEADER_SIZE + 96;
    iconBytes.set(this.rawData.slice(srcStart, srcStart + 416));
    return iconBytes;
  }

  public setIconBytes(slotNumber: number, iconBytes: Uint8Array): void {
    const dstStart = slotNumber * BYTES_PER_SLOT + HEADER_SIZE + 96;
    this.rawData.set(iconBytes.slice(0, 416), dstStart);
    this.loadPalette();
    this.loadIcons();
    this.changedFlag = true;
  }

  public saveMemoryCard(fileName: string, cardType: CardTypes): boolean {
    let outputData: Uint8Array;

    switch (cardType) {
      case CardTypes.Gme:
        outputData = this.concatUint8Arrays(this.getGmeHeader(), this.rawData);
        break;
      case CardTypes.Vgs:
        outputData = this.concatUint8Arrays(this.getVgsHeader(), this.rawData);
        break;
      case CardTypes.Vmp:
        outputData = this.makeVmpCard();
        break;
      case CardTypes.Mcx:
        outputData = this.makeMcxCard();
        break;
      default:
        outputData = this.rawData;
    }

    try {
      const blob = new Blob([outputData], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);

      this.cardName = fileName;
      this.changedFlag = false;
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
      header[22 + i] = this.rawData[i * BYTES_PER_SLOT];
      header[38 + i] = this.rawData[i * BYTES_PER_SLOT + 8];
      if (this.saves[i]?.comment) {
        const commentBytes = new TextEncoder().encode(this.saves[i].comment);
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

  private makeVmpCard(): Uint8Array {
    // Implement VMP card creation logic
    // This is a placeholder and should be replaced with actual VMP card creation
    return this.rawData;
  }

  private makeMcxCard(): Uint8Array {
    // Implement MCX card creation logic
    // This is a placeholder and should be replaced with actual MCX card creation
    return this.rawData;
  }

  public saveSingleSave(
    fileName: string,
    slotNumber: number,
    saveType: SingleSaveTypes
  ): boolean {
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
        outputData = this.makePsvSave(saveData);
        break;
      default: {
        // Action Replay
        const arHeader = new Uint8Array(54);
        const productCodeBytes = new TextEncoder().encode(
          this.saves[slotNumber].productCode
        );
        const identifierBytes = new TextEncoder().encode(
          this.saves[slotNumber].identifier
        );
        const nameBytes = new TextEncoder().encode(this.saves[slotNumber].name);
        arHeader.set(productCodeBytes, 0);
        arHeader.set(identifierBytes, 10);
        arHeader.set(nameBytes, 21);
        outputData = this.concatUint8Arrays(
          arHeader,
          saveData.slice(HEADER_SIZE)
        );
        break;
      }
    }

    try {
      const blob = new Blob([outputData], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      return true;
    } catch (error) {
      console.error("Failed to save single save:", error);
      return false;
    }
  }

  private makePsvSave(saveData: Uint8Array): Uint8Array {
    // Implement PSV save creation logic
    // This is a placeholder and should be replaced with actual PSV save creation
    const psvHeader = new TextEncoder().encode("PSV");
    return this.concatUint8Arrays(psvHeader, saveData);
  }

  public async openSingleSave(
    file: File,
    slotNumber: number
  ): Promise<boolean> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const inputData = new Uint8Array(arrayBuffer);
      let saveData: Uint8Array;

      if (this.arrayToString(inputData.slice(0, 2)) === "Q") {
        // MCS save
        saveData = inputData;
      } else if (
        this.arrayToString(inputData.slice(0, 2)).toLowerCase() === "sc"
      ) {
        // Raw save
        const header = new Uint8Array(HEADER_SIZE);
        header[0] = SlotTypes.Initial;
        saveData = this.concatUint8Arrays(header, inputData);
      } else if (this.arrayToString(inputData.slice(0, 1)) === "V") {
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

      const success = this.setSaveBytes(slotNumber, saveData);
      return success;
    } catch (error) {
      console.error("Failed to open single save:", error);
      return false;
    }
  }
}

export default PS1MemoryCard;
