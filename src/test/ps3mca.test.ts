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

  it("N18 card-type probe: AA 40 command, 55 02 reply classifies a PS2 card", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(new Uint8Array([0x55, 0x02]));

    expect(await a.ps2ProbeCardType()).toBe("ps2");

    expect(usb.writes.length).toBe(1);
    const w = usb.writes[0];
    expect(w.length).toBe(2);
    expect(w[0]).toBe(0xaa);
    expect(w[1]).toBe(0x40);
  });

  it("N19 the probe classifies empty, PS1, and unclassifiable replies", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(new Uint8Array([0x55, 0x00]));
    expect(await a.ps2ProbeCardType()).toBe("empty");

    usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    expect(await a.ps2ProbeCardType()).toBe("ps1");

    usb.enqueueIn(new Uint8Array([0x55, 0x03]));
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    usb.enqueueIn(new Uint8Array([0x56, 0x01])); // bad header
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    usb.enqueueIn(new Uint8Array([0x55])); // short
    expect(await a.ps2ProbeCardType()).toBe("unknown");

    // no reply at all
    expect(await a.ps2ProbeCardType()).toBe("unknown");
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
    usb.enqueueIn(new Uint8Array([0x55, 0x02]));

    expect(await a.checkCard()).toEqual({ present: true, kind: "ps2" });

    usb.enqueueIn(new Uint8Array([0x55, 0x01]));
    expect(await a.checkCard()).toEqual({ present: true, kind: "ps1" });

    usb.enqueueIn(new Uint8Array([0x55, 0x00]));
    expect(await a.checkCard()).toEqual({
      present: false,
      message: "No memory card detected. Insert a card and try again.",
    });

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
});
