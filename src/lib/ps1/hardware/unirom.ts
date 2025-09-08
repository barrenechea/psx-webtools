import { CommModes, HardwareInterface, SupportedFeatures, Types } from "./core";

enum UniromCommands {
  READ_START = "MCDN",
  WRITE_START = "MCUP",
  READ_OK = "MCDNOKV2",
  WRITE_OK = "MCUPOKV2",
  PROTOCOL_V2 = "UPV2",
  PROTOCOL_OK = "OKAY",
  READ_COMMAND = "MCRD",
  DUMP_COMMAND = "DUMP",
  MORE_DATA = "MORE",
  CHECK_COMMAND = "CHEK",
  ERROR = "ERR!",
}

export class Unirom extends HardwareInterface {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private interfaceName = "Unirom";
  private firstRun = true;
  private chunkBuffer = new Uint8Array(2048);
  private chunkBufferIndex = 0;

  constructor() {
    super();
    this.type = Types.UniROM;
  }

  override name(): string {
    return this.interfaceName;
  }

  override firmware(): string {
    return "2.0"; // Unirom version 2 protocol
  }

  override features(): SupportedFeatures {
    return SupportedFeatures.TcpMode;
  }

  private async readExactBytes(
    count: number,
    timeout = 1000
  ): Promise<Uint8Array> {
    if (!this.reader) throw new Error("Port not opened");

    const result = new Uint8Array(count);
    let offset = 0;
    const startTime = Date.now();

    while (offset < count) {
      if (Date.now() - startTime > timeout) {
        throw new Error("Read timeout");
      }

      const { value } = await this.reader.read();
      if (!value) continue;

      result.set(
        value.slice(0, Math.min(value.length, count - offset)),
        offset
      );
      offset += value.length;
    }

    return result;
  }

  private async readUntil(match: string, timeout = 1000): Promise<boolean> {
    if (!this.reader) throw new Error("Port not opened");

    let buffer = "";
    const startTime = Date.now();

    while (!buffer.includes(match)) {
      if (Date.now() - startTime > timeout) {
        return false;
      }

      const { value } = await this.reader.read();
      if (!value) continue;

      buffer += new TextDecoder().decode(value);
      while (buffer.length > match.length) {
        buffer = buffer.slice(1);
      }
    }

    return true;
  }

  private async writeData(data: Uint8Array | string): Promise<void> {
    if (!this.writer) throw new Error("Port not opened");

    const uint8Data =
      typeof data === "string" ? new TextEncoder().encode(data) : data;

    await this.writer.write(uint8Data);
  }

