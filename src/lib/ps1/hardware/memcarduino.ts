import { HardwareInterface, SupportedFeatures, Types } from "./core";

enum MCinoCommands {
  GETID = 0xa0,
  GETVER = 0xa1,
  MCR = 0xa2,
  MCW = 0xa3,
  PSINFO = 0xb0,
  PSBIOS = 0xb1,
  PSTIME = 0xb2,
}

enum MCinoResponses {
  ERROR = 0xe0,
  GOOD = 0x47,
  BADCHECKSUM = 0x4e,
  BADSECTOR = 0xff,
}

export class MemCARDuino extends HardwareInterface {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private interfaceName = "MemCARDuino";
  private firmwareVersion = 0;
  private currentBaudRate = 0;

  private static readonly PocketCommandsMin: number = 0x08;
  private static readonly PocketUnsupported: string =
    "Please update MemCARDuino to use PocketStation commands";
  private static readonly PocketNotFound: string =
    "PocketStation not detected on MemCARDuino";

  constructor() {
    super();
    this.type = Types.MemCARDuino;
  }

  override name(): string {
    return this.interfaceName;
  }

  override firmware(): string {
    return `${this.firmwareVersion >> 4}.${this.firmwareVersion & 0xf}`;
  }

  override features(): SupportedFeatures {
    return SupportedFeatures.RealtimeMode | SupportedFeatures.PocketStation;
  }

  override async start(
    _portInfo: string,
    speed: number,
    onStatusUpdate: (status: string) => void
  ): Promise<string | null> {
    const portBaudRate = speed === 38400 ? 38400 : 115200;

    try {
      onStatusUpdate("Requesting serial port access...");
      this.port = await navigator.serial.requestPort();

      onStatusUpdate(`Opening port at ${portBaudRate} baud...`);
      await this.port.open({ baudRate: portBaudRate });
      this.currentBaudRate = portBaudRate;

      this.reader = this.port.readable?.getReader() ?? null;
      this.writer = this.port.writable?.getWriter() ?? null;

      // Reset Arduino and set it to serial mode
      onStatusUpdate("Resetting MemCARDuino...");
      await this.port.setSignals({ dataTerminalReady: true });
      await this.port.setSignals({ dataTerminalReady: false });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      onStatusUpdate("Checking for MemCARDuino...");
      await this.sendDataToPort(MCinoCommands.GETID);
      const readData = await this.readDataFromPort(6);

      if (new TextDecoder().decode(readData) !== "MCDINO") {
        return "MemCARDuino was not detected on the selected port.";
      }

      onStatusUpdate("Getting firmware version...");
      await this.sendDataToPort(MCinoCommands.GETVER);
      const versionData = await this.readDataFromPort(1);
      this.firmwareVersion = versionData[0];

      onStatusUpdate(
        `MemCARDuino detected. Firmware version: ${this.firmware()}`
      );
      return null; // Success
    } catch (error) {
      return (error as Error).message;
    }
  }

  getBaudRate(): number {
    return this.currentBaudRate;
  }

  override async stop(): Promise<void> {
    if (this.reader) {
      await this.reader.cancel();
      this.reader.releaseLock();
    }
    if (this.writer) {
      await this.writer.close();
      this.writer.releaseLock();
    }
    if (this.port) {
      await this.port.close();
    }
  }

  private async sendDataToPort(command: MCinoCommands): Promise<void> {
    if (!this.writer) throw new Error("Port not opened");
    await this.writer.write(new Uint8Array([command]));
  }

  private async readDataFromPort(count: number): Promise<Uint8Array> {
    if (!this.reader) throw new Error("Port not opened");
    const result = new Uint8Array(count);
    let offset = 0;
    while (offset < count) {
      const { value, done } = await this.reader.read();
      if (done) break;
      result.set(value, offset);
      offset += value.length;
    }
    return result.slice(0, offset);
  }

