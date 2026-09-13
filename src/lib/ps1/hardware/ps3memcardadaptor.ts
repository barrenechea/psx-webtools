import { formatPs2DestCard, writePs2DestCard } from "@/lib/ps2/ps2-dest-write";
import {
  PS2Mechacon,
  type Ps2MgKeyset,
  validateMgKeyset,
} from "@/lib/ps2/ps2-mechacon";
import type {
  Ps2CardImageResult,
  Ps2CardSpecs,
  Ps2MgAuthResult,
  Ps2SpecsResult,
} from "@/lib/ps2/ps2-types";

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
// Card-presence interrupt: 1-byte tokens (01/02/03) edge-triggered on insert
// and remove. The firmware probes the slot while idle, so the host only needs
// to drain this endpoint — never poll a card-type command for presence.
const INT_EP = 3;

const READ_COMMAND_LENGTH = 144;
const WRITE_COMMAND_LENGTH = 142;
const POCKET_SERVICE_SIO_LENGTH = 138;
const POCKET_MEMORY_DATA_OFFSET = 10;

// Card-type probe: 0xAA 0x40 -> the device answers 0x55 <type>.
const CMD_GET_CARD_TYPE = new Uint8Array([0xaa, 0x40]);

// PocketStation Get ID, sent over the raw-SIO channel after the type probe
// classifies the slot as 0x01 (PS1 or PocketStation). A PocketStation answers
// with ID 0x02 at MISO[2]; a plain PS1 card does not.
const CMD_POCKET_ID = new Uint8Array([0x81, 0x58, 0x00, 0x00, 0x00]);
const POCKET_ID_VALUE = 0x02;

