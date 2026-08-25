import { SupportedFeatures, Types } from "@/lib/ps1/hardware/core";
import { DexDrive } from "@/lib/ps1/hardware/dexdrive";

import {
  makeScriptedSerial,
  nonNull,
  type ScriptedSerial,
} from "./hardware-helpers";
import { equalBytes } from "./psx-helpers";

type DexShape = {
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
};
const shape = (d: DexDrive): DexShape => d as unknown as DexShape;
function inject(d: DexDrive): ScriptedSerial {
  const s = makeScriptedSerial();
  shape(d).reader =
    s.reader as unknown as ReadableStreamDefaultReader<Uint8Array>;
  shape(d).writer =
    s.writer as unknown as WritableStreamDefaultWriter<Uint8Array>;
  return s;
}

// reach the private static bit-reversal helper (typed shape, no `any`)
const revByte = (b: number): number =>
  (DexDrive as unknown as { reverseByte(i: number): number }).reverseByte(b);

function frame(fill: number): Uint8Array {
  const f = new Uint8Array(128);
  for (let i = 0; i < 128; i++) f[i] = (fill + i) & 0xff;
  return f;
}

// 133-byte read reply: IAI + 0x02 header, frame at [4], XOR at [132].
function readResponse(
  f: Uint8Array,
  frameNumber: number,
  corrupt = false,
): Uint8Array {
  let xor = ((frameNumber & 0xff) ^ ((frameNumber >> 8) & 0xff)) | 0;
  for (let i = 0; i < 128; i++) xor ^= f[i];
  const r = new Uint8Array(133);
  r[0] = 0x49;
  r[1] = 0x41;
  r[2] = 0x49;
  r[3] = 0x02;
  r.set(f, 4);
  r[132] = corrupt ? (xor ^ 0xff) & 0xff : xor;
  return r;
}

describe("P. DexDrive (Web Serial, IAI protocol)", () => {
  it("P1 bit-reversal vectors", () => {
    const vectors: [number, number][] = [
      [0x00, 0x00],
      [0x01, 0x80],
      [0x80, 0x01],
      [0xff, 0xff],
      [0x27, 0xe4],
      [0x81, 0x81],
      [0x88, 0x11],
    ];
    for (const [input, expected] of vectors)
      expect(revByte(input)).toBe(expected);
  });

  it("P2 read: IAI + READ + LSB + MSB, reply frame at [4], XOR at [132]", async () => {
    const d = new DexDrive();
    const s = inject(d);
    const f = frame(0x30);
    s.setResponder((sent) =>
      sent.length >= 6 ? readResponse(f, 0x0102) : null,
    );

    expect(equalBytes(nonNull(await d.readMemoryCardFrame(0x0102)), f)).toBe(
      true,
    );
    expect(s.written).toEqual([0x49, 0x41, 0x49, 0x02, 0x02, 0x01]);
  });

  it("P3 a bad XOR byte at [132] is rejected", async () => {
    const d = new DexDrive();
    const s = inject(d);
    s.setResponder((sent) =>
      sent.length >= 6 ? readResponse(frame(0x30), 0x0000, true) : null,
    );

    expect(await d.readMemoryCardFrame(0x0000)).toBeNull();
  });

  it("P4 write: IAI + WRITE + MSB + LSB + RevMSB + RevLSB + frame + XOR, ack at [3]", async () => {
    const d = new DexDrive();
    const s = inject(d);
    const f = frame(0x40);
    const msb = 0x02;
    const lsb = 0x01;
    const revMsb = revByte(msb);
    const revLsb = revByte(lsb);
    let xor = msb ^ lsb ^ revMsb ^ revLsb;
    for (let i = 0; i < 128; i++) xor ^= f[i];
    s.setResponder((sent) =>
      sent.length >= 137 ? new Uint8Array([0x00, 0x00, 0x00, 0x28]) : null,
    );

    expect(await d.writeMemoryCardFrame(0x0201, f)).toBe(true);

    const w = s.written;
    expect(w.length).toBe(137);
    expect(w.slice(0, 8)).toEqual([
      0x49,
      0x41,
      0x49,
      0x04,
      msb,
      lsb,
      revMsb,
      revLsb,
    ]);
    for (let i = 0; i < 128; i++) expect(w[8 + i]).toBe(f[i]);
    expect(w[136]).toBe(xor);
  });

  it("P5 WRITE_SAME (0x29) also counts as success", async () => {
    const d = new DexDrive();
    const s = inject(d);
    s.setResponder((sent) =>
      sent.length >= 137 ? new Uint8Array([0x00, 0x00, 0x00, 0x29]) : null,
    );

    expect(await d.writeMemoryCardFrame(0x0201, frame(0x40))).toBe(true);
  });

  it("P6 any other status byte fails the write", async () => {
    const d = new DexDrive();
    const s = inject(d);
    s.setResponder((sent) =>
      sent.length >= 137 ? new Uint8Array([0x00, 0x00, 0x00, 0x21]) : null,
    );

    expect(await d.writeMemoryCardFrame(0x0201, frame(0x40))).toBe(false);
  });

  it("P7 name/features/type contract", () => {
    const d = new DexDrive();
    expect(d.name()).toBe("DexDrive");
    expect(d.features()).toBe(SupportedFeatures.RealtimeMode);
    expect(d.type).toBe(Types.DexDrive);
  });
});
