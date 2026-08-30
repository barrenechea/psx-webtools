import { isPs2ConquestCard } from "@/lib/ps2/ps2-conquest";
import {
  assembleImagePage,
  ECC_PAGE_DATA_SIZE,
  ECC_PAGE_SIZE,
} from "@/lib/ps2/ps2-ecc";
import {
  PS2Mechacon,
  type Ps2MgKeyset,
  validateMgKeyset,
} from "@/lib/ps2/ps2-mechacon";
import {
  CF_USE_ECC,
  type Ps2CardImageResult,
  type Ps2CardSpecs,
  type Ps2MgAuthResult,
  type Ps2SpecsResult,
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

// PS2 SIO2 over the CECHZM1 raw-SIO channel (AA 42). One AA 42 per SIO2 command
// (SEND3); the card fills MISO into the same buffer positions it was sent.
// Offsets are the validated ROM MCMAN map (analyze_ps2_bios_pageio.py).
const PS2_SIO_MAX_RETRIES = 5;
const PS2_TERM_RESET = 0x55;
const PS2_TERM_MCMAN = 0x5a;
const PS2_NOT_READY = 0x66;
// mcman_eraseblock polls the flush (0x12) this many times for a ready term
// while the NAND block is still erasing (0x66 = not ready).
const PS2_ERASE_FLUSH_POLLS = 100;
const PS2_PAGE_SIZES = [128, 256, 512, 1024];
// Same ceiling as ps3mca_probe.py: Get Specs cardsize is a page count.
const PS2_MAX_PAGES = 0x00200000;

// EDC over a run of bytes (XOR), matching the card's mcman_calcEDC.
function ps2Edc(bytes: Uint8Array): number {
  let e = 0;
  for (let i = 0; i < bytes.length; i++) e ^= bytes[i];
  return e & 0xff;
}

// Wrap an SIO2 command in an "AA 42" raw-SIO frame: [AA][42][len][00][<sio>].
function ps2SioCommand(sio: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(4 + sio.length);
  buffer[0] = 0xaa;
  buffer[1] = 0x42;
  buffer[2] = sio.length & 0xff;
  buffer[3] = 0x00;
  buffer.set(sio, 4);
  return buffer;
}

function ps2TermOk(b: number): boolean {
  return b === PS2_TERM_RESET || b === PS2_TERM_MCMAN;
}

function ps2SpecsPlausible(specs: Ps2CardSpecs): boolean {
  if (!PS2_PAGE_SIZES.includes(specs.pageSize)) return false;
  if (specs.blockPages < 1 || specs.blockPages > 32) return false;
  if (specs.pageCount < 1 || specs.pageCount > PS2_MAX_PAGES) return false;
  return true;
}

// Spare bytes on the SIO2 wire. MCMAN only queues the spare 0x43 when
// cardflags & CF_USE_ECC (mcsio2.c mcman_readpage).
function ps2WireSpareSize(specs: Ps2CardSpecs): number {
  if ((specs.flags & CF_USE_ECC) === 0) return 0;
  return (specs.pageSize + 0x1f) >> 5;
}

// Dump/image page size. The model stores 512 data + 16 spare even when the
// card has no ECC on the wire — the same concatenation as McReadPage's data
// buffer plus eccbuf. Non-512 pagesizes keep data + whatever spare the wire
// actually returned (the PFS model still requires 512).
function ps2ImagePageSize(specs: Ps2CardSpecs): number {
  if (specs.pageSize === ECC_PAGE_DATA_SIZE) return ECC_PAGE_SIZE;
  return specs.pageSize + ps2WireSpareSize(specs);
}

export class PS3MemCardAdaptor extends HardwareInterface {
  private device: USBDevice | null = null;
  private disconnectHandler: ((event: USBConnectionEvent) => void) | null =
    null;
  private interfaceName = "PS3 MC Adaptor";
  // Last successful MagicGate SessionKey (8 B). Never logged; cleared when a
  // handshake re-runs, fails, or the device is dropped.
  private sessionKey: Uint8Array | null = null;

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

  // Send one SIO2 command as a single raw-SIO frame and return the card's MISO
  // bytes (the command's positions, card-filled). null when no valid `55 5A`
  // reply arrives after retries. The adaptor mirrors the 4-byte `AA 42 len 00`
  // header back as `55 5A len 00` followed by the MISO, so the reply is
  // `4 + sio` bytes long and the MISO starts at [4].
  private async ps2Sio2(sio: Uint8Array): Promise<Uint8Array | null> {
    if (!this.device) return null;
    const out = ps2SioCommand(sio);
    const replyLength = 4 + sio.length;
    for (let attempt = 0; attempt < PS2_SIO_MAX_RETRIES; attempt++) {
      try {
        await this.device.transferOut(WRITE_EP, out);
        const reply = await transferInMessage(this.device, replyLength);
        if (
          reply &&
          reply.length >= replyLength &&
          reply[0] === 0x55 &&
          reply[1] === 0x5a
        ) {
          const miso = new Uint8Array(sio.length);
          miso.set(reply.subarray(4, 4 + sio.length));
          return miso;
        }
      } catch {
        // Retry on a USB error.
      }
    }
    return null;
  }

  // MCMAN Get Terminator (0x28) retries while MISO [4] is 0x66, then Set
  // Terminator (0x27) with 0x5A. Best-effort: a clone dump still proceeds if
  // this fails, and later packets accept reset term 0x55 as well as 0x5A.
  private async ps2SyncTerminator(): Promise<void> {
    const get = new Uint8Array(5);
    get[0] = 0x81;
    get[1] = 0x28;
    for (let attempt = 0; attempt < PS2_SIO_MAX_RETRIES; attempt++) {
      const m = await this.ps2Sio2(get);
      if (m && m[4] !== PS2_NOT_READY) break;
    }
    const set = new Uint8Array(5);
    set[0] = 0x81;
    set[1] = 0x27;
    set[2] = PS2_TERM_MCMAN;
    for (let attempt = 0; attempt < PS2_SIO_MAX_RETRIES; attempt++) {
      const m = await this.ps2Sio2(set);
      if (m && m[4] === PS2_TERM_MCMAN) return;
    }
  }

  // Get Specs (0x26, 13 B). MCMAN accepts EDC of [3..10] at [11] and
  // terminator 0x55 (reset) or 0x5A (after Set Terminator); [2] is stored as
  // flags (Sony 0x2B, including CF_USE_ECC). Official pre-auth is typically
  // all 0xFF, which fails EDC, so it is needs-auth.
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
    if (!edcOk || !ps2TermOk(m[12])) {
      return { status: "needs-auth" };
    }
    const specs: Ps2CardSpecs = {
      flags: m[2],
      pageSize: m[3] | (m[4] << 8),
      blockPages: m[5] | (m[6] << 8),
      pageCount: (m[7] | (m[8] << 8) | (m[9] << 16) | (m[10] << 24)) >>> 0,
    };
    if (!ps2SpecsPlausible(specs)) {
      return {
        status: "error",
        message: "PS2 Get Specs: implausible card geometry.",
      };
    }
    return { status: "ok", specs };
  }

  // --- MagicGate (mechacon) handshake, one AA 42 frame per packet. ---
  // 5-byte ack packet [0x81, cmd, param, 0, 0]; the card answers id at [3] and
  // the terminator at [4].
  private async ps2Mg5(
    cmd: number,
    param: number,
    retryNotReady = true,
  ): Promise<{ id: number; term: number } | null> {
    const sio = new Uint8Array(5);
    sio[0] = 0x81;
    sio[1] = cmd;
    sio[2] = param;
    const tries = retryNotReady ? PS2_SIO_MAX_RETRIES : 1;
    let m: Uint8Array | null = null;
    for (let i = 0; i < tries; i++) {
      m = await this.ps2Sio2(sio);
      // 0x2B + 0x66 is "not ready": poll up to the cap. A NAK (id != 0x2B) is a
      // definite rejection — stop immediately, no spin.
      if (!m || !(m[3] === 0x2b && m[4] === PS2_NOT_READY)) break;
    }
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
    let m: Uint8Array | null = null;
    for (let i = 0; i < PS2_SIO_MAX_RETRIES; i++) {
      m = await this.ps2Sio2(sio);
      if (!m || !(m[3] === 0x2b && m[13] === PS2_NOT_READY)) break;
    }
    if (!m || m[3] !== 0x2b) return null;
    let xor = 0;
    for (let i = 4; i <= 11; i++) xor ^= m[i];
    if (xor !== m[12] || !ps2TermOk(m[13])) return null;
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
    let m: Uint8Array | null = null;
    for (let i = 0; i < PS2_SIO_MAX_RETRIES; i++) {
      m = await this.ps2Sio2(sio);
      if (!m || !(m[12] === 0x2b && m[13] === PS2_NOT_READY)) break;
    }
    if (!m) return false;
    return m[12] === 0x2b && ps2TermOk(m[13]);
  }

  private async ps2MgStep(
    cmd: number,
    param: number,
    retryNotReady = true,
  ): Promise<boolean> {
    const r = await this.ps2Mg5(cmd, param, retryNotReady);
    return r !== null && r.id === 0x2b && ps2TermOk(r.term);
  }

  // Reset the card (F3) and report the failed step.
  private async ps2MgFail(step: string): Promise<Ps2MgAuthResult> {
    this.sessionKey = null;
    await this.ps2Mg5(0xf3, 0);
    return {
      status: "error",
      message: `PS2 MagicGate auth failed at ${step}.`,
      step,
    };
  }

  // Drive the full handshake, standing in for the mechacon. `mechaNonce` is the
  // host's fresh 8-byte nonce. Returns the SessionKey on success or the failed
  // step on error. DEX (keychangeParam 0) omits the F7 key-change packet.
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
    const mc = new PS2Mechacon();
    if (!(await this.ps2MgStep(0xf3, 0))) return this.ps2MgFail("F3");
    if (
      keyset.keychangeParam !== 0 &&
      !(await this.ps2MgStep(0xf7, keyset.keychangeParam))
    ) {
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
    // The card's own C3/C2 check reports a mismatch here. F0 0A is the
    // keyset-mismatch step: a 0x66/NAK is a definite failure, never "not ready",
    // so do not poll it (retryNotReady false).
    if (!(await this.ps2MgStep(0xf0, 0x0a, false)))
      return this.ps2MgFail("F0 0A");
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

  // Read one page. Sequence: start read (0x23), N× read 128 (0x43), spare
  // 0x43 only if CF_USE_ECC, then end (0x81). Retries the whole page like MCMAN.
  // Returns a 528-byte image page when pagesize is 512 (synthesizing spare if
  // the card has none on the wire).
  async ps2ReadPage(
    page: number,
    specs: Ps2CardSpecs,
  ): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < PS2_SIO_MAX_RETRIES; attempt++) {
      const image = await this.ps2ReadPageOnce(page, specs);
      if (image) return image;
    }
    return null;
  }

  private async ps2ReadPageOnce(
    page: number,
    specs: Ps2CardSpecs,
  ): Promise<Uint8Array | null> {
    const chunks = (specs.pageSize + 127) >> 7;
    const wireSpare = ps2WireSpareSize(specs);
    const data = new Uint8Array(specs.pageSize);

    const start = new Uint8Array(9);
    start[0] = 0x81;
    start[1] = 0x23;
    start[2] = page & 0xff;
    start[3] = (page >> 8) & 0xff;
    start[4] = (page >> 16) & 0xff;
    start[5] = (page >> 24) & 0xff;
    start[6] = ps2Edc(start.subarray(2, 6));
    const startMiso = await this.ps2Sio2(start);
    if (!startMiso || !ps2TermOk(startMiso[8])) return null;

    const chunkSio = new Uint8Array(134);
    chunkSio[0] = 0x81;
    chunkSio[1] = 0x43;
    chunkSio[2] = 128;
    for (let c = 0; c < chunks; c++) {
      const m = await this.ps2Sio2(chunkSio);
      if (!m) return null;
      const chunk = m.subarray(4, 132);
      if (ps2Edc(chunk) !== m[132]) return null;
      data.set(chunk, c * 128);
    }

    let spare: Uint8Array | null = null;
    if (wireSpare > 0) {
      const spareSio = new Uint8Array(wireSpare + 6);
      spareSio[0] = 0x81;
      spareSio[1] = 0x43;
      spareSio[2] = wireSpare;
      const spareMiso = await this.ps2Sio2(spareSio);
      if (!spareMiso) return null;
      spare = spareMiso.subarray(4, 4 + wireSpare);
    }

    const endSio = new Uint8Array(4);
    endSio[0] = 0x81;
    endSio[1] = 0x81;
    const endMiso = await this.ps2Sio2(endSio);
    if (!endMiso || !ps2TermOk(endMiso[3])) return null;

    if (specs.pageSize === ECC_PAGE_DATA_SIZE) {
      return assembleImagePage(data, spare);
    }
    const image = new Uint8Array(specs.pageSize + (spare?.length ?? 0));
    image.set(data);
    if (spare) image.set(spare, specs.pageSize);
    return image;
  }

  // Get Specs, authenticating first when the card refuses (needs-auth) and a
  // keyset is supplied. `needs-auth` is returned only when no keyset was used
  // (clones keep dumping). Once a keyset is used the outcome is either ok or an
  // error (a failed handshake keeps its step; a card that still refuses after a
  // successful auth is an error, not needs-auth). Exposed (not just internal)
  // so the format path can read the page count and size a blank image to it
  // before the destructive write.
  async ps2GetSpecsAuth(keyset?: Ps2MgKeyset): Promise<Ps2SpecsResult> {
    let result = await this.ps2GetSpecs();
    if (result.status !== "needs-auth") return result;
    if (!keyset) return result;
    const nonce = new Uint8Array(8);
    crypto.getRandomValues(nonce);
    const auth = await this.ps2AuthMg(keyset, nonce);
    if (auth.status !== "ok") {
      return { status: "error", message: auth.message, step: auth.step };
    }
    // Auth reset the card; re-sync the terminator and re-Get Specs. A card that
    // still refuses after a successful handshake used a key set that does not
    // match it; the `auth` step makes the caller drop the key set and re-prompt
    // instead of failing the read/write outright.
    await this.ps2SyncTerminator();
    result = await this.ps2GetSpecs();
    if (result.status === "needs-auth") {
      return {
        status: "error",
        message:
          "Authentication succeeded but the card still requires MagicGate authentication.",
        step: "auth",
      };
    }
    return result;
  }

  override async readPS2CardImage(
    onProgress: (progress: number) => void,
    keyset?: Ps2MgKeyset,
  ): Promise<Ps2CardImageResult> {
    await this.ps2SyncTerminator();
    const specsResult = await this.ps2GetSpecsAuth(keyset);
    if (specsResult.status !== "ok") return specsResult;
    const specs = specsResult.specs;
    const pageBytes = ps2ImagePageSize(specs);
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

  // Write one page. Sequence: start write (0x22), N× write 128 (0x42, data at
  // MOSI [3..130] + EDC [131]), spare 0x42 (ECC) only if CF_USE_ECC, then end
  // (0x81). Retries the whole page like MCMAN. `image` is the page as the card
  // model stores it: pageSize data bytes followed by the wire spare (if any).
  async ps2WritePage(
    page: number,
    image: Uint8Array,
    specs: Ps2CardSpecs,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < PS2_SIO_MAX_RETRIES; attempt++) {
      if (await this.ps2WritePageOnce(page, image, specs)) return true;
    }
    return false;
  }

  private async ps2WritePageOnce(
    page: number,
    image: Uint8Array,
    specs: Ps2CardSpecs,
  ): Promise<boolean> {
    const chunks = (specs.pageSize + 127) >> 7;
    const wireSpare = ps2WireSpareSize(specs);
    const data = image.subarray(0, specs.pageSize);

    const start = new Uint8Array(9);
    start[0] = 0x81;
    start[1] = 0x22;
    start[2] = page & 0xff;
    start[3] = (page >> 8) & 0xff;
    start[4] = (page >> 16) & 0xff;
    start[5] = (page >> 24) & 0xff;
    start[6] = ps2Edc(start.subarray(2, 6));
    const startMiso = await this.ps2Sio2(start);
    if (!startMiso || !ps2TermOk(startMiso[8])) return false;

    const chunkSio = new Uint8Array(134);
    chunkSio[0] = 0x81;
    chunkSio[1] = 0x42;
    chunkSio[2] = 128;
    for (let c = 0; c < chunks; c++) {
      const chunk = data.subarray(c * 128, c * 128 + 128);
      chunkSio.set(chunk, 3);
      chunkSio[131] = ps2Edc(chunk);
      const m = await this.ps2Sio2(chunkSio);
      if (!m || !ps2TermOk(m[133])) return false;
    }

    if (wireSpare > 0) {
      const spare = image.subarray(specs.pageSize, specs.pageSize + wireSpare);
      const spareSio = new Uint8Array(wireSpare + 6);
      spareSio[0] = 0x81;
      spareSio[1] = 0x42;
      spareSio[2] = wireSpare;
      spareSio.set(spare, 3);
      spareSio[3 + wireSpare] = ps2Edc(spare);
      const m = await this.ps2Sio2(spareSio);
      if (!m || !ps2TermOk(m[wireSpare + 5])) return false;
    }

    const endSio = new Uint8Array(4);
    endSio[0] = 0x81;
    endSio[1] = 0x81;
    const endMiso = await this.ps2Sio2(endSio);
    if (!endMiso || !ps2TermOk(endMiso[3])) return false;
    return true;
  }

  // Erase one block (blockPages pages), mirroring MCMAN mcman_eraseblock:
  // retry start erase (0x21, page = block * blockPages) + erase block (0x82)
  // until both ACK, then poll flush (0x12) until it ACKs — 0x66 means the NAND
  // is still erasing, so keep polling rather than re-issuing 0x21. A NAND page
  // cannot be reprogrammed until its block is erased, so writePS2CardImage
  // erases each block before writing its pages.
  async ps2EraseBlock(block: number, specs: Ps2CardSpecs): Promise<boolean> {
    const page = block * specs.blockPages;

    let started = false;
    for (let attempt = 0; attempt < PS2_SIO_MAX_RETRIES; attempt++) {
      if (await this.ps2StartEraseOnce(page)) {
        started = true;
        break;
      }
    }
    if (!started) return false;

    for (let poll = 0; poll < PS2_ERASE_FLUSH_POLLS; poll++) {
      if (await this.ps2FlushOnce()) return true;
    }
    return false;
  }

  // Start Erase (0x21, page LE + EDC, term [8]) then Erase Block (0x82, term
  // [3]). True when both ACK.
  private async ps2StartEraseOnce(page: number): Promise<boolean> {
    const start = new Uint8Array(9);
    start[0] = 0x81;
    start[1] = 0x21;
    start[2] = page & 0xff;
    start[3] = (page >> 8) & 0xff;
    start[4] = (page >> 16) & 0xff;
    start[5] = (page >> 24) & 0xff;
    start[6] = ps2Edc(start.subarray(2, 6));
    const startMiso = await this.ps2Sio2(start);
    if (!startMiso || !ps2TermOk(startMiso[8])) return false;

    const erase = new Uint8Array(4);
    erase[0] = 0x81;
    erase[1] = 0x82;
    const eraseMiso = await this.ps2Sio2(erase);
    return !!eraseMiso && ps2TermOk(eraseMiso[3]);
  }

  // One flush (0x12) poll, term [3]. True when the erase has completed; 0x66
  // (still erasing) fails the check so the caller keeps polling.
  private async ps2FlushOnce(): Promise<boolean> {
    const flush = new Uint8Array(4);
    flush[0] = 0x81;
    flush[1] = 0x12;
    const miso = await this.ps2Sio2(flush);
    return !!miso && ps2TermOk(miso[3]);
  }

  override async writePS2CardImage(
    image: Uint8Array,
    onProgress: (progress: number) => void,
    verify = false,
    keyset?: Ps2MgKeyset,
  ): Promise<Ps2CardImageResult> {
    await this.ps2SyncTerminator();
    const specsResult = await this.ps2GetSpecsAuth(keyset);
    if (specsResult.status !== "ok") return specsResult;
    const specs = specsResult.specs;
    const pageBytes = ps2ImagePageSize(specs);
    if (image.length !== specs.pageCount * pageBytes) {
      return {
        status: "error",
        message: "The PS2 card image size does not match the card in the slot.",
      };
    }
    // Conquest guard, before the first erase packet. Arcade SoulCalibur II
    // Conquest cards have no PFS filesystem; the firmware erases on request, so
    // the host must refuse here. The guard is fail-closed: a page-0 read that
    // does not return a page cannot prove the card is not Conquest, so refuse
    // too (erasing an unreadable Conquest card would destroy it).
    const page0 = await this.ps2ReadPage(0, specs);
    if (page0 === null) {
      return {
        status: "error",
        message:
          "Page 0 could not be read, so the card could not be checked for Conquest; the format/write was refused before any erase.",
      };
    }
    if (isPs2ConquestCard(page0)) {
      return {
        status: "error",
        message:
          "The card is a SoulCalibur II Conquest card with no PFS filesystem; it was refused before any erase or write.",
      };
    }
    const writeShare = verify ? 0.5 : 1;
    const blockCount = Math.ceil(specs.pageCount / specs.blockPages);
    for (let block = 0; block < blockCount; block++) {
      const erased = await this.ps2EraseBlock(block, specs);
      if (!erased) {
        return {
          status: "error",
          message: `Failed to erase block ${block} of ${blockCount}.`,
        };
      }
      const blockStart = block * specs.blockPages;
      const blockEnd = Math.min(blockStart + specs.blockPages, specs.pageCount);
      for (let page = blockStart; page < blockEnd; page++) {
        const ok = await this.ps2WritePage(
          page,
          image.subarray(page * pageBytes, (page + 1) * pageBytes),
          specs,
        );
        if (!ok) {
          return {
            status: "error",
            message: `Failed to write page ${page} of ${specs.pageCount}.`,
          };
        }
        onProgress(((page + 1) / specs.pageCount) * writeShare);
      }
    }
    if (verify) {
      for (let page = 0; page < specs.pageCount; page++) {
        const readPage = await this.ps2ReadPage(page, specs);
        if (!readPage) {
          return {
            status: "error",
            message: `Failed to verify page ${page} of ${specs.pageCount}.`,
          };
        }
        const written = image.subarray(
          page * pageBytes,
          (page + 1) * pageBytes,
        );
        for (let i = 0; i < pageBytes; i++) {
          if (readPage[i] !== written[i]) {
            return {
              status: "error",
              message: `Verify failed at page ${page} of ${specs.pageCount}.`,
            };
          }
        }
        onProgress(
          writeShare + ((page + 1) / specs.pageCount) * (1 - writeShare),
        );
      }
    }
    return { status: "ok", image, specs };
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
