import { SupportedFeatures, Types } from "@/lib/ps1/hardware/core";
import { Unirom } from "@/lib/ps1/hardware/unirom";

import {
  makeScriptedSerial,
  nonNull,
  type ScriptedSerial,
} from "./hardware-helpers";
import { equalBytes } from "./psx-helpers";

type UniromShape = {
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  uint32ToBytes(value: number): Uint8Array;
};
const shape = (u: Unirom): UniromShape => u as unknown as UniromShape;
function inject(u: Unirom): ScriptedSerial {
  const s = makeScriptedSerial();
  shape(u).reader =
    s.reader as unknown as ReadableStreamDefaultReader<Uint8Array>;
  shape(u).writer =
    s.writer as unknown as WritableStreamDefaultWriter<Uint8Array>;
  return s;
}

const toBytes = (str: string) =>
  new Uint8Array(Array.from(str, (c) => c.charCodeAt(0)));

function frame(fill: number): Uint8Array {
  const f = new Uint8Array(128);
  for (let i = 0; i < 128; i++) f[i] = fill;
  return f;
}

// 12-byte MCRD reply: [0..4) unused, address LE at [4..8), size LE at [8..12).
function mcrdReply(): Uint8Array {
  return new Uint8Array([
    0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x20, 0x00,
  ]);
}

describe("Q. Unirom (Web Serial, v2 protocol)", () => {
  it("Q1 uint32ToBytes emits little-endian", () => {
    const u = new Unirom();
    const le32 = (v: number) => Array.from(shape(u).uint32ToBytes(v));
    expect(le32(0)).toEqual([0x00, 0x00, 0x00, 0x00]);
    expect(le32(1)).toEqual([0x01, 0x00, 0x00, 0x00]);
    expect(le32(0x06000300)).toEqual([0x00, 0x03, 0x00, 0x06]);
  });

  it("Q2 first chunk: LE32(total size) + LE32(last checksum) prefix, then chunk, then LE32(byte sum)", async () => {
    const u = new Unirom();
    const s = inject(u);
    s.push(toBytes("CHEK"));
    s.push(toBytes("MORE"));
    const f = frame(0x01);
    for (let fn = 0; fn < 16; fn++) {
      expect(await u.writeMemoryCardFrame(fn, f)).toBe(true);
    }

    const w = s.written;
    expect(w.length).toBe(8 + 2048 + 4);
    // First-run size prefix = total card bytes (frameCount * 128).
    expect(w.slice(0, 4)).toEqual([0x00, 0x00, 0x02, 0x00]); // 0x20000 LE
    expect(w.slice(4, 8)).toEqual([0x00, 0x00, 0x00, 0x00]); // lastChecksum 0
    for (let i = 0; i < 2048; i++) expect(w[8 + i]).toBe(0x01);
    expect(w.slice(8 + 2048, 8 + 2048 + 4)).toEqual([0x00, 0x08, 0x00, 0x00]); // sum 2048 LE
  });

  it("Q3 subsequent chunk has no prefix", async () => {
    const u = new Unirom();
    const s = inject(u);
    s.push(toBytes("CHEK"));
    s.push(toBytes("MORE"));
    const f = frame(0x01);
    for (let fn = 0; fn < 16; fn++) await u.writeMemoryCardFrame(fn, f);
    s.written.length = 0;

    s.push(toBytes("CHEK"));
    s.push(toBytes("MORE"));
    for (let fn = 16; fn < 32; fn++) {
      expect(await u.writeMemoryCardFrame(fn, f)).toBe(true);
    }

    const w = s.written;
    expect(w.length).toBe(2048 + 4);
    for (let i = 0; i < 2048; i++) expect(w[i]).toBe(0x01);
    expect(w.slice(2048, 2048 + 4)).toEqual([0x00, 0x08, 0x00, 0x00]);
  });

  it("Q4 an ERR! reply fails the chunk", async () => {
    vi.useFakeTimers();
    try {
      const u = new Unirom();
      const s = inject(u);
      s.push(toBytes("CHEK"));
      s.push(toBytes("ERR!"));
      const f = frame(0x01);
      for (let fn = 0; fn < 15; fn++) {
        expect(await u.writeMemoryCardFrame(fn, f)).toBe(true);
      }
      const p = u.writeMemoryCardFrame(15, f);
      await vi.advanceTimersByTimeAsync(1100);
      await expect(p).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Q5 first read: 12-byte MCRD reply, DUMP + address + size handshake", async () => {
    const u = new Unirom();
    const s = inject(u);
    s.push(mcrdReply()); // 12 bytes
    s.push(new Uint8Array(16)); // 16-byte dump handshake
    s.push(frame(0xf1)); // frame 0
    const result = await u.readMemoryCardFrame(0);

    expect(u.storedInRam).toBe(true);
    const w = s.written;
    expect(w.length).toBe(12);
    expect(w.slice(0, 4)).toEqual([0x44, 0x55, 0x4d, 0x50]); // "DUMP"
    expect(w.slice(4, 8)).toEqual([0x00, 0x00, 0x04, 0x00]); // address LE
    expect(w.slice(8, 12)).toEqual([0x00, 0x00, 0x20, 0x00]); // size LE
    // TS falls through and returns the frame (the caller can't retry on null)
    expect(equalBytes(nonNull(result), frame(0xf1))).toBe(true);
  });

  it("Q6 a stored frame comes straight from the stream", async () => {
    const u = new Unirom();
    const s = inject(u);
    u.storedInRam = true;
    s.push(frame(0xf1));

    expect(
      equalBytes(nonNull(await u.readMemoryCardFrame(0)), frame(0xf1)),
    ).toBe(true);
    expect(s.written.length).toBe(0);
  });

  it("Q7 every 16th frame requests MORE first", async () => {
    const u = new Unirom();
    const s = inject(u);
    u.storedInRam = true;
    s.push(frame(0xf1));

    const result = await u.readMemoryCardFrame(16);
    expect(result).not.toBeNull();
    expect(s.written).toEqual([0x4d, 0x4f, 0x52, 0x45]); // "MORE"
  });

  it("Q8 the last frame (1023) is followed by MORE + 4-byte checksum", async () => {
    const u = new Unirom();
    const s = inject(u);
    u.storedInRam = true;
    s.push(frame(0xf1));
    s.push(new Uint8Array([0x01, 0x02, 0x03, 0x04]));

    const result = await u.readMemoryCardFrame(1023);
    expect(result).not.toBeNull();
    expect(s.written).toEqual([0x4d, 0x4f, 0x52, 0x45]); // "MORE"
    expect(u.lastChecksum).toBe(0x04030201);
  });

  it("Q9 name/features/type contract", () => {
    const u = new Unirom();
    expect(u.name()).toBe("Unirom");
    expect(u.features()).toBe(SupportedFeatures.TcpMode);
    expect(u.type).toBe(Types.UniROM);
  });
});
