export enum Types {
  DexDrive,
  MemCARDuino,
  PS1CardLink,
  UniROM,
  PS3MCA,
}

export enum Modes {
  Serial,
  TCP,
}

export enum CommModes {
  Read,
  Write,
  Format,
  Realtime,
  PSInfo,
  PSBios,
  PSTime,
}

export enum SupportedFeatures {
  None = 0,
  TcpMode = 1,
  RealtimeMode = 1 << 1,
  PocketStation = 1 << 2,
}

const pocketstationError =
  "PocketStation commands are not supported by this interface";

export abstract class HardwareInterface {
  private _type: Types;
  private _mode: Modes;
  private _commMode: CommModes;
  private _cardSlot: number;
  private _frameCount = 1024; // Default number of frames on a standard Memory Card
  private _lastChecksum: number;
  private _storedInRam: boolean;

  constructor() {
    // Set default values
    this._type = Types.MemCARDuino;
    this._mode = Modes.Serial;
    this._commMode = CommModes.Read;
    this._cardSlot = 0;
    this._lastChecksum = 0;
    this._storedInRam = false;
  }

  get mode(): Modes {
    return this._mode;
  }

  set mode(value: Modes) {
    this._mode = value;
  }

  get commMode(): CommModes {
    return this._commMode;
  }

  set commMode(value: CommModes) {
    this._commMode = value;
  }

  get cardSlot(): number {
    return this._cardSlot;
  }

  set cardSlot(value: number) {
    this._cardSlot = value;
  }

  get frameCount(): number {
    return this._frameCount;
  }

  set frameCount(value: number) {
    this._frameCount = value;
  }

  get lastChecksum(): number {
    return this._lastChecksum;
  }

  set lastChecksum(value: number) {
    this._lastChecksum = value;
  }

  get type(): Types {
    return this._type;
  }

  set type(value: Types) {
    this._type = value;
  }

  get storedInRam(): boolean {
    return this._storedInRam;
  }

  set storedInRam(value: boolean) {
    this._storedInRam = value;
  }

  calculateChecksum(inBytes: Uint8Array): number {
    let returnVal = 0;
    for (const idx of inBytes.keys()) {
      returnVal += inBytes[idx];
    }
    return returnVal >>> 0; // Convert to 32-bit unsigned integer
  }

  start(
    port: string,
    speed: number,
    signalsConfig: SerialOutputSignals[],
    onStatusUpdate: (status: string) => void
  ): Promise<string | null> {
    console.error(port);
    console.error(speed);
    console.error(signalsConfig);
    console.error(onStatusUpdate);
    return Promise.resolve("This interface is not yet supported");
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  name(): string {
    return "Dummy interface";
  }

  firmware(): string {
    return "";
  }

  features(): SupportedFeatures {
    return SupportedFeatures.None;
  }

  readMemoryCardFrame(frameNumber: number): Promise<Uint8Array | null> {
    console.error("readMemoryCardFrame not implemented");
    console.error(frameNumber);
    return Promise.resolve(null);
  }

  writeMemoryCardFrame(
    frameNumber: number,
    frameData: Uint8Array
  ): Promise<boolean> {
    console.error("writeMemoryCardFrame not implemented");
    console.error(frameNumber);
    console.error(frameData);
    return Promise.resolve(false);
  }

  readPocketStationSerial(): Promise<{
    serial: number;
    errorMsg: string | null;
  }> {
    return Promise.resolve({ serial: 0, errorMsg: pocketstationError });
  }

  dumpPocketStationBIOS(part: number): Promise<Uint8Array | null> {
    console.error("dumpPocketStationBIOS not implemented");
    console.error(part);
    return Promise.resolve(null);
  }

  setPocketStationTime(): Promise<{
    success: boolean;
    errorMsg: string | null;
  }> {
    return Promise.resolve({ success: false, errorMsg: pocketstationError });
  }
}
