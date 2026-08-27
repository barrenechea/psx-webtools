import {
  CardCheck,
  HardwareInterface,
  SlotCardKind,
  SupportedFeatures,
  Types,
} from "./core";

// What the card-slot probe classified. "empty" is a valid, detected state;
// "unknown" covers both an undetected slot and an unclassifiable reply.
export type CardProbeResult = SlotCardKind | "empty" | "unknown";

const VENDOR_ID = 0x054c;
const PRODUCT_ID = 0x02ea;
const READ_EP = 1;
const WRITE_EP = 2;

const READ_COMMAND_LENGTH = 144;
const WRITE_COMMAND_LENGTH = 142;
const POCKET_MEMORY_LENGTH = 142;
const POCKET_TIME_LENGTH = 142;
const MAX_RETRIES = 5;

// CECHZM1 bulk endpoints are 64-byte MPS. Chrome babbles if transferIn() asks
// for a length that is not a multiple of wMaxPacketSize and the device then
// sends a full packet — leftover bytes desync every later frame.
// MemcardRex reads into a 256-byte buffer for the same reason.
// https://stackoverflow.com/questions/49994122
const IN_TRANSFER_SIZE = 256;

// Card-type probe: 0xAA 0x40 -> the device answers 0x55 0x01 for a PS1 card.
const CMD_GET_CARD_TYPE = new Uint8Array([0xaa, 0x40]);

// Build a zeroed "AA 42" command buffer. Layout: [AA][42][len-4][00][81][op],
// then per-command fields (frame number @8/9, payload, checksum). The concrete
// ArrayBuffer type keeps it assignable to WebUSB's BufferSource.
function makeCommand(length: number, op: number): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(length);
  buffer[0] = 0xaa;
  buffer[1] = 0x42;
  buffer[2] = (length - 4) & 0xff;
  buffer[3] = 0x00;
  buffer[4] = 0x81;
  buffer[5] = op;
  return buffer;
}

