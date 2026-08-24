import { HardwareInterface, SupportedFeatures, Types } from "./core";

enum DexDriveCommands {
  INIT = 0x00,
  READ = 0x02,
  WRITE = 0x04,
  LIGHT = 0x07,
  MAGIC_HANDSHAKE = 0x27,
}

enum DexDriveResponses {
  WRITE_OK = 0x28,
  WRITE_SAME = 0x29,
}

// Every IAI command is prefixed with the three-byte "IAI" banner.
const IAI = new Uint8Array([0x49, 0x41, 0x49]);

export class DexDrive extends HardwareInterface {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private interfaceName = "DexDrive";
  private firmwareVersion = "0.0";

  private rxQueue: number[] = [];
  private pendingRead: Promise<void> | null = null;
  private rxClosed = false;
  private rxNeedsDrain = true;

  private static readonly RxQuietMs = 25;
  private static readonly ReadTimeoutMs = 500;

  constructor() {
    super();
    this.type = Types.DexDrive;
  }

  override name(): string {
    return this.interfaceName;
  }

  override firmware(): string {
    return this.firmwareVersion;
  }

  override features(): SupportedFeatures {
    return SupportedFeatures.RealtimeMode;
  }

  override async start(
    _deviceType: string,
    _baudRate: number,
    _signalsConfig: SerialOutputSignals[],
    onStatusUpdate: (status: string) => void,
  ): Promise<string | null> {
    try {
      if (!("serial" in navigator)) {
        return "Web Serial API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.";
      }

      onStatusUpdate("Requesting serial port access...");
      this.port = await navigator.serial.requestPort();

      onStatusUpdate("Opening port at 38400 baud...");
      await this.port.open({ baudRate: 38400, bufferSize: 256 });
      this.reader = this.port.readable?.getReader() ?? null;
      this.writer = this.port.writable?.getWriter() ?? null;
      this.rxQueue = [];
      this.pendingRead = null;
      this.rxClosed = false;
      this.rxNeedsDrain = true;

      // The device idles in a low-power POUT state until RTS is toggled, and
      // uses the DTR line for extra power.
      onStatusUpdate("Waking device (RTS/DTR)...");
      await this.port.setSignals({ requestToSend: false });
      await this.delay(300);
      await this.port.setSignals({ requestToSend: true });
      await this.delay(300);
      await this.port.setSignals({ dataTerminalReady: true });

      // Poll with a non-command string; the device answers "IAI" to any input
      // but detection can fail on the first couple of tries, so send it a few
      // times (draining the previous reply each round).
      onStatusUpdate("Detecting device...");
      for (let i = 0; i < 5; i++) {
        await this.drain();
        await this.writer?.write(new TextEncoder().encode("XXXXX"));
        await this.delay(20);
      }

      const banner = await this.readData(3);
      if (
        banner.length < 3 ||
        banner[0] !== IAI[0] ||
        banner[1] !== IAI[1] ||
        banner[2] !== IAI[2]
      ) {
        return "DexDrive was not detected on the selected port.";
      }

      // Kick the device out of POUT mode; it replies with its ID (device type
      // + version) which we validate and record.
      const initPayload = new Uint8Array([
        0x10, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
        0xff, 0xaa, 0xbb, 0xcc, 0xdd,
      ]);
      await this.sendCommand(DexDriveCommands.INIT, initPayload);
      const idData = await this.readData(9);
      if (
        idData.length < 9 ||
        idData[5] !== 0x50 ||
        idData[6] !== 0x53 ||
        idData[7] !== 0x58
      ) {
        return "Detected device is not a PS1 DexDrive.";
      }
      const version = idData[8];
      this.firmwareVersion = `${version >> 6}.${(version >> 2) & 0xf}${version & 0x3}`;

      // Send the magic handshake, then turn on the status light.
      for (let i = 0; i < 10; i++) {
        await this.sendCommand(DexDriveCommands.MAGIC_HANDSHAKE);
      }
      await this.delay(50);
      await this.sendCommand(DexDriveCommands.LIGHT, new Uint8Array([1]));

      onStatusUpdate(
        `DexDrive detected. Firmware version: ${this.firmwareVersion}`,
      );
      return null; // Success
    } catch (error) {
      if (this.port) await this.port.close();
      return (error as Error).message;
    }
  }

