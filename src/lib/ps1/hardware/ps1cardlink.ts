import { SupportedFeatures, Types } from "./core";
import { MemCARDuino } from "./memcarduino";

// Commands are a subset of the MemCARDuino command set; only the connect
// handshake differs, so the frame read/write path is inherited unchanged.
enum PS1CLnkCommands {
  GETID = 0xa0,
  GETVER = 0xa1,
  MCPORT = 0xa4,
}

const PS1CLNK_ID = "PS1CLNK";
const PS1CLNK_MIN_SLOT_VERSION = 0x11;

export class PS1CardLink extends MemCARDuino {
  constructor() {
    super();
    this.type = Types.PS1CardLink;
  }

  override name(): string {
    return "PS1CardLink";
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
      // Check if Web Serial API is supported
      if (!("serial" in navigator)) {
        return "Web Serial API is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.";
      }

      onStatusUpdate("Requesting serial port access...");
      this.port = await navigator.serial.requestPort();

      onStatusUpdate("Opening port at 115200 baud...");
      await this.port.open({ baudRate: 115200, bufferSize: 256 });

      this.reader = this.port.readable?.getReader() ?? null;
      this.writer = this.port.writable?.getWriter() ?? null;

      onStatusUpdate("Checking for PS1CardLink...");
      await this.discard();
      await this.sendDataToPort(PS1CLnkCommands.GETID);
      const idData = await this.readDataFromPort(7);
      if (
        idData.length !== 7 ||
        new TextDecoder().decode(idData) !== PS1CLNK_ID
      ) {
        return "PS1CardLink was not detected on the selected port.";
      }

      onStatusUpdate("Getting firmware version...");
      await this.discard();
      await this.sendDataToPort(PS1CLnkCommands.GETVER);
      const versionData = await this.readDataFromPort(1);
      if (versionData.length !== 1) {
        return "PS1CardLink was not detected on the selected port.";
      }
      this.firmwareVersion = versionData[0];

      // Dual-slot hardware (firmware 1.1+) needs the card slot selected.
      if (this.firmwareVersion >= PS1CLNK_MIN_SLOT_VERSION) {
        await this.sendDataToPort(PS1CLnkCommands.MCPORT);
        await this.sendDataToPort(this.cardSlot);
      }

      onStatusUpdate(
        `PS1CardLink detected. Firmware version: ${this.firmware()}`,
      );
      return null; // Success
    } catch (error) {
      if (this.port) await this.port.close();
      return (error as Error).message;
    }
  }
}