function readResponse(response: USBInTransferResult): Uint8Array | null {
  const view = response.data;
  if (!view) return null;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

async function transferInMessage(
  device: USBDevice,
  minLength: number,
): Promise<Uint8Array | null> {
  const response = await device.transferIn(READ_EP, IN_TRANSFER_SIZE);
  if (response.status !== "ok") {
    return null;
  }
  const data = readResponse(response);
  if (!data || data.length < minLength) {
    return null;
  }
  return data;
}

export class PS3MemCardAdaptor extends HardwareInterface {
  private device: USBDevice | null = null;
  private disconnectHandler: ((event: USBConnectionEvent) => void) | null =
    null;
  private interfaceName = "PS3 MC Adaptor";

  private readFrameCommand = makeCommand(READ_COMMAND_LENGTH, 0x52);
  private writeFrameCommand = makeCommand(WRITE_COMMAND_LENGTH, 0x57);
  private pocketMemoryCommand = makeCommand(POCKET_MEMORY_LENGTH, 0x5b);
  private pocketTimeCommand = makeCommand(POCKET_TIME_LENGTH, 0x5c);

  constructor() {
    super();
    this.type = Types.PS3MCA;
  }

  override name(): string {
    return this.interfaceName;
  }

  override firmware(): string {
    return "";
  }

  override features(): SupportedFeatures {
    return SupportedFeatures.RealtimeMode | SupportedFeatures.PocketStation;
  }

  override async start(
    _deviceType: string,
    _baudRate: number,
    _signalsConfig: SerialOutputSignals[],
    onStatusUpdate: (status: string) => void,
  ): Promise<string | null> {
    try {
      if (!("usb" in navigator) || !navigator.usb) {
        return "WebUSB is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.";
      }

      onStatusUpdate("Requesting USB device access...");
      this.device = await navigator.usb.requestDevice({
        filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }],
      });
      this.attachDisconnectHandler();

      onStatusUpdate("Opening device...");
      await this.device.open();
      await this.device.selectConfiguration(1);
      await this.device.claimInterface(0);

      onStatusUpdate("PS3 MC Adaptor connected.");
      return null; // Success
    } catch (error) {
      this.removeDisconnectHandler();
      if (this.device) await this.device.close().catch(() => undefined);
      this.device = null;
      return (error as Error).message;
    }
  }

  override async stop(): Promise<void> {
    if (this.device) {
      this.removeDisconnectHandler();
      await this.device.close().catch(() => undefined);
      this.device = null;
    }
  }

  // The OS fires a "disconnect" event on navigator.usb (not on the USBDevice,
  // which is not an event target) when the adaptor is unplugged. Forward the
  // event for this specific device so the app can drop the connection.
  private attachDisconnectHandler() {
    if (!this.device) return;
    this.disconnectHandler = (event: USBConnectionEvent) => {
      if (event.device === this.device) this.onDisconnected?.();
    };
    navigator.usb.addEventListener("disconnect", this.disconnectHandler);
  }

  private removeDisconnectHandler() {
    if (this.disconnectHandler) {
      navigator.usb.removeEventListener("disconnect", this.disconnectHandler);
    }
    this.disconnectHandler = null;
  }

  // Probe the card slot. The adaptor can be connected without a card, so the
  // read/write paths call this before operating. The reply is `55 <type>`:
  // 00 empty, 01 PS1/PocketStation, 02 PS2. Returns null when the adaptor is
  // not connected; "unknown" when the slot cannot be classified.
  async ps2ProbeCardType(): Promise<CardProbeResult | null> {
    if (!this.device) return null;
    try {
      await this.device.transferOut(WRITE_EP, CMD_GET_CARD_TYPE);
      const data = await transferInMessage(this.device, 2);
      if (!data || data.length < 2 || data[0] !== 0x55) {
        return "unknown";
      }
      switch (data[1]) {
        case 0x00:
          return "empty";
        case 0x01:
          return "ps1";
        case 0x02:
          return "ps2";
        default:
          return "unknown";
      }
    } catch {
      return "unknown";
    }
  }

  override async checkCard(): Promise<CardCheck> {
    switch (await this.ps2ProbeCardType()) {
      case "ps1":
        return { present: true, kind: "ps1" };
      case "ps2":
        return { present: true, kind: "ps2" };
      case "empty":
        return {
          present: false,
          message: "No memory card detected. Insert a card and try again.",
        };
      case "unknown":
        return {
          present: false,
          message:
            "Could not detect the memory card. Try reseating the card or reconnecting.",
        };
      case null:
        return { present: false, message: "Device not connected." };
    }
  }

  override async readMemoryCardFrame(
    frameNumber: number,
  ): Promise<Uint8Array | null> {
    if (!this.device) return null;

    this.readFrameCommand[8] = (frameNumber >> 8) & 0xff;
    this.readFrameCommand[9] = frameNumber & 0xff;

    try {
      await this.device.transferOut(WRITE_EP, this.readFrameCommand);
      const data = await transferInMessage(this.device, READ_COMMAND_LENGTH);
      if (
        !data ||
        data.length < READ_COMMAND_LENGTH ||
        data[0] !== 0x55 ||
        data[1] !== 0x5a
      ) {
        return null;
      }

      const frame = new Uint8Array(128);
      for (let i = 0; i < 128; i++) {
        frame[i] = data[14 + i];
      }
      return frame;
    } catch {
      return null;
    }
  }

  override async writeMemoryCardFrame(
    frameNumber: number,
    frameData: Uint8Array,
  ): Promise<boolean> {
    if (!this.device) return false;

    this.writeFrameCommand[8] = (frameNumber >> 8) & 0xff;
    this.writeFrameCommand[9] = frameNumber & 0xff;
    for (let i = 0; i < 128; i++) {
      this.writeFrameCommand[10 + i] = frameData[i];
    }

    let checksum = 0;
    for (let i = 8; i < 10 + 128; i++) {
      checksum ^= this.writeFrameCommand[i];
    }
    this.writeFrameCommand[10 + 128] = checksum;

    for (let retries = 0; retries < MAX_RETRIES; retries++) {
      try {
        await this.device.transferOut(WRITE_EP, this.writeFrameCommand);
        // Give the card time to commit the sector before polling the ack.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const data = await transferInMessage(this.device, WRITE_COMMAND_LENGTH);
        if (data && data[0] === 0x55 && data[1] === 0x5a) {
          return true;
        }
      } catch {
        // Retry on a USB error.
      }
    }
    return false;
  }

  override async readPocketStationSerial(): Promise<{
    serial: number;
    errorMsg: string | null;
  }> {
    // Short commands are unreliable on third-party adapters, so the serial is
    // fetched by dumping the 128-byte block that starts at the serial address.
    const frame = await this.dumpPocketStationMemory(0x06000300);
    if (!frame) {
      return { serial: 0, errorMsg: "PocketStation not detected." };
    }
    const serial =
      frame[0] | (frame[1] << 8) | (frame[2] << 16) | (frame[3] << 24);
    return { serial: serial >>> 0, errorMsg: null };
  }

  override async dumpPocketStationBIOS(
    part: number,
  ): Promise<Uint8Array | null> {
    const address = 0x04000000 + part * 128;
    const frame = await this.dumpPocketStationMemory(address);
    if (!frame) return null;

    // Some knockoff adapters append a stray "G" good-status byte; re-read
    // shifted by two to recover the real final byte when that happens.
    if (frame[127] !== 0x47) return frame;
    const reframe = await this.dumpPocketStationMemory(address + 2);
    if (!reframe) return null;
    frame[127] = reframe[125];
    return frame;
  }

  override async setPocketStationTime(): Promise<{
    success: boolean;
    errorMsg: string | null;
  }> {
    if (!this.device) {
      return { success: false, errorMsg: "Device not connected" };
    }

    const now = new Date();
    const getBCD = (value: number): number => {
      const tens = Math.floor(value / 10);
      const single = value - tens * 10;
      return (tens << 4) | single;
    };

    this.pocketTimeCommand[9] = getBCD(now.getDate());
    this.pocketTimeCommand[10] = getBCD(now.getMonth() + 1);
    this.pocketTimeCommand[11] = getBCD(now.getFullYear() % 100);
    this.pocketTimeCommand[12] = getBCD(Math.floor(now.getFullYear() / 100));
    this.pocketTimeCommand[13] = getBCD(now.getSeconds());
    this.pocketTimeCommand[14] = getBCD(now.getMinutes());
    this.pocketTimeCommand[15] = getBCD(now.getHours());
    this.pocketTimeCommand[16] = getBCD(now.getDay() + 1);

    try {
      await this.device.transferOut(WRITE_EP, this.pocketTimeCommand);
      const data = await transferInMessage(this.device, 1);
      if (!data || data.length === 0) {
        return { success: false, errorMsg: "PocketStation not detected." };
      }
      return { success: true, errorMsg: null };
    } catch {
      return { success: false, errorMsg: "USB comm error" };
    }
  }

  // Dump a 128-byte block of PocketStation memory at the given 32-bit address.
  private async dumpPocketStationMemory(
    address: number,
  ): Promise<Uint8Array | null> {
    if (!this.device) return null;

    this.pocketMemoryCommand[6] = 0x01; // get-memory-block function
    this.pocketMemoryCommand[8] = address & 0xff;
    this.pocketMemoryCommand[9] = (address >> 8) & 0xff;
    this.pocketMemoryCommand[10] = (address >> 16) & 0xff;
    this.pocketMemoryCommand[11] = (address >> 24) & 0xff;
    this.pocketMemoryCommand[12] = 0x80; // 128 bytes

    try {
      await this.device.transferOut(WRITE_EP, this.pocketMemoryCommand);
      const data = await transferInMessage(this.device, POCKET_MEMORY_LENGTH);
      if (!data || data.length < POCKET_MEMORY_LENGTH) return null;

      const frame = new Uint8Array(128);
      for (let i = 0; i < 128; i++) {
        frame[i] = data[14 + i];
      }
      return frame;
    } catch {
      return null;
    }
  }
}