  private uint32ToBytes(value: number): Uint8Array {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true); // true for little-endian
    return new Uint8Array(buffer);
  }

  private async initUnirom(
    onStatusUpdate: (status: string) => void
  ): Promise<void> {
    onStatusUpdate("Initializing Unirom...");
    await this.flushInput();

    // Start protocol handshake
    if (this.commMode === CommModes.Read) {
      await this.writeData(UniromCommands.READ_START);
      if (!(await this.readUntil(UniromCommands.READ_OK))) {
        throw new Error("Unirom not detected on selected port");
      }
    } else {
      await this.writeData(UniromCommands.WRITE_START);
      if (!(await this.readUntil(UniromCommands.WRITE_OK))) {
        throw new Error("Unirom not detected on selected port");
      }
    }

    // Switch to V2 protocol
    onStatusUpdate("Switching to V2 protocol...");
    await this.writeData(UniromCommands.PROTOCOL_V2);
    if (!(await this.readUntil(UniromCommands.PROTOCOL_OK))) {
      throw new Error("Failed to switch to V2 protocol");
    }

    // Send card slot selection
    onStatusUpdate("Selecting memory card slot...");
    await this.writeData(this.uint32ToBytes(this.cardSlot));

    // Start transfer mode
    if (this.commMode === CommModes.Read) {
      await this.writeData(UniromCommands.READ_COMMAND);
    }
  }

  override async start(
    _deviceType: string,
    _baudRate: number,
    _signalsConfig: SerialOutputSignals[],
    onStatusUpdate: (status: string) => void
  ): Promise<string | null> {
    try {
      // Check if Web Serial API is supported
      if (!('serial' in navigator)) {
        return 'Web Serial API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.';
      }

      onStatusUpdate("Requesting serial port access...");
      this.port = await navigator.serial.requestPort();

      onStatusUpdate("Opening port at 115200 baud...");
      await this.port.open({ baudRate: 115200 }); // Unirom uses fixed 115200 baud

      this.reader = this.port.readable?.getReader() ?? null;
      this.writer = this.port.writable?.getWriter() ?? null;

      // Initialize Unirom communication
      await this.initUnirom(onStatusUpdate);
      return null;
    } catch (error) {
      if (this.port) await this.port.close();
      return (error as Error).message;
    }
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

  private async flushInput(): Promise<void> {
    if (!this.reader) return;
    await this.reader.cancel();
    this.reader.releaseLock();
    this.reader = this.port?.readable?.getReader() ?? null;
  }

  override async readMemoryCardFrame(
    frameNumber: number
  ): Promise<Uint8Array | null> {
    try {
      if (!this.storedInRam) {
        // Wait for initial RAM storage response
        const response = await this.readExactBytes(12);
        const address = new DataView(response.buffer, 4, 4).getUint32(0, true);
        const size = new DataView(response.buffer, 8, 4).getUint32(0, true);

        this.storedInRam = true;
        await this.writeData(UniromCommands.DUMP_COMMAND);

        // Read handshake
        await this.readExactBytes(16);

        // Send RAM address and size
        const addressAndSize = new Uint8Array(8);
        new DataView(addressAndSize.buffer).setUint32(0, address, true);
        new DataView(addressAndSize.buffer).setUint32(4, size, true);
        await this.writeData(addressAndSize);
        return null;
      }

      // Request more data every 16 frames
      if (frameNumber !== 0 && frameNumber % 16 === 0) {
        await this.writeData(UniromCommands.MORE_DATA);
      }

      // Read frame data
      const frameData = await this.readExactBytes(128);

      // Handle last frame
      if (frameNumber === 1023) {
        await this.writeData(UniromCommands.MORE_DATA);
        const checksumData = await this.readExactBytes(4);
        this.lastChecksum = new DataView(checksumData.buffer).getUint32(
          0,
          true
        );
      }

      return frameData;
    } catch (error) {
      console.error("Error reading frame:", error);
      return null;
    }
  }

  override async writeMemoryCardFrame(
    frameNumber: number,
    frameData: Uint8Array
  ): Promise<boolean> {
    try {
      // First frame setup
      if (this.firstRun) {
        const setupData = new Uint8Array(8);
        new DataView(setupData.buffer).setUint32(
          0,
          this.frameCount * 128,
          true
        ); // Size in bytes
        new DataView(setupData.buffer).setUint32(4, this.lastChecksum, true);

        await this.writeData(setupData);

        this.lastChecksum = 0;
        this.firstRun = false;
      }

      // Add frame data to chunk buffer
      this.chunkBuffer.set(frameData, this.chunkBufferIndex);
      this.chunkBufferIndex += frameData.length;

      // Process complete chunks (2048 bytes = 16 frames)
      if ((frameNumber + 1) % 16 === 0 || frameNumber === 1023) {
        const success = await this.writeMemoryCardChunk(
          this.chunkBuffer.slice(0, this.chunkBufferIndex)
        );
        this.chunkBufferIndex = 0;
        return success;
      }

      // Not enough data for a complete chunk yet
      return true;
    } catch (error) {
      console.error("Error writing frame:", error);
      return false;
    }
  }

  private async writeMemoryCardChunk(chunkData: Uint8Array): Promise<boolean> {
    let chunkChecksum = 0;

    // Write chunk data
    await this.writeData(chunkData);

    // Calculate checksum
    for (const byte of chunkData) {
      chunkChecksum += byte;
    }

    // Wait for checksum request
    if (!(await this.readUntil(UniromCommands.CHECK_COMMAND))) {
      return false;
    }

    // Send checksum
    await this.writeData(this.uint32ToBytes(chunkChecksum));

    // Wait for response and check if it matches the MORE_DATA command exactly
    return await this.readUntil(UniromCommands.MORE_DATA);
  }
}
