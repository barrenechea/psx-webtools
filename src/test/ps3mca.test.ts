import { SupportedFeatures, Types } from "@/lib/ps1/hardware/core";
import { PS3MemCardAdaptor } from "@/lib/ps1/hardware/ps3memcardadaptor";

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

// libmcadpt-valid 144-byte AA 42 / 81 52 response.
function readResponse(f: Uint8Array): Uint8Array {
  const m = new Uint8Array(140);
  m[2] = 0x5a;
  m[3] = 0x5d;
  m[4] = 0x00;
  m[6] = 0x5c;
  m[7] = 0x5d;
  m.set(f, 10);
  for (let i = 8; i < 138; i++) m[138] ^= m[i];
  m[139] = 0x47;
  return ps2Reply(m);
}

// libmcadpt-valid 142-byte AA 42 / 81 57 response.
function ack(cardStatus = 0x47, usbStatus = 0x5a): Uint8Array {
  const m = new Uint8Array(138);
  m[2] = 0x5a;
  m[3] = 0x5d;
  m[135] = 0x5c;
  m[136] = 0x5d;
  m[137] = cardStatus;
  const r = ps2Reply(m);
  r[1] = usbStatus;
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

function pocketMemoryReply(frame: Uint8Array): Uint8Array {
  const miso = new Uint8Array(138);
  miso.set(frame, 10);
  return ps2Reply(miso);
}

function enqueueProbeSuccess(usb: ScriptedUsb): void {
  const m = new Uint8Array(4);
  m[2] = 0x2b;
  m[3] = 0x55;
  usb.enqueueIn(ps2Reply(m));
}

function enqueueProbeFailure(usb: ScriptedUsb): void {
  usb.enqueueIn(new Uint8Array([0x55, 0xaf]));
}

function enqueuePs2Type(usb: ScriptedUsb): void {
  for (let i = 0; i < 3; i++) {
    usb.enqueueIn(new Uint8Array([0x55, 0x02]));
  }
}

function enqueuePs2Open(usb: ScriptedUsb, specs: Uint8Array): void {
  enqueuePs2Type(usb);
  enqueueProbeSuccess(usb);
  usb.enqueueIn(ps2Reply(specs));
}

function sonySpecsMiso(
  pageCount: number,
  term = 0x55,
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

function bulkOp(w: Uint8Array): number {
  if (w[1] === 0x52 || w[1] === 0x57) return w[1];
  return w[5];
}

function patternPage(pattern: number, ecc: number): Uint8Array {
  const p = new Uint8Array(528);
  for (let i = 0; i < 512; i++) p[i] = (pattern + i) & 0xff;
  for (let i = 0; i < 16; i++) p[512 + i] = (ecc + i) & 0xff;
  return p;
}

function enqueueUsbPageRead(
  usb: ScriptedUsb,
  pattern: number,
  ecc: number,
): void {
  const r = new Uint8Array(0x214);
  r[0] = 0x55;
  r[1] = 0x5a;
  r[2] = 0x10;
  r[3] = 0x02;
  r.set(patternPage(pattern, ecc), 4);
  usb.enqueueIn(r);
}

function enqueueUsbPageWrite(usb: ScriptedUsb): void {
  usb.enqueueIn(new Uint8Array([0x55, 0x5a]));
}

function enqueueUsbPageReadEcho(usb: ScriptedUsb, imagePage: Uint8Array): void {
  const r = new Uint8Array(0x214);
  r[0] = 0x55;
  r[1] = 0x5a;
  r[2] = 0x10;
  r[3] = 0x02;
  r.set(imagePage.subarray(0, 528), 4);
  usb.enqueueIn(r);
}

function enqueueUsbPageUnsupported(usb: ScriptedUsb): void {
  usb.enqueueIn(new Uint8Array([0x55, 0xff]));
}

// SIO replies for one block erase (libmcadpt): start erase (0x21, 2B + term
// [8]) then commit (0x81, 2B + term [3]).
function enqueueBlockErase(usb: ScriptedUsb): void {
  const start = new Uint8Array(9);
  start[0] = 0x81;
  start[1] = 0x21;
  start[7] = 0x2b;
  start[8] = 0x55;
  usb.enqueueIn(ps2Reply(start));
  const end = new Uint8Array(4);
  end[0] = 0x81;
  end[1] = 0x81;
  end[2] = 0x2b;
  end[3] = 0x55;
  usb.enqueueIn(ps2Reply(end));
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

  it("N3a libmcadpt ignores byte zero of a valid bulk reply", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const expected = frame(0x10);
    const resp = readResponse(expected);
    resp[0] = 0x00;
    usb.enqueueIn(resp);

    expect(equalBytes(nonNull(await a.readMemoryCardFrame(0)), expected)).toBe(
      true,
    );
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

  it("N7 a bad write reply fails without a retry", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x30);
    usb.enqueueIn(ack(0x4e));
    usb.enqueueIn(ack());

    expect(await a.writeMemoryCardFrame(0, f)).toBe(false);
    expect(usb.writes.length).toBe(1);
  });

  it("N8 a wrong AA 42 echoed length is rejected", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const r = readResponse(frame(0x30));
    r[2]--;
    usb.enqueueIn(r);
    expect(await a.readMemoryCardFrame(0)).toBeNull();
  });

  it("N9 reads the PocketStation serial through one strict 81 5B transfer", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const frame = new Uint8Array(128);
    frame.set([0x11, 0x22, 0x33, 0x44]);
    usb.enqueueIn(pocketMemoryReply(frame));

    expect(await a.readPocketStationSerial()).toEqual({
      serial: 0x44332211,
      errorMsg: null,
    });
    const w = usb.writes[0];
    expect(w.length).toBe(142);
    expect([...w.subarray(0, 7)]).toEqual([
      0xaa, 0x42, 0x8a, 0x00, 0x81, 0x5b, 0x01,
    ]);
    expect([...w.subarray(8, 13)]).toEqual([0x00, 0x03, 0x00, 0x06, 0x80]);
  });

  it("N10 rejects a short PocketStation memory reply", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(new Uint8Array(141));

    expect(await a.readPocketStationSerial()).toEqual({
      serial: 0,
      errorMsg: "PocketStation not detected.",
    });
  });

  it("N11 reads BIOS part N at 0x04000000 + N*128", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x50);
    usb.enqueueIn(pocketMemoryReply(f));

    expect(equalBytes(nonNull(await a.dumpPocketStationBIOS(3)), f)).toBe(true);
    expect([...usb.writes[0].subarray(8, 13)]).toEqual([
      0x80, 0x01, 0x00, 0x04, 0x80,
    ]);
  });

  it("N12 returns BIOS bytes unchanged without a shifted-read fallback", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const f = frame(0x50);
    f[127] = 0x47;
    usb.enqueueIn(pocketMemoryReply(f));

    expect(nonNull(await a.dumpPocketStationBIOS(0))[127]).toBe(0x47);
    expect(usb.writes.length).toBe(1);
  });

  it("N14 writes the PocketStation clock as BCD through one 81 5C transfer", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(new Uint8Array(138)));

    expect(await a.setPocketStationTime()).toEqual({
      success: true,
      errorMsg: null,
    });
    const w = usb.writes[0];
    expect(w.length).toBe(142);
    expect(w[5]).toBe(0x5c);
    for (const bcd of w.subarray(9, 17)) {
      expect(bcd >> 4).toBeLessThanOrEqual(9);
      expect(bcd & 0x0f).toBeLessThanOrEqual(9);
    }
  });

  it("N15 a missing PocketStation clock reply fails", async () => {
    const a = new PS3MemCardAdaptor();
    connect(a);
    expect(await a.setPocketStationTime()).toEqual({
      success: false,
      errorMsg: "PocketStation not detected.",
    });
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
    usb.enqueueIn(readResponse(frame(0x10)));
    expect(await a.ps2ProbeCardType()).toBe("ps1");

    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(true));
    usb.enqueueIn(readResponse(frame(0x20)));
    expect(await a.ps2ProbeCardType()).toBe("pocketstation");

    // Mismatched AA 40 replies are unclassifiable.
    usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(new Uint8Array([0x55, 0x02]));
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    // Type 03 is invalid on AA 40 and fails on the first read.
    usb.enqueueIn(new Uint8Array([0x55, 0x03]));
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    // libmcadpt consumes only response byte 1 for AA 40.
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x56, 0x01]));
    usb.enqueueIn(pocketIdReply(false));
    usb.enqueueIn(readResponse(frame(0x30)));
    expect(await a.ps2ProbeCardType()).toBe("ps1");

    usb.enqueueIn(new Uint8Array([0x55])); // short
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    // no reply at all
    expect(await a.ps2ProbeCardType()).toBe("unknown");
  });

  it("N19a a type-01 slot is classified with 3x AA 40, 81 58, and frame 0", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(false));
    usb.enqueueIn(readResponse(frame(0x10)));

    expect(await a.ps2ProbeCardType()).toBe("ps1");

    // Three AA 40 reads, PocketStation ID, then libmcadpt's frame-0 check.
    expect(usb.writes.length).toBe(5);
    for (let i = 0; i < 3; i++) {
      expect(usb.writes[i].length).toBe(2);
      expect(usb.writes[i][0]).toBe(0xaa);
      expect(usb.writes[i][1]).toBe(0x40);
    }
    const pocket = usb.writes[3];
    expect(pocket.length).toBe(9);
    expect(pocket[4]).toBe(0x81);
    expect(pocket[5]).toBe(0x58);
    expect(usb.writes[4][1]).toBe(0x42);
    expect(usb.writes[4][5]).toBe(0x52);
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
    usb.enqueueIn(readResponse(frame(0x10)));
    expect(await a.checkCard()).toEqual({ present: true, kind: "ps1" });

    for (let i = 0; i < 3; i++) usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    usb.enqueueIn(pocketIdReply(true));
    usb.enqueueIn(readResponse(frame(0x20)));
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

  it("N24a Get Specs preserves the full 32-bit page count", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(0x01020304)));

    expect(await a.ps2GetSpecs()).toMatchObject({
      status: "ok",
      specs: { pageCount: 0x01020304 },
    });
  });

  it("N25 Get Specs all-FF is an invalid response", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(new Uint8Array(13).fill(0xff)));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "error",
      message: "PS2 Get Specs: invalid card response.",
    });
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

  it("N27 ps2ReadPage uses USB AA 52 and copies 528 bytes", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueUsbPageRead(usb, 0x11, 0x77);

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
    expect(w.length).toBe(9);
    expect(w[0]).toBe(0xaa);
    expect(w[1]).toBe(0x52);
    expect(w[2]).toBe(0x03);
    expect(w[3]).toBe(5);
    expect(w[7]).toBe(0x55);
    expect(w[8]).toBe(0x2b);
    expect(usb.writes.map(bulkOp)).toEqual([0x52]);
  });

  it("N27a AA 52 also ignores response byte zero", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const reply = new Uint8Array(0x214);
    reply[0] = 0x00;
    reply[1] = 0x5a;
    reply[2] = 0x10;
    reply[3] = 0x02;
    usb.enqueueIn(reply);

    expect(
      await a.ps2ReadPage(0, {
        flags: 0x2b,
        pageSize: 512,
        blockPages: 16,
        pageCount: 16384,
      }),
    ).not.toBeNull();
  });

  it("N27b AA 52 preserves page addresses above the OFW 8 MB cap", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueUsbPageRead(usb, 0x00, 0x00);

    expect(
      await a.ps2ReadPage(0x01020304, {
        flags: 0x2b,
        pageSize: 512,
        blockPages: 16,
        pageCount: 0x01020305,
      }),
    ).not.toBeNull();
    expect([...usb.writes[0].subarray(3, 7)]).toEqual([4, 3, 2, 1]);
  });

  it("N27c AA 52 rejects bad status, bad payload length, and a short reply", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const specs = {
      flags: 0x2b,
      pageSize: 512,
      blockPages: 16,
      pageCount: 16384,
    };
    const badStatus = new Uint8Array(0x214);
    badStatus[1] = 0xff;
    badStatus[2] = 0x10;
    badStatus[3] = 0x02;
    usb.enqueueIn(badStatus);
    expect(await a.ps2ReadPage(0, specs)).toBeNull();

    const badLength = new Uint8Array(0x214);
    badLength[1] = 0x5a;
    badLength[2] = 0x0f;
    badLength[3] = 0x02;
    usb.enqueueIn(badLength);
    expect(await a.ps2ReadPage(0, specs)).toBeNull();

    usb.enqueueIn(new Uint8Array(0x213));
    expect(await a.ps2ReadPage(0, specs)).toBeNull();
    expect(usb.writes).toHaveLength(3);
  });

  it("N28 readPS2CardImage requires auth after Probe failure", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Type(usb);
    enqueueProbeFailure(usb);

    expect(await a.readPS2CardImage(() => {})).toEqual({
      status: "needs-auth",
    });
  });

  it("N29 readPS2CardImage dumps every page into the raw image", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(2));
    enqueueUsbPageRead(usb, 0x00, 0xa0);
    enqueueUsbPageRead(usb, 0x01, 0xa1);

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
    expect(usb.writes.slice(0, 3).every((w) => w[1] === 0x40)).toBe(true);
    expect(usb.writes[3][5]).toBe(0x11);
    expect(usb.writes[4][5]).toBe(0x26);
    expect(usb.writes.slice(5).map(bulkOp)).toEqual([0x52, 0x52]);
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

  it("N31 Get Specs returns wire-valid geometry without a PC plausibility filter", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const m = sonySpecsMiso(16384);
    m[3] = 0x03;
    m[4] = 0x00; // pageSize 3
    m[11] = 0;
    for (let i = 3; i < 11; i++) m[11] ^= m[i];
    usb.enqueueIn(ps2Reply(m));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "ok",
      specs: { flags: 0x2b, pageSize: 3, blockPages: 16, pageCount: 16384 },
    });
  });

  it("N32 AA 52 failure does not fall back to AA 42", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueUsbPageUnsupported(usb);

    expect(
      await a.ps2ReadPage(0, {
        flags: 0x2b,
        pageSize: 512,
        blockPages: 16,
        pageCount: 16384,
      }),
    ).toBeNull();
    expect(usb.writes.map(bulkOp)).toEqual([0x52]);
  });

  it("N33 Get Specs MISO[2] not '+' is invalid", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(16384, 0x55, 0x2a)));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "error",
      message: "PS2 Get Specs: invalid card response.",
    });
  });

  it("N33b Get Specs terminator 0x5A is invalid", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(ps2Reply(sonySpecsMiso(16384, 0x5a)));

    expect(await a.ps2GetSpecs()).toEqual({
      status: "error",
      message: "PS2 Get Specs: invalid card response.",
    });
  });

  it("N34 ps2WritePage sends USB AA 57 and reports success", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueUsbPageWrite(usb);
    const image = new Uint8Array(528);
    for (let i = 0; i < 528; i++) image[i] = (i * 7) & 0xff;
    const specs = { flags: 0x2b, pageSize: 512, blockPages: 16, pageCount: 2 };
    expect(await a.ps2WritePage(5, image, specs)).toBe(true);

    const w = usb.writes[0];
    expect(w.length).toBe(0x219);
    expect(w[0]).toBe(0xaa);
    expect(w[1]).toBe(0x57);
    expect(w[2]).toBe(0x03);
    expect(w[3]).toBe(5);
    expect([...w.subarray(7, 7 + 528)]).toEqual([...image]);
    expect(w[7 + 528]).toBe(0x55);
    expect(w[8 + 528]).toBe(0x2b);
    expect(usb.writes.map(bulkOp)).toEqual([0x57]);
  });

  it("N35 AA 57 failure does not fall back to AA 42", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueUsbPageUnsupported(usb);
    const image = new Uint8Array(528);
    const specs = { flags: 0x2b, pageSize: 512, blockPages: 16, pageCount: 2 };
    expect(await a.ps2WritePage(0, image, specs)).toBe(false);
    expect(usb.writes.map(bulkOp)).toEqual([0x57]);
  });

  it("N35a erase accepts a block above OFW's 8 MB cap", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueueBlockErase(usb);
    const specs = {
      flags: 0x2b,
      pageSize: 512,
      blockPages: 16,
      pageCount: 32768,
    };

    expect(await a.ps2EraseBlock(0x400, specs)).toBe(true);
    const start = usb.writes[0].subarray(4);
    expect([...start.subarray(2, 6)]).toEqual([0x00, 0x40, 0x00, 0x00]);
  });

  it("N36 writePS2CardImage erases each block before writing its pages", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(32));
    enqueueUsbPageRead(usb, 0x00, 0x00);
    enqueueBlockErase(usb);
    for (let p = 0; p < 16; p++) enqueueUsbPageWrite(usb);
    enqueueBlockErase(usb);
    for (let p = 0; p < 16; p++) enqueueUsbPageWrite(usb);
    const image = new Uint8Array(32 * 528);
    for (let i = 0; i < image.length; i++) image[i] = (i * 3) & 0xff;
    const r = await a.writePS2CardImage(image, () => {});
    expect(r.status).toBe("ok");
    const cmds = usb.writes.map(bulkOp);
    expect(cmds.slice(0, 9)).toEqual([
      undefined,
      undefined,
      undefined,
      0x11,
      0x26,
      0x52,
      0x21,
      0x81,
      0x57,
    ]);
    expect(cmds.slice(24, 27)).toEqual([0x21, 0x81, 0x57]);
    expect(cmds).not.toContain(0x82);
    expect(cmds).not.toContain(0x12);
    expect(cmds.length).toBe(5 + 1 + 2 + 16 + 2 + 16);
  });

  it("N37 writePS2CardImage rejects a mismatched image size", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(16));
    const r = await a.writePS2CardImage(new Uint8Array(528), () => {});
    expect(r).toMatchObject({
      status: "error",
      message: "The PS2 card image size does not match the card in the slot.",
    });
  });

  it("N38 writePS2CardImage does not add a PC-only verify pass", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(16));
    enqueueUsbPageRead(usb, 0x00, 0x00);
    enqueueBlockErase(usb);
    for (let p = 0; p < 16; p++) enqueueUsbPageWrite(usb);
    const image = new Uint8Array(16 * 528);
    for (let i = 0; i < 528; i++) image[i] = (i * 5) & 0xff;
    const r = await a.writePS2CardImage(image, () => {}, true);
    expect(r.status).toBe("ok");
    expect(usb.writes.map(bulkOp).filter((op) => op === 0x52)).toHaveLength(1);
  });

  it("N39 writePS2CardImage requires auth after Probe failure", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Type(usb);
    enqueueProbeFailure(usb);

    expect(await a.writePS2CardImage(new Uint8Array(528), () => {})).toEqual({
      status: "needs-auth",
    });
  });

  it("N40 writePS2CardImage refuses a Conquest card before any erase", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(32));
    const page0 = new Uint8Array(528).fill(0xff);
    page0.set(new TextEncoder().encode("Memory Card for SoulCaliburII"), 0);
    enqueueUsbPageReadEcho(usb, page0);

    const r = await a.writePS2CardImage(new Uint8Array(32 * 528), () => {});
    expect(r).toMatchObject({
      status: "error",
      message: expect.stringContaining("Conquest"),
    });
    const cmds = usb.writes.map(bulkOp);
    expect(cmds.slice(3, 6)).toEqual([0x11, 0x26, 0x52]);
    expect(cmds).not.toContain(0x21);
    expect(cmds).not.toContain(0x82);
    expect(cmds).not.toContain(0x57);
    expect(cmds).not.toContain(0x22);
  });

  it("N41 an erased (all-0xFF) page 0 is not Conquest and proceeds", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(16));
    const erased = new Uint8Array(528).fill(0xff);
    enqueueUsbPageReadEcho(usb, erased);
    enqueueBlockErase(usb);
    for (let p = 0; p < 16; p++) enqueueUsbPageWrite(usb);
    const image = new Uint8Array(16 * 528);
    for (let i = 0; i < 528; i++) image[i] = (i * 3) & 0xff;
    const r = await a.writePS2CardImage(image, () => {});
    expect(r.status).toBe("ok");
    expect(usb.writes.map(bulkOp)).toContain(0x21);
    expect(usb.writes.map(bulkOp)).toContain(0x57);
  });

  it("N42 a failed page-0 read refuses the write before any erase", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    enqueuePs2Open(usb, sonySpecsMiso(32));
    const r = await a.writePS2CardImage(new Uint8Array(32 * 528), () => {});
    expect(r).toMatchObject({ status: "error" });
    const cmds = usb.writes.map(bulkOp);
    expect(cmds[4]).toBe(0x26);
    expect(cmds).not.toContain(0x21);
    expect(cmds).not.toContain(0x82);
    expect(cmds).not.toContain(0x57);
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
