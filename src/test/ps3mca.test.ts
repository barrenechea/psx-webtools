import { SupportedFeatures, Types } from "@/lib/ps1/hardware/core";
import { PS3MemCardAdaptor } from "@/lib/ps1/hardware/ps3memcardadaptor";
import { assembleImagePage } from "@/lib/ps2/ps2-ecc";

import { makeScriptedUsb, nonNull, type ScriptedUsb } from "./hardware-helpers";
import { equalBytes } from "./psx-helpers";

// The adaptor drives a USBDevice through transferOut/transferIn; inject a
// scripted device into the private `device` field (typed shape, no `any`).
type Ps3Shape = { device: USBDevice | null };
const shape = (a: PS3MemCardAdaptor): Ps3Shape => a as unknown as Ps3Shape;
function connect(a: PS3MemCardAdaptor): ScriptedUsb {
  const usb = makeScriptedUsb();
  shape(a).device = usb.device as unknown as USBDevice;
  return usb;
}

function frame(fill: number): Uint8Array {
  const f = new Uint8Array(128);
  for (let i = 0; i < 128; i++) f[i] = (fill + i) & 0xff;
  return f;
}

// 144-byte read reply: 55 5A header, frame at offset 14.
function readResponse(f: Uint8Array): Uint8Array {
  const r = new Uint8Array(144);
  r[0] = 0x55;
  r[1] = 0x5a;
  r.set(f, 14);
  return r;
}

// 142-byte ack, optionally with a bad status byte.
function ack(status = 0x5a): Uint8Array {
  const r = new Uint8Array(142);
  r[0] = 0x55;
  r[1] = status;
  return r;
}

// 142-byte pocket memory reply, frame at offset 14.
function pocketResponse(f: Uint8Array): Uint8Array {
  const r = new Uint8Array(142);
  r.set(f, 14);
  return r;
}

// A raw-SIO reply: 55 5A len 00 header, then the card's MISO at offset 4.
function ps2Reply(miso: Uint8Array): Uint8Array {
  const r = new Uint8Array(4 + miso.length);
  r[0] = 0x55;
  r[1] = 0x5a;
  r[2] = miso.length & 0xff;
  r[3] = 0x00;
  r.set(miso, 4);
  return r;
}

// A PocketStation Get ID (81 58) raw-SIO reply. The ID sits at MISO[2]: a
// PocketStation reports 0x02, a plain PS1 card reports something else.
function pocketIdReply(isPocket: boolean): Uint8Array {
  const miso = new Uint8Array(5);
  miso[0] = 0x81;
  miso[1] = 0x58;
  miso[2] = isPocket ? 0x02 : 0x00;
  return ps2Reply(miso);
}

// Enqueue Get Terminator (0x28) ready + Set Terminator (0x27) 0x5A ack.
function enqueueTerminator(usb: ScriptedUsb): void {
  const get = new Uint8Array(5);
  get[0] = 0x81;
  get[1] = 0x28;
  get[3] = 0x55;
  get[4] = 0x5a;
  usb.enqueueIn(ps2Reply(get));
  const set = new Uint8Array(5);
  set[0] = 0x81;
  set[1] = 0x27;
  set[2] = 0x5a;
  set[4] = 0x5a;
  usb.enqueueIn(ps2Reply(set));
}

function sonySpecsMiso(
  pageCount: number,
  term = 0x5a,
  flags = 0x2b,
): Uint8Array {
  const m = new Uint8Array(13);
  m[0] = 0x81;
  m[1] = 0x26;
  m[2] = flags;
  m[3] = 0x00;
  m[4] = 0x02; // pagesize 512
  m[5] = 0x10;
  m[6] = 0x00; // blockPages 16
  m[7] = pageCount & 0xff;
  m[8] = (pageCount >> 8) & 0xff;
  m[9] = (pageCount >> 16) & 0xff;
  m[10] = (pageCount >> 24) & 0xff;
  for (let i = 3; i < 11; i++) m[11] ^= m[i];
  m[12] = term;
  return m;
}