  override async stop(): Promise<void> {
    this.rxClosed = true;
    this.rxQueue = [];
    this.pendingRead = null;
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

  override async readMemoryCardFrame(
    frameNumber: number,
  ): Promise<Uint8Array | null> {
    const frameLsb = frameNumber & 0xff;
    const frameMsb = (frameNumber >> 8) & 0xff;
    let xorData = frameLsb ^ frameMsb;

    await this.sendCommand(
      DexDriveCommands.READ,
      new Uint8Array([frameLsb, frameMsb]),
    );

    const readData = await this.readData(133);
    if (readData.length < 133) return null;

    const frameData = readData.subarray(4, 132);
    for (let i = 0; i < 128; i++) {
      xorData ^= frameData[i];
    }

    if (xorData !== readData[132]) return null;

    return frameData.slice();
  }

  override async writeMemoryCardFrame(
    frameNumber: number,
    frameData: Uint8Array,
  ): Promise<boolean> {
    const frameLsb = frameNumber & 0xff;
    const frameMsb = (frameNumber >> 8) & 0xff;
    const revLsb = DexDrive.reverseByte(frameLsb);
    const revMsb = DexDrive.reverseByte(frameMsb);
    let xorData = frameMsb ^ frameLsb ^ revMsb ^ revLsb;
    for (let i = 0; i < 128; i++) {
      xorData ^= frameData[i];
    }

    await this.sendCommand(
      DexDriveCommands.WRITE,
      new Uint8Array([frameMsb, frameLsb, revMsb, revLsb]),
    );
    await this.writer?.write(frameData);
    await this.writer?.write(new Uint8Array([xorData]));

    const response = await this.readData(4);
    return (
      response.length >= 4 &&
      (response[3] === DexDriveResponses.WRITE_OK ||
        response[3] === DexDriveResponses.WRITE_SAME)
    );
  }

  // Send one IAI command (banner + command byte + optional payload), draining
  // any leftover from the previous exchange first.
  private async sendCommand(command: number, data?: Uint8Array): Promise<void> {
    await this.drain();
    if (!this.writer) throw new Error("Port not opened");
    const header = new Uint8Array(4);
    header.set(IAI, 0);
    header[3] = command;
    await this.writer.write(header);
    if (data) await this.writer.write(data);
  }

  private static reverseByte(input: number): number {
    let output = 0;
    for (let i = 0; i < 8; i++) {
      if ((input & (1 << i)) > 0) output |= 1 << (7 - i);
    }
    return output;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private raceWithTimeout(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`DexDrive read timed out after ${ms}ms`)),
        ms,
      );
      promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private startPendingRead(): void {
    if (this.pendingRead || !this.reader) return;
    this.pendingRead = this.reader
      .read()
      .then((result) => {
        const value = result.value;
        if (!this.rxClosed && !result.done && value?.length) {
          for (let i = 0; i < value.length; i++) {
            this.rxQueue.push(value[i]);
          }
        }
        this.pendingRead = null;
      })
      .catch(() => {
        this.pendingRead = null;
      });
  }

  private async waitForData(timeout: number): Promise<boolean> {
    if (!this.reader) return false;
    const before = this.rxQueue.length;
    this.startPendingRead();
    if (this.pendingRead) {
      try {
        await this.raceWithTimeout(this.pendingRead, timeout);
      } catch {
        return this.rxQueue.length > before;
      }
    }
    return this.rxQueue.length > before;
  }

  private async readData(
    count: number,
    timeout = DexDrive.ReadTimeoutMs,
  ): Promise<Uint8Array> {
    if (!this.reader) throw new Error("Port not opened");
    const deadline = Date.now() + timeout;
    while (this.rxQueue.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (!(await this.waitForData(remaining))) break;
    }
    const available = Math.min(count, this.rxQueue.length);
    const result = new Uint8Array(available);
    for (let i = 0; i < available; i++) {
      result[i] = this.rxQueue[i];
    }
    this.rxQueue.splice(0, available);
    this.rxNeedsDrain = available < count || this.rxQueue.length > 0;
    return result;
  }

  private async drain(): Promise<void> {
    if (!this.reader) return;
    // Drop leftover JS bytes. Leave any in-flight reader.read() alone: that
    // hanging read is how the next reply arrives.
    this.rxQueue = [];
    if (!this.rxNeedsDrain) return;
    while (await this.waitForData(DexDrive.RxQuietMs)) {
      this.rxQueue = [];
    }
  }
}
