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

  // New properties to match C# implementation
  private headerData: Uint8Array[] = Array.from(
    { length: SLOT_COUNT },
    () => new Uint8Array(HEADER_SIZE)
  );
  private saveData: Uint8Array[] = Array.from(
    { length: SLOT_COUNT },
    () => new Uint8Array(BYTES_PER_SLOT)
  );

  private saveComments: string[] = new Array<string>(SLOT_COUNT).fill("");
  private masterSlot: number[] = new Array<number>(SLOT_COUNT).fill(0);

  private readonly saveKey = new Uint8Array([
    0xab, 0x5a, 0xbc, 0x9f, 0xc1, 0xf4, 0x9d, 0xe6, 0xa0, 0x51, 0xdb, 0xae,
    0xfa, 0x51, 0x88, 0x59,
  ]);
  private readonly saveIv = new Uint8Array([
    0xb3, 0x0f, 0xfe, 0xed, 0xb7, 0xdc, 0x5e, 0xb7, 0x13, 0x3d, 0xa6, 0x0d,
    0x1b, 0x6b, 0x2c, 0xdc,
  ]);

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
      this.saveComments[i] = comment;
    }
  }

  private arrayToString(array: Uint8Array): string {
    return String.fromCharCode.apply(null, Array.from(array));
  }

  private loadMemoryCardData(): void {
    this.loadDataFromRawCard();
    this.loadSlotTypes();
    this.findBrokenLinks();
    this.loadStringData();
    this.loadSaveSize();
    this.loadPalette();
    this.loadIcons();
    this.loadIconFrames();
    this.calculateXOR();
  }

  private loadDataFromRawCard(): void {
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      // Load header data
      this.headerData[slotNumber].set(
        this.rawData.slice(128 + slotNumber * 128, 256 + slotNumber * 128)
      );

      // Load save data
      this.saveData[slotNumber].set(
        this.rawData.slice(8192 + slotNumber * 8192, 16384 + slotNumber * 8192)
      );
    }
  }

  private loadSlotTypes(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.slotTypes[i] = this.headerData[i][0] as SlotTypes;
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

      links.push(nextSlot);
      currentSlot = nextSlot;
    }

    return links;
  }

  private loadStringData(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const region = this.getRegion(i);
      const productCode = this.getProductCode(i);
      const identifier = this.getIdentifier(i);
      const name = this.getSaveName(i);
      const blockCount = this.getSaveSize(i);
      const iconFrameCount = this.getIconFrameCount(i);

      this.saves[i] = {
        slotNumber: i,
        name,
        productCode,
        identifier,
        region,
        regionRaw: this.getRegionRaw(i),
        blockCount,
        iconFrameCount,
        slotType: this.slotTypes[i],
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
      this.headerData[slotNumber].slice(12, 22)
    ).replace(/\0/g, "");
  }

  private getIdentifier(slotNumber: number): string {
    return this.arrayToString(
      this.headerData[slotNumber].slice(22, 30)
    ).replace(/\0/g, "");
  }

  private getSaveName(slotNumber: number): string {
    const nameBytes = this.saveData[slotNumber].slice(4, 68);
    let nullTerminator = nameBytes.findIndex(
      (byte, index) =>
        index % 2 === 0 && byte === 0 && nameBytes[index + 1] === 0
    );
    if (nullTerminator === -1) nullTerminator = 64;

    // First, try Shift-JIS decoding
    try {
      const shiftJisDecoder = new TextDecoder("shift-jis");
      const decodedName = shiftJisDecoder.decode(
        nameBytes.slice(0, nullTerminator)
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
    return (
      (this.headerData[slotNumber][4] |
        (this.headerData[slotNumber][5] << 8) |
        (this.headerData[slotNumber][6] << 16)) /
      1024
    );
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
    for (let slotNumber = 0; slotNumber < SLOT_COUNT; slotNumber++) {
      if (
        this.slotTypes[slotNumber] === SlotTypes.Initial ||
        this.slotTypes[slotNumber] === SlotTypes.DeletedInitial
      ) {
        const iconDataStart = 128;
        for (let iconNumber = 0; iconNumber < 3; iconNumber++) {
          const iconStart = iconDataStart + iconNumber * 128;
          for (let y = 0; y < ICON_SIZE; y++) {
            for (let x = 0; x < ICON_SIZE / 2; x++) {
              const pixelData =
                this.saveData[slotNumber][iconStart + y * 8 + x];
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
    this.headerData[slotNumber].fill(0);
    this.saveData[slotNumber].fill(0);
    this.headerData[slotNumber][0] = SlotTypes.Formatted;
    this.headerData[slotNumber][8] = 0xff;
    this.headerData[slotNumber][9] = 0xff;
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
    this.headerData[slotNumber].set(saveBytes.slice(0, HEADER_SIZE));

    // Set save size in header
    const saveSize = saveBytes.length - HEADER_SIZE;
    this.headerData[slotNumber][4] = saveSize & 0xff;
    this.headerData[slotNumber][5] = (saveSize >> 8) & 0xff;
    this.headerData[slotNumber][6] = (saveSize >> 16) & 0xff;

    // Copy data
    for (let i = 0; i < requiredSlots; i++) {
      const srcStart = HEADER_SIZE + i * BYTES_PER_SLOT;
      this.saveData[freeSlots[i]].set(
        saveBytes.slice(srcStart, srcStart + BYTES_PER_SLOT)
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

    const headerStart = 10;
    const encoder = new TextEncoder();
    this.headerData[slotNumber].set(encoder.encode(region), headerStart);
    this.headerData[slotNumber].set(
      encoder.encode(productCode),
      headerStart + 2
    );
    this.headerData[slotNumber].set(
      encoder.encode(identifier),
      headerStart + 12
    );

    this.loadStringData();
    this.calculateXOR();
    this.changedFlag = true;
  }

  public getIconBytes(slotNumber: number): Uint8Array {
    const iconBytes = new Uint8Array(416);
    iconBytes.set(this.saveData[slotNumber].slice(96, 512));
    return iconBytes;
  }

  public setIconBytes(slotNumber: number, iconBytes: Uint8Array): void {
    this.saveData[slotNumber].set(iconBytes.slice(0, 416), 96);
    this.loadPalette();
    this.loadIcons();
    this.changedFlag = true;
  }

  public async saveMemoryCard(
    fileName: string,
    cardType: CardTypes
  ): Promise<boolean> {
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
      header[22 + i] = this.headerData[i][0];
      header[38 + i] = this.headerData[i][8];
      if (this.saveComments[i]) {
        const commentBytes = new TextEncoder().encode(this.saveComments[i]);
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

  private async createAesKey(key: Uint8Array): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-CBC" },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private async aesEcbProcessBlock(
    block: Uint8Array,
    key: CryptoKey,
    encrypt: boolean
  ): Promise<Uint8Array> {
    const iv = new Uint8Array(16); // Zero IV for ECB
    const result = await crypto.subtle[encrypt ? "encrypt" : "decrypt"](
      { name: "AES-CBC", iv },
      key,
      block
    );
    return new Uint8Array(result).slice(0, 16);
  }

  private async aesEcbProcess(
    data: Uint8Array,
    key: Uint8Array,
    encrypt: boolean
  ): Promise<Uint8Array> {
    const cryptoKey = await this.createAesKey(key);
    const blockSize = 16;
    const result = new Uint8Array(data.length);

    for (let i = 0; i < data.length; i += blockSize) {
      const block = data.slice(i, i + blockSize);
      const processedBlock = await this.aesEcbProcessBlock(
        block,
        cryptoKey,
        encrypt
      );
      result.set(processedBlock, i);
    }

    return result;
  }

  private async aesEcbEncrypt(
    toEncrypt: Uint8Array,
    key: Uint8Array
  ): Promise<Uint8Array> {
    return this.aesEcbProcess(toEncrypt, key, true);
  }

  private async aesEcbDecrypt(
    toDecrypt: Uint8Array,
    key: Uint8Array
  ): Promise<Uint8Array> {
    return this.aesEcbProcess(toDecrypt, key, false);
  }

  private xorWithIv(destBuffer: Uint8Array, iv: Uint8Array): void {
    for (let i = 0; i < 16; i++) {
      destBuffer[i] ^= iv[i];
    }
  }

  private async makeVmpCard(): Promise<Uint8Array> {
    const vmpCard = new Uint8Array(0x20080);
    vmpCard[1] = 0x50; // 'P'
    vmpCard[2] = 0x4d; // 'M'
    vmpCard[3] = 0x56; // 'V'
    vmpCard[4] = 0x80; // header length

    vmpCard.set(this.rawData, 0x80);

    const saltSeed = new Uint8Array(
      await crypto.subtle.digest("SHA-1", vmpCard)
    );
    vmpCard.set(saltSeed.subarray(0, 0x14), 0x0c);
    vmpCard.set(await this.getHmac(vmpCard, saltSeed), 0x20);
    return vmpCard;
  }

  private async getHmac(
    data: Uint8Array,
    saltSeed: Uint8Array
  ): Promise<Uint8Array> {
    const buffer = new Uint8Array(0x14);
    const salt = new Uint8Array(0x40);
    const temp = new Uint8Array(0x14);
    const hash1 = new Uint8Array(data.length + 0x40);
    const hash2 = new Uint8Array(0x54);

    buffer.set(saltSeed.subarray(0, 0x14));
    buffer.set(
      await this.aesEcbDecrypt(buffer.subarray(0, 0x10), this.saveKey)
    );
    salt.set(buffer.subarray(0, 0x10));
    buffer.set(saltSeed.subarray(0, 0x10));
    buffer.set(
      await this.aesEcbEncrypt(buffer.subarray(0, 0x14), this.saveKey)
    );

    salt.set(buffer.subarray(0, 0x10), 0x10);
    this.xorWithIv(salt, this.saveIv);
    buffer.fill(0xff, 0x14);
    buffer.set(saltSeed.subarray(0x10, 0x14), 0);
    temp.set(salt.subarray(0x10, 0x24));
    this.xorWithIv(temp, buffer);
    salt.set(temp.subarray(0, 0x10), 0x10);
    temp.set(salt.subarray(0, 0x14));
    salt.fill(0, 0x14);
    salt.set(temp.subarray(0, 0x14));

    for (let i = 0; i < salt.length; i++) {
      salt[i] ^= 0x36;
    }

    hash1.set(salt.subarray(0, 0x40));
    hash1.set(data, 0x40);
    const sha1Hash1 = await crypto.subtle.digest("SHA-1", hash1);
    buffer.set(new Uint8Array(sha1Hash1));

    for (let i = 0; i < salt.length; i++) {
      salt[i] ^= 0x6a;
    }

    hash2.set(salt.subarray(0, 0x40));
    hash2.set(buffer.subarray(0, 0x14), 0x40);
    const sha1Hash2 = await crypto.subtle.digest("SHA-1", hash2);
    return new Uint8Array(sha1Hash2);
  }

  private makeMcxCard(): Uint8Array {
    // Implement MCX card creation logic
    // This is a placeholder and should be replaced with actual MCX card creation
    return this.rawData;
  }

  public async saveSingleSave(
    fileName: string,
    slotNumber: number,
    saveType: SingleSaveTypes
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
        const arHeader = new Uint8Array(54);
        const encoder = new TextEncoder();
        const productCodeBytes = encoder.encode(
          this.saves[slotNumber].productCode
        );
        const identifierBytes = encoder.encode(
          this.saves[slotNumber].identifier
        );
        const nameBytes = encoder.encode(this.saves[slotNumber].name);
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

  private async makePsvSave(save: Uint8Array): Promise<Uint8Array> {
    const psvSave = new Uint8Array(save.length + 4);
    psvSave[1] = 0x56; // 'V'
    psvSave[2] = 0x53; // 'S'
    psvSave[3] = 0x50; // 'P'
    psvSave[0x38] = 0x14;
    psvSave[0x3c] = 1;
    psvSave[0x44] = 0x84;
    psvSave[0x49] = 2;
    psvSave[0x5d] = 0x20;
    psvSave[0x60] = 3;
    psvSave[0x61] = 0x90;

    psvSave.set(save.subarray(0x0a, 0x2a), 0x64);
    new DataView(psvSave.buffer).setUint32(0x40, save.length - 0x80, true);
    psvSave.set(save.subarray(0x80), 0x84);

    const saltSeed = new Uint8Array(
      await crypto.subtle.digest("SHA-1", psvSave)
    );
    psvSave.set(saltSeed.subarray(0, 0x14), 0x08);
    psvSave.set(await this.getHmac(psvSave, saltSeed), 0x1c);
    return psvSave;
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

      return this.setSaveBytes(slotNumber, saveData);
    } catch (error) {
      console.error("Failed to open single save:", error);
      return false;
    }
  }

  public getIconData(slotNumber: number): number[] {
    if (this.iconData[slotNumber]?.[0]) {
      return this.iconData[slotNumber][0];
    }
    return new Array<number>(16 * 16).fill(0); // Return a blank icon if no data is available
  }

  public getIconPalette(
    slotNumber: number
  ): [number, number, number, number][] {
    if (this.iconPalette[slotNumber]) {
      // Set alpha to 255 (fully opaque) for all colors except the first one (usually transparent)
      return this.iconPalette[slotNumber].map(([r, g, b], index) =>
        index === 0 ? [r, g, b, 0] : [r, g, b, 255]
      );
    }
    return new Array<[number, number, number, number]>(16).fill([0, 0, 0, 0]); // Return a blank palette if no data is available
  }
}

export default PS1MemoryCard;