// SIO replies for one 512-byte page: start read, four 128-byte chunks
// (pattern-filled and EDC-checked), optional 16-byte spare, and the end.
function enqueuePageRead(
  usb: ScriptedUsb,
  pattern: number,
  ecc: number,
  withSpare = true,
): void {
  const start = new Uint8Array(9);
  start[0] = 0x81;
  start[1] = 0x23;
  start[8] = 0x5a;
  usb.enqueueIn(ps2Reply(start));

  for (let c = 0; c < 4; c++) {
    const m = new Uint8Array(134);
    m[0] = 0x81;
    m[1] = 0x43;
    // Each chunk carries its own page offset, so the assembled page is one
    // continuous ramp from `pattern` (catches a mis-placed chunk).
    for (let i = 0; i < 128; i++) m[4 + i] = (pattern + c * 128 + i) & 0xff;
    for (let i = 4; i < 132; i++) m[132] ^= m[i];
    usb.enqueueIn(ps2Reply(m));
  }

  if (withSpare) {
    const spare = new Uint8Array(22);
    spare[0] = 0x81;
    spare[1] = 0x43;
    for (let i = 0; i < 16; i++) spare[4 + i] = (ecc + i) & 0xff;
    usb.enqueueIn(ps2Reply(spare));
  }

  const end = new Uint8Array(4);
  end[0] = 0x81;
  end[1] = 0x81;
  end[3] = 0x5a;
  usb.enqueueIn(ps2Reply(end));
}

// A raw-SIO write: the card ACKs each command with a terminator at the last
// MISO position (start [8], data [133], spare [len-1], end [3]).
function enqueuePageWrite(usb: ScriptedUsb, withSpare = true): void {
  const start = new Uint8Array(9);
  start[0] = 0x81;
  start[1] = 0x22;
  start[8] = 0x5a;
  usb.enqueueIn(ps2Reply(start));
  for (let c = 0; c < 4; c++) {
    const m = new Uint8Array(134);
    m[0] = 0x81;
    m[1] = 0x42;
    m[133] = 0x5a;
    usb.enqueueIn(ps2Reply(m));
  }
  if (withSpare) {
    const spare = new Uint8Array(22);
    spare[0] = 0x81;
    spare[1] = 0x42;
    spare[21] = 0x5a;
    usb.enqueueIn(ps2Reply(spare));
  }
  const end = new Uint8Array(4);
  end[0] = 0x81;
  end[1] = 0x81;
  end[3] = 0x5a;
  usb.enqueueIn(ps2Reply(end));
}

// SIO replies for one block erase (MCMAN mcman_eraseblock order): start erase
// (0x21, term [8]), erase block (0x82, term [3]), flush (0x12, term [3]).
function enqueueBlockErase(usb: ScriptedUsb): void {
  const start = new Uint8Array(9);
  start[0] = 0x81;
  start[1] = 0x21;
  start[8] = 0x5a;
  usb.enqueueIn(ps2Reply(start));
  const erase = new Uint8Array(4);
  erase[0] = 0x81;
  erase[1] = 0x82;
  erase[3] = 0x5a;
  usb.enqueueIn(ps2Reply(erase));
  const flush = new Uint8Array(4);
  flush[0] = 0x81;
  flush[1] = 0x12;
  flush[3] = 0x5a;
  usb.enqueueIn(ps2Reply(flush));
}

// Read-back of a page that echoes the bytes just written (verify tests): the
// card returns the given 528-byte image page, EDC-checked.
function enqueuePageReadEcho(usb: ScriptedUsb, imagePage: Uint8Array): void {
  const start = new Uint8Array(9);
  start[0] = 0x81;
  start[1] = 0x23;
  start[8] = 0x5a;
  usb.enqueueIn(ps2Reply(start));
  for (let c = 0; c < 4; c++) {
    const m = new Uint8Array(134);
    m[0] = 0x81;
    m[1] = 0x43;
    m.set(imagePage.subarray(c * 128, (c + 1) * 128), 4);
    for (let i = 4; i < 132; i++) m[132] ^= m[i];
    usb.enqueueIn(ps2Reply(m));
  }
  const spare = new Uint8Array(22);
  spare[0] = 0x81;
  spare[1] = 0x43;
  spare.set(imagePage.subarray(512, 528), 4);
  usb.enqueueIn(ps2Reply(spare));
  const end = new Uint8Array(4);
  end[0] = 0x81;
  end[1] = 0x81;
  end[3] = 0x5a;
  usb.enqueueIn(ps2Reply(end));
}

// EDC over a run of bytes (XOR) — mirrors the adapter's mcman_calcEDC.
function edc(bytes: Uint8Array): number {
  let e = 0;
  for (let i = 0; i < bytes.length; i++) e ^= bytes[i];
  return e & 0xff;
}