  override async readMemoryCardFrame(
    frameNumber: number
  ): Promise<Uint8Array | null> {
    const frameMsb = (frameNumber >> 8) & 0xff;
    const frameLsb = frameNumber & 0xff;
    let xorData = frameMsb ^ frameLsb;

    await this.sendDataToPort(MCinoCommands.MCR);
    await this.writer?.write(new Uint8Array([frameMsb, frameLsb]));

    const readData = await this.readDataFromPort(130);

    if (readData.length < 130) return null;

    const frameData = readData.slice(0, 128);
    for (const byte of frameData) {
      xorData ^= byte;
    }

    if (
      xorData !== readData[128] ||
      readData[129].valueOf() !== MCinoResponses.GOOD.valueOf()
    ) {
      return null;
    }

    return frameData;
  }

  override async writeMemoryCardFrame(
    frameNumber: number,
    frameData: Uint8Array
  ): Promise<boolean> {
    const frameMsb = (frameNumber >> 8) & 0xff;
    const frameLsb = frameNumber & 0xff;
    let xorData = frameMsb ^ frameLsb;

    for (const byte of frameData) {
      xorData ^= byte;
    }

    await this.sendDataToPort(MCinoCommands.MCW);
    await this.writer?.write(
      new Uint8Array([frameMsb, frameLsb, ...frameData, xorData])
    );

    const response = await this.readDataFromPort(1);
    return response[0].valueOf() === MCinoResponses.GOOD.valueOf();
  }

  override async readPocketStationSerial(): Promise<{
    serial: number;
    errorMsg: string | null;
  }> {
    if (this.firmwareVersion < MemCARDuino.PocketCommandsMin) {
      return { serial: 0, errorMsg: MemCARDuino.PocketUnsupported };
    }

    await this.sendDataToPort(MCinoCommands.PSINFO);
    const readData = await this.readDataFromPort(0x12);

    if (readData[0] !== 0x12) {
      return { serial: 0, errorMsg: MemCARDuino.PocketNotFound };
    }

    const serial =
      readData[7] |
      (readData[8] << 8) |
      (readData[9] << 16) |
      (readData[10] << 24);
    return { serial, errorMsg: null };
  }

  override async dumpPocketStationBIOS(
    part: number
  ): Promise<Uint8Array | null> {
    if (this.firmwareVersion < MemCARDuino.PocketCommandsMin) {
      return null;
    }

    await this.sendDataToPort(MCinoCommands.PSBIOS);
    await this.writer?.write(new Uint8Array([part]));

    const initialResponse = await this.readDataFromPort(2);
    if (initialResponse[0] !== 0x5 || initialResponse[1] !== 0x80) {
      return null;
    }

    const biosData = await this.readDataFromPort(128);
    const statusResponse = await this.readDataFromPort(1);

    if (statusResponse[0].valueOf() !== MCinoResponses.GOOD.valueOf()) {
      return null;
    }

    return biosData;
  }

  private getBCD(value: number): number {
    const tens = Math.floor(value / 10);
    const single = value - tens * 10;
    return (tens << 4) | single;
  }

  override async setPocketStationTime(): Promise<{
    success: boolean;
    errorMsg: string | null;
  }> {
    if (this.firmwareVersion < MemCARDuino.PocketCommandsMin) {
      return { success: false, errorMsg: MemCARDuino.PocketUnsupported };
    }

    await this.sendDataToPort(MCinoCommands.PSTIME);
    const initialResponse = await this.readDataFromPort(2);

    if (initialResponse[0] !== 0x0 || initialResponse[1] !== 0x08) {
      return { success: false, errorMsg: MemCARDuino.PocketNotFound };
    }

    const now = new Date();
    const timeData = new Uint8Array([
      this.getBCD(now.getDate()),
      this.getBCD(now.getMonth() + 1),
      this.getBCD(now.getFullYear() % 100),
      this.getBCD(Math.floor(now.getFullYear() / 100)),
      this.getBCD(now.getSeconds()),
      this.getBCD(now.getMinutes()),
      this.getBCD(now.getHours()),
      this.getBCD(now.getDay() + 1),
    ]);

    await this.writer?.write(timeData);

    return { success: true, errorMsg: null };
  }
}