function readResponse(response: USBInTransferResult): Uint8Array | null {
  const view = response.data;
  if (!view) return null;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

async function transferOutMessage(
  device: USBDevice,
  data: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const response = await device.transferOut(WRITE_EP, data);
  return response.status === "ok" && response.bytesWritten === data.length;
}

async function transferInMessage(
  device: USBDevice,
  expectedLength: number,
): Promise<Uint8Array | null> {
  const response = await device.transferIn(READ_EP, expectedLength);
  if (response.status !== "ok") {
    return null;
  }
  const data = readResponse(response);
  if (!data || data.length < expectedLength) {
    return null;
  }
  return data;
}

// PS2 card commands over CECHZM1 raw-SIO (AA 42): Probe, Get Specs, MagicGate,
// Set/Get Terminator, erase 81 21/81 81. PS2 pages are USB AA 52 / AA 57 only
// (libmcadpt). The dongle clocks 81 23/43/22/42 inside those opcodes.
const PS2_TERM = 0x55;
const PS2_FAILURE = 0x66;
const PS2_USB_PAGE_CAP = 0xffffffff;
const PS2_USB_BLOCK_PAGES = 16;
const USB_PAGE_READ_OUT = 9;
const USB_PAGE_READ_IN = 0x214;
const USB_PAGE_WRITE_OUT = 0x219;
const USB_PAGE_PAYLOAD = 0x210;

// EDC over a run of bytes (XOR).
function ps2Edc(bytes: Uint8Array): number {
  let e = 0;
  for (let i = 0; i < bytes.length; i++) e ^= bytes[i];
  return e & 0xff;
}

// Wrap an SIO command in AA 42: [AA][42][n le16][<n SIO bytes>].
function ps2SioCommand(sio: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(4 + sio.length);
  buffer[0] = 0xaa;
  buffer[1] = 0x42;
  buffer[2] = sio.length & 0xff;
  buffer[3] = (sio.length >> 8) & 0xff;
  buffer.set(sio, 4);
  return buffer;
}

function validIndex(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

export class PS3MemCardAdaptor extends HardwareInterface {
  private device: USBDevice | null = null;
  private disconnectHandler: ((event: USBConnectionEvent) => void) | null =
    null;
  private interfaceName = "PS3 MC Adaptor";
  // Last successful MagicGate SessionKey (8 B). Never logged; cleared when a
  // handshake re-runs, fails, or the device is dropped.
  private sessionKey: Uint8Array | null = null;
  // Drives the interrupt listener; stops the transferIn loop on stop()/error.
  private cardEventListening = false;

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
      this.cardEventListening = true;
      void this.listenCardEvents();

      onStatusUpdate("PS3 MC Adaptor connected.");
      return null; // Success
    } catch (error) {
      this.cardEventListening = false;
      this.removeDisconnectHandler();
      if (this.device) await this.device.close().catch(() => undefined);
      this.device = null;
      return (error as Error).message;
    }
  }

  override async stop(): Promise<void> {
    // Stop the listener and drop the callback before closing so a card event
    // cannot be dispatched while the device is torn down; the pending
    // transferIn is rejected by close() and the loop exits.
    this.cardEventListening = false;
    this.onCardEvent = null;
    if (this.device) {
      this.removeDisconnectHandler();
      await this.device.close().catch(() => undefined);
      this.device = null;
    }
    this.sessionKey = null;
  }

  // The OS fires a "disconnect" event on navigator.usb (not on the USBDevice,
  // which is not an event target) when the adaptor is unplugged. Forward the
  // event for this specific device so the app can drop the connection.
  private attachDisconnectHandler() {
    if (!this.device) return;
    this.disconnectHandler = (event: USBConnectionEvent) => {
      if (event.device === this.device) {
        this.sessionKey = null;
        this.onDisconnected?.();
      }
    };
    navigator.usb.addEventListener("disconnect", this.disconnectHandler);
  }

  private removeDisconnectHandler() {
    if (this.disconnectHandler) {
      navigator.usb.removeEventListener("disconnect", this.disconnectHandler);
    }
    this.disconnectHandler = null;
  }

  private async listenCardEvents(): Promise<void> {
    while (this.cardEventListening && this.device) {
      let response: USBInTransferResult;
      try {
        response = await this.device.transferIn(INT_EP, 1);
      } catch {
        // A rejected transferIn means the device closed or was unplugged.
        break;
      }
      // A resolved non-ok status is a transient failure; re-arm the 1-byte URB
      // (libmcadpt resubmits it) rather than dropping the listener. stop() and
      // an unplug (a rejected transferIn) still end the loop.
      if (response.status !== "ok") continue;
      if (!this.cardEventListening) break;
      const data = readResponse(response);
      if (!data) continue;
      const byte = data[0];
      if (byte === 0x01 || byte === 0x02 || byte === 0x03) {
        this.onCardEvent?.(byte);
      }
    }
  }

  // One `AA 40` type read. Returns the raw slot type (00/01/02) or null when the
  // reply is not a valid card-type: wrong magic, a short/missing reply, or a type
  // byte of 03 or higher (libmcadpt treats those as a failure).
  private async ps2ProbeSlotType(): Promise<number | null> {
    if (!this.device) return null;
    try {
      if (!(await transferOutMessage(this.device, CMD_GET_CARD_TYPE))) {
        return null;
      }
      const data = await transferInMessage(this.device, 2);
      if (!data) return null;
      const type = data[1];
      if (type !== 0x00 && type !== 0x01 && type !== 0x02) return null;
      return type;
    } catch {
      return null;
    }
  }

  // Probe the card slot the way libmcadpt does: `AA 40` three times, all three
  // must agree on a valid type (00/01/02) or the slot is unclassifiable. Type 01
  // then gets the PocketStation Get ID (`81 58`) once; 00 is empty, 02 PS2. The
  // adaptor can be connected without a card, so the read/write paths call this
  // before operating. It is classification only — it never dumps the card.
  // Returns null when the adaptor is not connected; "unknown" when the slot
  // cannot be classified.
  async ps2ProbeCardType(): Promise<CardProbeResult | null> {
    if (!this.device) return null;
    const first = await this.ps2ProbeSlotType();
    if (first === null) return "unknown";
    for (let i = 1; i < 3; i++) {
      const again = await this.ps2ProbeSlotType();
      if (again === null || again !== first) return "unknown";
    }
    switch (first) {
      case 0x00:
        return "empty";
      case 0x01:
        return await this.ps2ProbePocketStation();
      case 0x02:
        return "ps2";
      default:
        return "unknown";
    }
  }

  // The type probe reports 0x01 for both a PS1 card and a PocketStation. Send
  // the PocketStation Get ID (81 58) over the raw-SIO channel and require
  // MISO[2] == 0x02 to call it a PocketStation, then validate frame 0 as
  // libmcadpt does for either type. Never sent for empty / PS2 / unknown.
  private async ps2ProbePocketStation(): Promise<CardProbeResult> {
    const miso = await this.ps2Sio2(CMD_POCKET_ID);
    const kind = miso && miso[2] === POCKET_ID_VALUE ? "pocketstation" : "ps1";
    return (await this.readMemoryCardFrame(0)) ? kind : "unknown";
  }

  override async checkCard(): Promise<CardCheck> {
    switch (await this.ps2ProbeCardType()) {
      case "ps1":
        return { present: true, kind: "ps1" };
      case "pocketstation":
        return { present: true, kind: "pocketstation" };
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

  // Send one SIO command as one AA 42 transfer. libmcadpt accepts status 0x5A
  // with the exact echoed LE16 length; byte zero is not part of its check.
  private async ps2Sio2(sio: Uint8Array): Promise<Uint8Array | null> {
    if (!this.device) return null;
    const out = ps2SioCommand(sio);
    const replyLength = 4 + sio.length;
    try {
      if (!(await transferOutMessage(this.device, out))) return null;
      const reply = await transferInMessage(this.device, replyLength);
      if (
        reply &&
        reply[1] === 0x5a &&
        (reply[2] | (reply[3] << 8)) === sio.length
      ) {
        const miso = new Uint8Array(sio.length);
        miso.set(reply.subarray(4, 4 + sio.length));
        return miso;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async ps2Probe(): Promise<boolean> {
    const sio = new Uint8Array([0x81, 0x11, 0x00, 0x00]);
    const m = await this.ps2Sio2(sio);
    return !!m && m[2] === 0x2b && m[3] === PS2_TERM;
  }

  private async ps2GetTerminator(): Promise<number | null> {
    const get = new Uint8Array(5);
    get[0] = 0x81;
    get[1] = 0x28;
    const m = await this.ps2Sio2(get);
    if (!m || m[2] !== 0x2b || m[3] !== m[4]) return null;
    return m[3];
  }

  private async ps2SetTerminator(): Promise<boolean> {
    const set = new Uint8Array(5);
    set[0] = 0x81;
    set[1] = 0x27;
    set[2] = PS2_TERM;
    const m = await this.ps2Sio2(set);
    return !!m && m[3] === 0x2b && m[4] === PS2_TERM;
  }

  // libmcadpt reaches this only after a failed Probe and successful MagicGate.
  private async ps2SyncTerminator(): Promise<boolean> {
    const term = await this.ps2GetTerminator();
    if (term === null) return false;
    return term === PS2_TERM || this.ps2SetTerminator();
  }

  // Get Specs (0x26, 13 B). libmcadpt FUN_000039ec: MISO[2]=='+', EDC of
  // [3..10] at [11], terminator 'U'. [2] is also stored as flags (Sony 0x2B,
  // including CF_USE_ECC). Official pre-auth is typically all 0xFF, which
  // fails EDC, so it is needs-auth.
  async ps2GetSpecs(): Promise<Ps2SpecsResult> {
    const sio = new Uint8Array(13);
    sio[0] = 0x81;
    sio[1] = 0x26;
    const m = await this.ps2Sio2(sio);
    if (m === null) {
      return {
        status: "error",
        message: "PS2 Get Specs: no response from the card.",
      };
    }
    const edcOk = ps2Edc(m.subarray(3, 11)) === m[11];
    if (m[2] !== 0x2b || !edcOk || m[12] !== PS2_TERM) {
      return {
        status: "error",
        message: "PS2 Get Specs: invalid card response.",
      };
    }
    const specs: Ps2CardSpecs = {
      flags: m[2],
      pageSize: m[3] | (m[4] << 8),
      blockPages: m[5] | (m[6] << 8),
      pageCount: (m[7] | (m[8] << 8) | (m[9] << 16) | (m[10] << 24)) >>> 0,
    };
    return { status: "ok", specs };
  }

  // --- MagicGate (mechacon) handshake, one AA 42 frame per packet. ---
  // Five-byte MG packet. libmcadpt sends each command once and treats card
  // result 0x66 ('f') as failure.
  private async ps2Mg5(
    cmd: number,
    param: number,
  ): Promise<{ id: number; term: number } | null> {
    const sio = new Uint8Array(5);
    sio[0] = 0x81;
    sio[1] = cmd;
    sio[2] = param;
    const m = await this.ps2Sio2(sio);
    if (!m) return null;
    return { id: m[3], term: m[4] };
  }

  // 14-byte vector read [0x81, 0xF0, sub, 0...]; the 8-byte vector returns
  // byte-reversed at [4..11] with an XOR at [12] and terminator at [13].
  private async ps2MgRead(subcmd: number): Promise<Uint8Array | null> {
    const sio = new Uint8Array(14);
    sio[0] = 0x81;
    sio[1] = 0xf0;
    sio[2] = subcmd;
    const m = await this.ps2Sio2(sio);
    if (!m || m[3] !== 0x2b || m[13] === PS2_FAILURE) return null;
    let xor = 0;
    for (let i = 4; i <= 11; i++) xor ^= m[i];
    if (xor !== m[12]) return null;
    const data = new Uint8Array(8);
    for (let i = 0; i < 8; i++) data[i] = m[11 - i];
    return data;
  }

  // 14-byte vector write [0x81, 0xF0, sub, reversed data, xor, 0, 0].
  private async ps2MgWrite(subcmd: number, data: Uint8Array): Promise<boolean> {
    const sio = new Uint8Array(14);
    sio[0] = 0x81;
    sio[1] = 0xf0;
    sio[2] = subcmd;
    for (let i = 0; i < 8; i++) sio[3 + i] = data[7 - i];
    let xor = 0;
    for (let i = 0; i < 8; i++) xor ^= data[i];
    sio[11] = xor;
    const m = await this.ps2Sio2(sio);
    if (!m) return false;
    return m[12] === 0x2b && m[13] !== PS2_FAILURE;
  }

  private async ps2MgStep(cmd: number, param: number): Promise<boolean> {
    const r = await this.ps2Mg5(cmd, param);
    return r !== null && r.id === 0x2b && r.term !== PS2_FAILURE;
  }

  private ps2MgFail(step: string): Ps2MgAuthResult {
    this.sessionKey = null;
    return {
      status: "error",
      message: `PS2 MagicGate auth failed at ${step}.`,
      step,
    };
  }

  // Drive the OFW 3.55 CEX handshake, standing in for the mechacon.
  async ps2AuthMg(
    keyset: Ps2MgKeyset,
    mechaNonce: Uint8Array,
  ): Promise<Ps2MgAuthResult> {
    this.sessionKey = null;
    validateMgKeyset(keyset);
    if (mechaNonce.length !== 8) {
      return {
        status: "error",
        message: `Mecha nonce must be 8 bytes, got ${mechaNonce.length}.`,
        step: "nonce",
      };
    }
    if (keyset.keychangeParam !== 1) {
      return {
        status: "error",
        message: "libmcadpt uses the retail F7 01 MagicGate path.",
        step: "F7",
      };
    }
    const mc = new PS2Mechacon();
    if (!(await this.ps2MgStep(0xf3, 0))) return this.ps2MgFail("F3");
    if (!(await this.ps2MgStep(0xf7, 1))) {
      return this.ps2MgFail("F7");
    }
    if (!(await this.ps2MgStep(0xf0, 0x00))) return this.ps2MgFail("F0 00");

    const cardIv = await this.ps2MgRead(0x01);
    if (!cardIv) return this.ps2MgFail("F0 01");
    const cardMaterial = await this.ps2MgRead(0x02);
    if (!cardMaterial) return this.ps2MgFail("F0 02");
    mc.calcUniqueKey(keyset, cardIv, cardMaterial);

    if (!(await this.ps2MgStep(0xf0, 0x03))) return this.ps2MgFail("F0 03");
    const cardNonce = await this.ps2MgRead(0x04);
    if (!cardNonce) return this.ps2MgFail("F0 04");
    mc.setCardNonce(cardNonce);
    if (!(await this.ps2MgStep(0xf0, 0x05))) return this.ps2MgFail("F0 05");

    const { c1, c2, c3 } = mc.generateChallenges(keyset, mechaNonce);
    if (!(await this.ps2MgWrite(0x06, c3))) return this.ps2MgFail("F0 06");
    if (!(await this.ps2MgWrite(0x07, c2))) return this.ps2MgFail("F0 07");
    if (!(await this.ps2MgStep(0xf0, 0x08))) return this.ps2MgFail("F0 08");
    if (!(await this.ps2MgStep(0xf0, 0x09))) return this.ps2MgFail("F0 09");
    if (!(await this.ps2MgStep(0xf0, 0x0a))) return this.ps2MgFail("F0 0A");
    if (!(await this.ps2MgWrite(0x0b, c1))) return this.ps2MgFail("F0 0B");
    if (!(await this.ps2MgStep(0xf0, 0x0c))) return this.ps2MgFail("F0 0C");
    if (!(await this.ps2MgStep(0xf0, 0x0d))) return this.ps2MgFail("F0 0D");
    if (!(await this.ps2MgStep(0xf0, 0x0e))) return this.ps2MgFail("F0 0E");

    const cr1 = await this.ps2MgRead(0x0f);
    if (!cr1) return this.ps2MgFail("F0 0F");
    if (!(await this.ps2MgStep(0xf0, 0x10))) return this.ps2MgFail("F0 10");
    const cr2 = await this.ps2MgRead(0x11);
    if (!cr2) return this.ps2MgFail("F0 11");
    if (!(await this.ps2MgStep(0xf0, 0x12))) return this.ps2MgFail("F0 12");
    const cr3 = await this.ps2MgRead(0x13);
    if (!cr3) return this.ps2MgFail("F0 13");

    if (!mc.verifyResponses(keyset, cr1, cr2, cr3)) {
      return this.ps2MgFail("verify");
    }
    if (!(await this.ps2MgStep(0xf0, 0x14))) return this.ps2MgFail("F0 14");
    this.sessionKey = mc.sessionKey!;
    return { status: "ok", sessionKey: this.sessionKey };
  }

  // The 8-byte SessionKey from the last successful handshake, or null. Returns a
  // copy; the stored key is never logged.
  getPs2SessionKey(): Uint8Array | null {
    return this.sessionKey ? this.sessionKey.slice() : null;
  }

  // libmcadpt FUN_000045f4 framing: one AA 52 URB and memcpy 0x210. This host
  // deliberately keeps the full LE32 page field for cards larger than 8 MB.
  async ps2ReadPage(
    page: number,
    _specs: Ps2CardSpecs,
  ): Promise<Uint8Array | null> {
    if (!validIndex(page, PS2_USB_PAGE_CAP)) return null;
    return this.ps2UsbReadPage(page);
  }

  private async ps2UsbReadPage(page: number): Promise<Uint8Array | null> {
    if (!this.device) return null;
    const out = new Uint8Array(USB_PAGE_READ_OUT);
    out[0] = 0xaa;
    out[1] = 0x52;
    out[2] = 0x03;
    out[3] = page & 0xff;
    out[4] = (page >> 8) & 0xff;
    out[5] = (page >> 16) & 0xff;
    out[6] = (page >> 24) & 0xff;
    out[7] = 0x55;
    out[8] = 0x2b;
    try {
      if (!(await transferOutMessage(this.device, out))) return null;
      const reply = await transferInMessage(this.device, USB_PAGE_READ_IN);
      if (!reply || reply[1] !== 0x5a) {
        return null;
      }
      if ((reply[2] | (reply[3] << 8)) !== USB_PAGE_PAYLOAD) return null;
      return reply.subarray(4, 4 + USB_PAGE_PAYLOAD);
    } catch {
      return null;
    }
  }

  private async ps2UsbWritePage(
    page: number,
    image: Uint8Array,
  ): Promise<boolean> {
    if (!this.device || image.length !== USB_PAGE_PAYLOAD) return false;
    const out = new Uint8Array(USB_PAGE_WRITE_OUT);
    out[0] = 0xaa;
    out[1] = 0x57;
    out[2] = 0x03;
    out[3] = page & 0xff;
    out[4] = (page >> 8) & 0xff;
    out[5] = (page >> 16) & 0xff;
    out[6] = (page >> 24) & 0xff;
    out.set(image.subarray(0, USB_PAGE_PAYLOAD), 7);
    out[7 + USB_PAGE_PAYLOAD] = 0x55;
    out[8 + USB_PAGE_PAYLOAD] = 0x2b;
    try {
      if (!(await transferOutMessage(this.device, out))) return false;
      const reply = await transferInMessage(this.device, 2);
      return !!reply && reply[1] === 0x5a;
    } catch {
      return false;
    }
  }

  // libmcadpt open sequence: stable AA 40 type, Probe, and on Probe failure
  // MagicGate followed by Get/conditional Set Terminator, then Get Specs.
  async ps2GetSpecsAuth(keyset?: Ps2MgKeyset): Promise<Ps2SpecsResult> {
    const kind = await this.ps2ProbeCardType();
    if (kind !== "ps2") {
      return {
        status: "error",
        message:
          kind === null
            ? "PS3 MC Adaptor is not connected."
            : "The card slot does not contain a PS2 memory card.",
      };
    }

    const probeOk = await this.ps2Probe();
    if (probeOk) return this.ps2GetSpecs();
    if (!keyset) return { status: "needs-auth" };

    const nonce = new Uint8Array(8);
    crypto.getRandomValues(nonce);
    const auth = await this.ps2AuthMg(keyset, nonce);
    if (auth.status !== "ok") {
      return { status: "error", message: auth.message, step: auth.step };
    }
    if (!(await this.ps2SyncTerminator())) {
      await this.ps2Mg5(0xf3, 0);
      this.sessionKey = null;
      return {
        status: "error",
        message: "PS2 terminator synchronization failed after authentication.",
        step: "terminator",
      };
    }
    return this.ps2GetSpecs();
  }

  override async readPS2CardImage(
    onProgress: (progress: number) => void,
    keyset?: Ps2MgKeyset,
  ): Promise<Ps2CardImageResult> {
    const specsResult = await this.ps2GetSpecsAuth(keyset);
    if (specsResult.status !== "ok") return specsResult;
    const specs = specsResult.specs;
    const pageBytes = USB_PAGE_PAYLOAD;
    const image = new Uint8Array(specs.pageCount * pageBytes);
    for (let page = 0; page < specs.pageCount; page++) {
      const data = await this.ps2ReadPage(page, specs);
      if (!data) {
        return {
          status: "error",
          message: `Failed to read page ${page} of ${specs.pageCount}.`,
        };
      }
      image.set(data, page * pageBytes);
      onProgress((page + 1) / specs.pageCount);
    }
    return { status: "ok", image, specs };
  }

  // libmcadpt FUN_00004964 framing: one AA 57 URB and 0x210 payload. Keep the
  // full LE32 page field for larger cards.
  async ps2WritePage(
    page: number,
    image: Uint8Array,
    _specs: Ps2CardSpecs,
  ): Promise<boolean> {
    if (!validIndex(page, PS2_USB_PAGE_CAP)) return false;
    return this.ps2UsbWritePage(page, image);
  }

  // Erase one 16-page block with libmcadpt's AA 42 81 21 then 81 81 sequence.
  // Unlike OFW's 0x400-block cap, bound against the card's full Get Specs size.
  async ps2EraseBlock(block: number, specs: Ps2CardSpecs): Promise<boolean> {
    if (
      !Number.isInteger(block) ||
      block < 0 ||
      block >= Math.ceil(specs.pageCount / PS2_USB_BLOCK_PAGES)
    ) {
      return false;
    }
    const page = block * PS2_USB_BLOCK_PAGES;
    const start = new Uint8Array(9);
    start[0] = 0x81;
    start[1] = 0x21;
    start[2] = page & 0xff;
    start[3] = (page >> 8) & 0xff;
    start[4] = (page >> 16) & 0xff;
    start[5] = (page >> 24) & 0xff;
    start[6] = ps2Edc(start.subarray(2, 6));
    const startMiso = await this.ps2Sio2(start);
    if (!startMiso || startMiso[7] !== 0x2b || startMiso[8] !== PS2_TERM) {
      return false;
    }

    const end = new Uint8Array(4);
    end[0] = 0x81;
    end[1] = 0x81;
    const endMiso = await this.ps2Sio2(end);
    return !!endMiso && endMiso[2] === 0x2b && endMiso[3] === PS2_TERM;
  }

  /**
   * Keep the on-disk bad-block list (or spare-scan if unformatted), build
   * format2, and program filesystem erase blocks. `quick` is the PS3 Utility
   * path; full erases every unlisted block first.
   */
  override async formatPS2Card(
    onProgress: (progress: number) => void,
    quick: boolean,
    keyset?: Ps2MgKeyset,
  ): Promise<Ps2CardImageResult> {
    const specsResult = await this.ps2GetSpecsAuth(keyset);
    if (specsResult.status !== "ok") return specsResult;
    const specs = specsResult.specs;
    return formatPs2DestCard(this.ps2DestNand(specs), specs, onProgress, quick);
  }

  override async writePS2CardImage(
    image: Uint8Array,
    onProgress: (progress: number) => void,
    _verify = false,
    keyset?: Ps2MgKeyset,
  ): Promise<Ps2CardImageResult> {
    const specsResult = await this.ps2GetSpecsAuth(keyset);
    if (specsResult.status !== "ok") return specsResult;
    const specs = specsResult.specs;
    return writePs2DestCard(this.ps2DestNand(specs), image, specs, onProgress);
  }

  private ps2DestNand(specs: Ps2CardSpecs) {
    return {
      readPage: (page: number) => this.ps2ReadPage(page, specs),
      writePage: (page: number, data: Uint8Array) =>
        this.ps2WritePage(page, data, specs),
      eraseBlock: (block: number) => this.ps2EraseBlock(block, specs),
    };
  }

  override async readMemoryCardFrame(
    frameNumber: number,
  ): Promise<Uint8Array | null> {
    if (!validIndex(frameNumber, 0x400)) return null;
    const sio = new Uint8Array(READ_COMMAND_LENGTH - 4);
    sio[0] = 0x81;
    sio[1] = 0x52;
    sio[4] = (frameNumber >> 8) & 0xff;
    sio[5] = frameNumber & 0xff;
    const m = await this.ps2Sio2(sio);
    if (
      !m ||
      m[2] !== 0x5a ||
      m[3] !== 0x5d ||
      m[4] !== 0x00 ||
      m[6] !== 0x5c ||
      m[7] !== 0x5d ||
      m[139] !== 0x47 ||
      (m[8] === 0xff && m[9] === 0xff)
    ) {
      return null;
    }
    let xor = 0;
    for (let i = 8; i < 138; i++) xor ^= m[i];
    if (xor !== m[138]) return null;
    return m.slice(10, 138);
  }

  override async writeMemoryCardFrame(
    frameNumber: number,
    frameData: Uint8Array,
  ): Promise<boolean> {
    if (!validIndex(frameNumber, 0x400) || frameData.length !== 128) {
      return false;
    }
    const sio = new Uint8Array(WRITE_COMMAND_LENGTH - 4);
    sio[0] = 0x81;
    sio[1] = 0x57;
    sio[4] = (frameNumber >> 8) & 0xff;
    sio[5] = frameNumber & 0xff;
    sio.set(frameData, 6);
    let checksum = 0;
    for (let i = 4; i < 134; i++) checksum ^= sio[i];
    sio[134] = checksum;
    const m = await this.ps2Sio2(sio);
    return (
      !!m &&
      m[2] === 0x5a &&
      m[3] === 0x5d &&
      m[135] === 0x5c &&
      m[136] === 0x5d &&
      m[137] === 0x47
    );
  }

  override async readPocketStationSerial(): Promise<{
    serial: number;
    errorMsg: string | null;
  }> {
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
    if (!validIndex(part, 127)) return null;
    return this.dumpPocketStationMemory(0x04000000 + part * 128);
  }

  override async setPocketStationTime(): Promise<{
    success: boolean;
    errorMsg: string | null;
  }> {
    if (!this.device) {
      return { success: false, errorMsg: "Device not connected" };
    }
    const bcd = (value: number): number =>
      (Math.floor(value / 10) << 4) | (value % 10);
    const now = new Date();
    const sio = new Uint8Array(POCKET_SERVICE_SIO_LENGTH);
    sio[0] = 0x81;
    sio[1] = 0x5c;
    sio[5] = bcd(now.getDate());
    sio[6] = bcd(now.getMonth() + 1);
    sio[7] = bcd(now.getFullYear() % 100);
    sio[8] = bcd(Math.floor(now.getFullYear() / 100));
    sio[9] = bcd(now.getSeconds());
    sio[10] = bcd(now.getMinutes());
    sio[11] = bcd(now.getHours());
    sio[12] = bcd(now.getDay() + 1);

    const reply = await this.ps2Sio2(sio);
    return reply
      ? { success: true, errorMsg: null }
      : { success: false, errorMsg: "PocketStation not detected." };
  }

  // PocketStation service extension: read one 128-byte memory block through
  // the same strict, single-shot AA 42 envelope used by libmcadpt commands.
  private async dumpPocketStationMemory(
    address: number,
  ): Promise<Uint8Array | null> {
    const sio = new Uint8Array(POCKET_SERVICE_SIO_LENGTH);
    sio[0] = 0x81;
    sio[1] = 0x5b;
    sio[2] = 0x01;
    sio[4] = address & 0xff;
    sio[5] = (address >>> 8) & 0xff;
    sio[6] = (address >>> 16) & 0xff;
    sio[7] = (address >>> 24) & 0xff;
    sio[8] = 0x80;

    const reply = await this.ps2Sio2(sio);
    if (!reply) return null;
    return reply.slice(
      POCKET_MEMORY_DATA_OFFSET,
      POCKET_MEMORY_DATA_OFFSET + 128,
    );
  }
}