describe("N. PS3 MC Adaptor (WebUSB)", () => {
  it("N1 read command layout: AA 42 (len-4) 00 81 'R', frame MSB/LSB at [8]/[9]", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(readResponse(frame(0x10)));
    await a.readMemoryCardFrame(0x0102);

    const w = usb.writes[0];
    expect(w.length).toBe(144);
    expect(w[0]).toBe(0xaa);
    expect(w[1]).toBe(0x42);
    expect(w[2]).toBe(144 - 4);
    expect(w[3]).toBe(0x00);
    expect(w[4]).toBe(0x81);
    expect(w[5]).toBe(0x52); // 'R'
    expect(w[8]).toBe(0x01);
    expect(w[9]).toBe(0x02);
    for (let i = 10; i < 144; i++) expect(w[i]).toBe(0);
  });

  it("N2 read reply: frame is copied from offset 14", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x20);
    usb.enqueueIn(readResponse(f));

    expect(equalBytes(nonNull(await a.readMemoryCardFrame(0)), f)).toBe(true);
  });

  it("N3 a read reply with a bad status byte is rejected", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const resp = readResponse(frame(0x10));
    resp[1] = 0x5b;
    usb.enqueueIn(resp);

    expect(await a.readMemoryCardFrame(0)).toBeNull();
  });

  it("N4 a short read (143 bytes) is rejected", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(new Uint8Array(143));

    expect(await a.readMemoryCardFrame(0)).toBeNull();
  });

  it("N5 a USB write error aborts the read", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.failWrites(true);

    expect(await a.readMemoryCardFrame(0)).toBeNull();
  });

  it("N6 write layout: AA 42 (len-4) 00 81 'W', frame at [10], XOR at [138]", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x30);
    usb.enqueueIn(ack());

    expect(await a.writeMemoryCardFrame(0x0201, f)).toBe(true);

    const w = usb.writes[0];
    expect(w.length).toBe(142);
    expect(w[0]).toBe(0xaa);
    expect(w[1]).toBe(0x42);
    expect(w[2]).toBe(142 - 4);
    expect(w[4]).toBe(0x81);
    expect(w[5]).toBe(0x57); // 'W'
    expect(w[8]).toBe(0x02);
    expect(w[9]).toBe(0x01);
    for (let i = 0; i < 128; i++) expect(w[10 + i]).toBe(f[i]);
    let xor = 0;
    for (let i = 8; i < 10 + 128; i++) xor ^= w[i];
    expect(w[138]).toBe(xor);
    expect(w[139]).toBe(0);
    expect(w[140]).toBe(0);
    expect(w[141]).toBe(0);
  });

  it("N7 a bad ack is retried, a good ack after a bad one succeeds", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x30);
    usb.enqueueIn(ack(0x5b)); // bad status
    usb.enqueueIn(ack()); // good

    expect(await a.writeMemoryCardFrame(0, f)).toBe(true);
    expect(usb.writes.length).toBe(2);
  });

  it("N8 five failed attempts give up", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x30);
    for (let i = 0; i < 5; i++) usb.enqueueIn(ack(0x5b));

    expect(await a.writeMemoryCardFrame(0, f)).toBe(false);
    expect(usb.writes.length).toBe(5);
  });

  it("N9 serial: memory dump at 0x06000300, serial is the LE32 of frame[0..4]", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x40);
    f[0] = 0x11;
    f[1] = 0x22;
    f[2] = 0x33;
    f[3] = 0x44;
    usb.enqueueIn(pocketResponse(f));

    const { serial, errorMsg } = await a.readPocketStationSerial();
    expect(errorMsg).toBeNull();
    expect(serial).toBe(0x44332211);

    const w = usb.writes[0];
    expect(w.length).toBe(142);
    expect(w[5]).toBe(0x5b); // '[' op: get memory block
    expect(w[6]).toBe(0x01); // function
    expect(w[8]).toBe(0x00); // 0x06000300 LE
    expect(w[9]).toBe(0x03);
    expect(w[10]).toBe(0x00);
    expect(w[11]).toBe(0x06);
    expect(w[12]).toBe(0x80); // 128 bytes
  });

  it("N10 a failed serial dump reports 'not detected'", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(new Uint8Array(141)); // short read

    const { serial, errorMsg } = await a.readPocketStationSerial();
    expect(serial).toBe(0);
    expect(errorMsg).toBe("PocketStation not detected.");
  });

  it("N11 BIOS part N is dumped at 0x04000000 + N*128", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x50);
    usb.enqueueIn(pocketResponse(f));

    expect(equalBytes(nonNull(await a.dumpPocketStationBIOS(3)), f)).toBe(true);

    const w = usb.writes[0];
    // 3 * 128 = 0x180, so part 3 lives at 0x04000180
    expect(w[8]).toBe(0x80);
    expect(w[9]).toBe(0x01);
    expect(w[10]).toBe(0x00);
    expect(w[11]).toBe(0x04);
    expect(w[12]).toBe(0x80);
  });

  it("N12 3rd-party 'G' at frame[127]: re-read at address+2, recover from reframe[125]", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x50);
    f[127] = 0x47; // 'G'
    usb.enqueueIn(pocketResponse(f));
    const reframe = frame(0x50);
    reframe[125] = 0x99;
    usb.enqueueIn(pocketResponse(reframe));

    const result = nonNull(await a.dumpPocketStationBIOS(0));
    expect(usb.writes.length).toBe(2);
    expect(usb.writes[1][8]).toBe(0x02); // 0x04000002 LE
    expect(usb.writes[1][9]).toBe(0x00);
    expect(usb.writes[1][10]).toBe(0x00);
    expect(usb.writes[1][11]).toBe(0x04);
    expect(result[127]).toBe(0x99);
  });

  // N13 (BCD vectors) is folded into N14: getBCD is a local in
  // setPocketStationTime, and N14 decodes every BCD field and checks it.

  it("N14 time layout: BCD day/month/year/century/sec/min/hour/dow at [9..16]", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(new Uint8Array([0x55]));

    const before = new Date(Date.now() - 1000);
    const after = new Date(Date.now() + 1000);
    const { success, errorMsg } = await a.setPocketStationTime();
    expect(success).toBe(true);
    expect(errorMsg).toBeNull();

    const w = usb.writes[0];
    expect(w.length).toBe(142);
    expect(w[5]).toBe(0x5c); // '\\' op: set time
    const fields = Array.from(w.slice(9, 17));
    const fieldOf = (t: Date, i: number): number => {
      switch (i) {
        case 0:
          return t.getDate();
        case 1:
          return t.getMonth() + 1;
        case 2:
          return t.getFullYear() % 100;
        case 3:
          return Math.floor(t.getFullYear() / 100);
        case 4:
          return t.getSeconds();
        case 5:
          return t.getMinutes();
        case 6:
          return t.getHours();
        default:
          return t.getDay() + 1;
      }
    };
    // True when v lies on the forward arc a->b around a circle of `mod`
    // (handles the 59->0 wrap for seconds/minutes).
    const onArc = (v: number, a: number, b: number, mod: number): boolean => {
      const n = (x: number) => ((x % mod) + mod) % mod;
      return n(v - a) <= n(b - a);
    };
    for (let i = 0; i < 8; i++) {
      const bcd = fields[i];
      expect(bcd >> 4).toBeLessThanOrEqual(9);
      expect(bcd & 0xf).toBeLessThanOrEqual(9);
      const decoded = (bcd >> 4) * 10 + (bcd & 0xf);
      const low = fieldOf(before, i);
      const high = fieldOf(after, i);
      if (i === 4 || i === 5) {
        expect(onArc(decoded, low, high, 60)).toBe(true);
      } else {
        expect(decoded).toBeGreaterThanOrEqual(Math.min(low, high));
        expect(decoded).toBeLessThanOrEqual(Math.max(low, high));
      }
    }
  });

  it("N15 no reply after the time command means 'not detected'", async () => {
    const a = new PS3MemCardAdaptor();
    connect(a);
    // no reply enqueued

    const { success, errorMsg } = await a.setPocketStationTime();
    expect(success).toBe(false);
    expect(errorMsg).toBe("PocketStation not detected.");
  });

  it("N16 a failed write surfaces as a USB comm error", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.failWrites(true);

    const { success, errorMsg } = await a.setPocketStationTime();
    expect(success).toBe(false);
    expect(errorMsg).toBe("USB comm error");
  });

  it("N17 name/features/type contract", () => {
    const a = new PS3MemCardAdaptor();
    expect(a.name()).toBe("PS3 MC Adaptor");
    expect(a.features()).toBe(
      SupportedFeatures.RealtimeMode | SupportedFeatures.PocketStation,
    );
    expect(a.type).toBe(Types.PS3MCA);
  });

  it("N18 card-type probe: three AA 40s (all 55 02) classify a PS2 card, no dump", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x02]));

    expect(await a.ps2ProbeCardType()).toBe("ps2");

    // Exactly three AA 40 type reads, each the 2-byte AA 40 command; no
    // frame/page dump (0x52/0x57) or PS2 page I/O is issued.
    expect(usb.writes.length).toBe(3);
    for (const w of usb.writes) {
      expect(w.length).toBe(2);
      expect(w[0]).toBe(0xaa);
      expect(w[1]).toBe(0x40);
    }
  });

  // Classification results only (the 3x AA 40 / 81 58 write pattern is asserted
  // in N18 and N19a). A stable type needs three agreeing AA 40 replies; a
  // mismatch or an invalid first reply is unclassifiable and stops early.
  it("N19 the probe classifies empty, PS1, PocketStation, and unclassifiable replies", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);

    // Empty: three stable AA 40 replies of type 00.
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x00]));
    expect(await a.ps2ProbeCardType()).toBe("empty");

    // Type 01 is PS1 or PocketStation; 81 58 (N19a) disambiguates.
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(false));
    expect(await a.ps2ProbeCardType()).toBe("ps1");

    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(true));
    expect(await a.ps2ProbeCardType()).toBe("pocketstation");

    // Mismatched AA 40 replies are unclassifiable.
    usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(new Uint8Array([0x55, 0x02]));
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    // Type 03 is invalid on AA 40 and fails on the first read.
    usb.enqueueIn(new Uint8Array([0x55, 0x03]));
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    usb.enqueueIn(new Uint8Array([0x56, 0x01])); // bad header
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    usb.enqueueIn(new Uint8Array([0x55])); // short
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    // no reply at all
    expect(await a.ps2ProbeCardType()).toBe("unknown");
  });

  it("N19a a type-01 slot is classified with 3x AA 40 + one 81 58, no dump", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(false));

    expect(await a.ps2ProbeCardType()).toBe("ps1");

    // Three 2-byte AA 40 reads, then one AA 42 n=5 (81 58) PocketStation Get ID.
    expect(usb.writes.length).toBe(4);
    for (let i = 0; i < 3; i++) {
      expect(usb.writes[i].length).toBe(2);
      expect(usb.writes[i][0]).toBe(0xaa);
      expect(usb.writes[i][1]).toBe(0x40);
    }
    const pocket = usb.writes[3];
    expect(pocket.length).toBe(9);
    expect(pocket[4]).toBe(0x81);
    expect(pocket[5]).toBe(0x58);
    // Classification only: no frame/page dump (0x52/0x57) anywhere in the writes.
    expect(usb.writes.every((w) => w[1] !== 0x52 && w[1] !== 0x57)).toBe(true);
  });

  it("N20 a USB failure during the probe classifies as unknown", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.failWrites(true);

    expect(await a.ps2ProbeCardType()).toBe("unknown");
  });

  it("N21 a disconnected adaptor probes as null", async () => {
    const a = new PS3MemCardAdaptor();

    expect(await a.ps2ProbeCardType()).toBeNull();
  });

  it("N22 checkCard reports the probed card kind", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    // Each checkCard probes with three agreeing AA 40 replies.
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x02]));
    expect(await a.checkCard()).toEqual({ present: true, kind: "ps2" });

    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(false));
    expect(await a.checkCard()).toEqual({ present: true, kind: "ps1" });

    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(true));
    expect(await a.checkCard()).toEqual({
      present: true,
      kind: "pocketstation",
    });

    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x00]));
    expect(await a.checkCard()).toEqual({
      present: false,
      message: "No memory card detected. Insert a card and try again.",
    });

    // Type 03 is invalid on AA 40: the probe fails on the first read.
    usb.enqueueIn(new Uint8Array([0x55, 0x03]));
    expect(await a.checkCard()).toEqual({
      present: false,
      message:
        "Could not detect the memory card. Try reseating the card or reconnecting.",
    });
  });

  it("N23 checkCard without a device reports not connected", async () => {
    const a = new PS3MemCardAdaptor();

    expect(await a.checkCard()).toEqual({
      present: false,
      message: "Device not connected.",
    });
  });

  it("N24 Get Specs parses a Sony 8 MB card and sends the 13-byte command", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(16384)));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "ok",
      specs: { flags: 0x2b, pageSize: 512, blockPages: 16, pageCount: 16384 },
    });

    const w = usb.writes[0];
    expect(w.length).toBe(17);
    expect(w[0]).toBe(0xaa);
    expect(w[1]).toBe(0x42);
    expect(w[2]).toBe(13);
    expect(w[4]).toBe(0x81);
    expect(w[5]).toBe(0x26);
  });

  it("N25 Get Specs all-FF (pre-auth) reports needs auth", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(new Uint8Array(13).fill(0xff)));

    expect(await a.ps2GetSpecs()).toEqual({ status: "needs-auth" });
  });

  it("N26 Get Specs with no reply reports an error", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.failWrites(true);

    expect(await a.ps2GetSpecs()).toEqual({
      status: "error",
      message: "PS2 Get Specs: no response from the card.",
    });
  });

  it("N27 ps2ReadPage assembles a 528-byte page and sends the page number", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePageRead(usb, 0x11, 0x77);

    const page = nonNull(
      await a.ps2ReadPage(5, {
        flags: 0x2b,
        pageSize: 512,
        blockPages: 16,
        pageCount: 16384,
      }),
    );
    expect(page.length).toBe(528);
    for (let i = 0; i < 512; i++) expect(page[i]).toBe((0x11 + i) & 0xff);
    for (let i = 0; i < 16; i++) expect(page[512 + i]).toBe((0x77 + i) & 0xff);

    const w = usb.writes[0];
    expect(w.length).toBe(13);
    expect(w[2]).toBe(9); // len
    expect(w[4]).toBe(0x81);
    expect(w[5]).toBe(0x23);
    expect(w[6]).toBe(5); // page number, LE byte 0
    expect(usb.writes.map((cmd) => cmd[5])).toEqual([
      0x23, 0x43, 0x43, 0x43, 0x43, 0x43, 0x81,
    ]);
  });

  it("N28 readPS2CardImage propagates needs-auth from Get Specs", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(new Uint8Array(13).fill(0xff)));

    expect(await a.readPS2CardImage(() => {})).toEqual({
      status: "needs-auth",
    });
  });

  it("N29 readPS2CardImage dumps every page into the raw image", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(2)));
    enqueuePageRead(usb, 0x00, 0xa0);
    enqueuePageRead(usb, 0x01, 0xa1);

    let progress = 0;
    const r = await a.readPS2CardImage((p) => {
      progress = p;
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.image.length).toBe(2 * 528);
    for (let i = 0; i < 512; i++) {
      expect(r.image[i]).toBe(i & 0xff);
      expect(r.image[528 + i]).toBe((0x01 + i) & 0xff);
    }
    expect(progress).toBe(1);
    expect(usb.writes[0][5]).toBe(0x28);
    expect(usb.writes[1][5]).toBe(0x27);
    expect(usb.writes[1][6]).toBe(0x5a);
    expect(usb.writes[2][5]).toBe(0x26);
  });

  it("N30 Get Specs with reset terminator 0x55 is still valid", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(16384, 0x55)));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "ok",
      specs: { flags: 0x2b, pageSize: 512, blockPages: 16, pageCount: 16384 },
    });
  });

  it("N31 Get Specs with implausible geometry is an error, not needs-auth", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const m = sonySpecsMiso(16384);
    m[3] = 0x03;
    m[4] = 0x00; // pageSize 3
    m[11] = 0;
    for (let i = 3; i < 11; i++) m[11] ^= m[i];
    usb.enqueueIn(ps2Reply(m));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "error",
      message: "PS2 Get Specs: implausible card geometry.",
    });
  });

  it("N32 without CF_USE_ECC skips the spare packet and still emits 528 bytes", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePageRead(usb, 0x11, 0x77, false);

    const data = new Uint8Array(512);
    for (let i = 0; i < 512; i++) data[i] = (0x11 + i) & 0xff;
    const page = nonNull(
      await a.ps2ReadPage(0, {
        flags: 0x2a, // 0x2B without bit 0
        pageSize: 512,
        blockPages: 16,
        pageCount: 16384,
      }),
    );
    expect(page.length).toBe(528);
    expect([...page]).toEqual([...assembleImagePage(data)]);
    expect(usb.writes.map((cmd) => cmd[5])).toEqual([
      0x23, 0x43, 0x43, 0x43, 0x43, 0x81,
    ]);
  });

  it("N33 no-ECC dump is still a 528-byte-page image", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(2, 0x5a, 0x2a)));
    enqueuePageRead(usb, 0x00, 0xa0, false);
    enqueuePageRead(usb, 0x01, 0xa1, false);

    const r = await a.readPS2CardImage(() => {});
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.specs.flags).toBe(0x2a);
    expect(r.image.length).toBe(2 * 528);
    const p0 = new Uint8Array(512);
    const p1 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      p0[i] = i & 0xff;
      p1[i] = (0x01 + i) & 0xff;
    }
    expect([...r.image.subarray(0, 528)]).toEqual([...assembleImagePage(p0)]);
    expect([...r.image.subarray(528, 1056)]).toEqual([
      ...assembleImagePage(p1),
    ]);
  });

  it("N34 ps2WritePage sends start/data/spare/end and reports success", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePageWrite(usb, true);
    const image = new Uint8Array(528);
    for (let i = 0; i < 528; i++) image[i] = (i * 7) & 0xff;
    const specs = { flags: 0x2b, pageSize: 512, blockPages: 16, pageCount: 2 };
    expect(await a.ps2WritePage(5, image, specs)).toBe(true);

    expect(usb.writes.map((w) => w[5])).toEqual([
      0x22, 0x42, 0x42, 0x42, 0x42, 0x42, 0x81,
    ]);
    const start = usb.writes[0];
    expect(start[6]).toBe(5);
    expect(start[10]).toBe(edc(start.subarray(6, 10)));
    const d0 = usb.writes[1];
    expect(d0[6]).toBe(128);
    expect([...d0.subarray(7, 135)]).toEqual([...image.subarray(0, 128)]);
    expect(d0[135]).toBe(edc(image.subarray(0, 128)));
    const d3 = usb.writes[4];
    expect([...d3.subarray(7, 135)]).toEqual([...image.subarray(384, 512)]);
    const sp = usb.writes[5];
    expect(sp[6]).toBe(16);
    expect([...sp.subarray(7, 23)]).toEqual([...image.subarray(512, 528)]);
    expect(sp[23]).toBe(edc(image.subarray(512, 528)));
  });

  it("N35 ps2WritePage without CF_USE_ECC omits the spare packet", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePageWrite(usb, false);
    const image = new Uint8Array(528);
    const specs = { flags: 0x2a, pageSize: 512, blockPages: 16, pageCount: 2 };
    expect(await a.ps2WritePage(0, image, specs)).toBe(true);
    expect(usb.writes.map((w) => w[5])).toEqual([
      0x22, 0x42, 0x42, 0x42, 0x42, 0x81,
    ]);
  });

  it("N36 writePS2CardImage erases each block before writing its pages", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(32, 0x5a, 0x2b)));
    // Page 0 is read for the Conquest check; a normal, non-Conquest pattern.
    enqueuePageRead(usb, 0x00, 0x00);
    // Two 16-page blocks: the loop must erase block 0, write its 16 pages,
    // then erase block 1 again before writing those pages.
    enqueueBlockErase(usb);
    for (let p = 0; p < 16; p++) enqueuePageWrite(usb, true);
    enqueueBlockErase(usb);
    for (let p = 0; p < 16; p++) enqueuePageWrite(usb, true);
    const image = new Uint8Array(32 * 528);
    for (let i = 0; i < image.length; i++) image[i] = (i * 3) & 0xff;
    const r = await a.writePS2CardImage(image, () => {});
    expect(r.status).toBe("ok");
    const cmds = usb.writes.map((w) => w[5]);
    // sync, specs, the page-0 Conquest check, then block 0's erase before its
    // first page write...
    expect(cmds.slice(0, 14)).toEqual([
      0x28, 0x27, 0x26, 0x23, 0x43, 0x43, 0x43, 0x43, 0x43, 0x81, 0x21, 0x82,
      0x12, 0x22,
    ]);
    // ...the erase repeats (0x21, 0x82, 0x12) right before page 16's write...
    expect(cmds.slice(125, 129)).toEqual([0x21, 0x82, 0x12, 0x22]);
    // ...and two erases + 32 page writes (+ the page-0 read) cover the card.
    expect(cmds.length).toBe(3 + 7 + 2 * 3 + 32 * 7);
  });

  it("N37 writePS2CardImage rejects a mismatched image size", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(2, 0x5a, 0x2b)));
    const r = await a.writePS2CardImage(new Uint8Array(528), () => {});
    expect(r).toMatchObject({
      status: "error",
      message: "The PS2 card image size does not match the card in the slot.",
    });
  });

  it("N38 writePS2CardImage verifies each written page", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(1, 0x5a, 0x2b)));
    enqueuePageRead(usb, 0x00, 0x00); // page-0 Conquest check
    enqueueBlockErase(usb);
    enqueuePageWrite(usb, true);
    const image = new Uint8Array(528);
    for (let i = 0; i < 528; i++) image[i] = (i * 5) & 0xff;
    enqueuePageReadEcho(usb, image);
    const r = await a.writePS2CardImage(image, () => {}, true);
    expect(r.status).toBe("ok");
  });

  it("N39 writePS2CardImage propagates needs-auth from Get Specs", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(new Uint8Array(13).fill(0xff)));

    expect(await a.writePS2CardImage(new Uint8Array(528), () => {})).toEqual({
      status: "needs-auth",
    });
  });

  it("N40 writePS2CardImage refuses a Conquest card before any erase", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(32, 0x5a, 0x2b)));
    // Page 0 opens with the Conquest magic (rest of the page 0xFF).
    const page0 = new Uint8Array(528).fill(0xff);
    page0.set(new TextEncoder().encode("Memory Card for SoulCaliburII"), 0);
    enqueuePageReadEcho(usb, page0);

    const r = await a.writePS2CardImage(new Uint8Array(32 * 528), () => {});
    expect(r).toMatchObject({
      status: "error",
      message: expect.stringContaining("Conquest"),
    });
    // The guard fires before the erase loop: specs + page-0 read, then no
    // erase (0x21/0x82) and no page write (0x22).
    const cmds = usb.writes.map((w) => w[5]);
    expect(cmds.slice(0, 4)).toEqual([0x28, 0x27, 0x26, 0x23]);
    expect(cmds).not.toContain(0x21);
    expect(cmds).not.toContain(0x82);
    expect(cmds).not.toContain(0x22);
  });

  it("N41 an erased (all-0xFF) page 0 is not Conquest and proceeds", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(1, 0x5a, 0x2b)));
    const erased = new Uint8Array(528).fill(0xff);
    enqueuePageReadEcho(usb, erased);
    enqueueBlockErase(usb);
    enqueuePageWrite(usb, true);
    const image = new Uint8Array(528);
    for (let i = 0; i < 528; i++) image[i] = (i * 3) & 0xff;
    const r = await a.writePS2CardImage(image, () => {});
    expect(r.status).toBe("ok");
    // A full block erase + one page write ran (the erased card is not refused).
    expect(usb.writes.map((w) => w[5])).toContain(0x21);
    expect(usb.writes.map((w) => w[5])).toContain(0x22);
  });

  it("N42 a failed page-0 read refuses the write before any erase", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueTerminator(usb);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(32, 0x5a, 0x2b)));
    // No page-0 read reply is enqueued, so ps2ReadPage returns null; the guard
    // must fail closed rather than erase a card it could not inspect.
    const r = await a.writePS2CardImage(new Uint8Array(32 * 528), () => {});
    expect(r).toMatchObject({ status: "error" });
    const cmds = usb.writes.map((w) => w[5]);
    expect(cmds[2]).toBe(0x26); // specs were read, then the page-0 read failed
    expect(cmds).not.toContain(0x21);
    expect(cmds).not.toContain(0x82);
    expect(cmds).not.toContain(0x22);
  });

  it("N43 start() arms interrupt IN on endpoint 3 and dispatches insert/remove", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = makeScriptedUsb();
    const events: number[] = [];
    a.onCardEvent = (ev) => events.push(ev);

    const nav = navigator as unknown as { usb?: unknown };
    const prevUsb = nav.usb;
    nav.usb = usb.usb;
    try {
      expect(await a.start("ps3mca", 0, [], () => {})).toBeNull();

      // Armed: at least one 1-byte transferIn on endpoint 3 after claim.
      expect(usb.inTransfers.some((t) => t.ep === 3 && t.length === 1)).toBe(
        true,
      );

      const tick = () => new Promise((r) => setTimeout(r, 0));
      usb.enqueueInt(0x03);
      await tick();
      usb.enqueueInt(0x01);
      await tick();
      usb.enqueueInt(0x02);
      await tick();

      expect(events).toContain(0x03);
      expect(events).toContain(0x01);
      expect(events).toContain(0x02);
      // The listener only drains endpoint 3; it never issues a bulk command
      // (no AA 40 probe) to detect the card.
      expect(usb.writes).toEqual([]);
    } finally {
      await a.stop();
      nav.usb = prevUsb;
    }
  });
});
