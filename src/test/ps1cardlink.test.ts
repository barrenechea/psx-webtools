import { SupportedFeatures, Types } from "@/lib/ps1/hardware/core";
import { PS1CardLink } from "@/lib/ps1/hardware/ps1cardlink";

import {
  makeScriptedSerial,
  nonNull,
  type ScriptedSerial,
} from "./hardware-helpers";
import { equalBytes } from "./psx-helpers";

type SerialShape = {
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
};
const shape = (l: PS1CardLink): SerialShape => l as unknown as SerialShape;
function inject(l: PS1CardLink): ScriptedSerial {
  const s = makeScriptedSerial();
  shape(l).reader =
    s.reader as unknown as ReadableStreamDefaultReader<Uint8Array>;
  shape(l).writer =
    s.writer as unknown as WritableStreamDefaultWriter<Uint8Array>;
  return s;
}

// Point navigator.serial at a fake port backed by `s` (handshake tests only).
function stubSerial(s: ScriptedSerial) {
  const port = {
    open: async () => {},
    close: async () => {},
    setSignals: async () => {},
    readable: { getReader: () => s.reader },
    writable: { getWriter: () => s.writer },
  };
  vi.stubGlobal("navigator", {
    serial: { requestPort: async () => port },
  });
}

function frame(fill: number): Uint8Array {
  const f = new Uint8Array(128);
  for (let i = 0; i < 128; i++) f[i] = (fill + i) & 0xff;
  return f;
}

// 130-byte read reply: frame at [0], XOR at [128], status at [129].
function readResponse(
  frameNumber: number,
  f: Uint8Array,
  status = 0x47,
  corrupt = false,
): Uint8Array {
  let xor = ((frameNumber >> 8) & 0xff) ^ (frameNumber & 0xff);
  for (let i = 0; i < 128; i++) xor ^= f[i];
  const r = new Uint8Array(130);
  r.set(f, 0);
  r[128] = corrupt ? (xor ^ 0xff) & 0xff : xor;
  r[129] = status;
  return r;
}

const toBytes = (str: string) =>
  new Uint8Array(Array.from(str, (c) => c.charCodeAt(0)));

describe("O. PS1CardLink (Web Serial)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("O1 read: MCR + MSB + LSB, reply frame at [0], XOR at [128], status at [129]", async () => {
    const l = new PS1CardLink();
    const s = inject(l);
    const f = frame(0x20);
    s.setResponder((sent) =>
      sent.length >= 3 ? readResponse(0x0102, f) : null,
    );

    const result = nonNull(await l.readMemoryCardFrame(0x0102));
    expect(equalBytes(result, f)).toBe(true);
    expect(s.written).toEqual([0xa2, 0x01, 0x02]);
  });

  it("O2 a bad XOR byte is rejected", async () => {
    const l = new PS1CardLink();
    const s = inject(l);
    s.setResponder((sent) =>
      sent.length >= 3 ? readResponse(0x0102, frame(0x20), 0x47, true) : null,
    );

    expect(await l.readMemoryCardFrame(0x0102)).toBeNull();
  });

  it("O3 a status other than GOOD (0x47) is rejected", async () => {
    const l = new PS1CardLink();
    const s = inject(l);
    s.setResponder((sent) =>
      sent.length >= 3 ? readResponse(0x0102, frame(0x20), 0x4e) : null,
    );

    expect(await l.readMemoryCardFrame(0x0102)).toBeNull();
  });

  it("O4 a short reply (129 bytes) is rejected", async () => {
    vi.useFakeTimers();
    try {
      const l = new PS1CardLink();
      const s = inject(l);
      const short = readResponse(0x0102, frame(0x20));
      s.setResponder((sent) => (sent.length >= 3 ? short.slice(0, 129) : null));
      const p = l.readMemoryCardFrame(0x0102);
      await vi.advanceTimersByTimeAsync(6000);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("O5 write: MCW + MSB + LSB + frame + XOR, ack GOOD", async () => {
    const l = new PS1CardLink();
    const s = inject(l);
    const f = frame(0x30);
    let xor = 0x01 ^ 0x02;
    for (let i = 0; i < 128; i++) xor ^= f[i];
    s.setResponder((sent) =>
      sent.length >= 132 ? new Uint8Array([0x47]) : null,
    );

    expect(await l.writeMemoryCardFrame(0x0102, f)).toBe(true);

    expect(s.written.length).toBe(132);
    expect(s.written[0]).toBe(0xa3);
    expect(s.written[1]).toBe(0x01);
    expect(s.written[2]).toBe(0x02);
    for (let i = 0; i < 128; i++) expect(s.written[3 + i]).toBe(f[i]);
    expect(s.written[131]).toBe(xor);
  });

  it("O6 an ack other than GOOD fails the write", async () => {
    const l = new PS1CardLink();
    const s = inject(l);
    s.setResponder((sent) =>
      sent.length >= 132 ? new Uint8Array([0xe0]) : null,
    );

    expect(await l.writeMemoryCardFrame(0x0102, frame(0x30))).toBe(false);
  });

  it("O7 handshake v1.2: GETID/GETVER then MCPORT + slot", async () => {
    const l = new PS1CardLink();
    l.cardSlot = 2;
    const s = makeScriptedSerial();
    s.setResponder((sent) => {
      const last = sent[sent.length - 1];
      if (last === 0xa0) return toBytes("PS1CLNK");
      if (last === 0xa1) return new Uint8Array([0x12]);
      return null;
    });
    stubSerial(s);

    expect(await l.start("ps1cardlink", 115200, [], () => {})).toBeNull();
    expect(l.firmware()).toBe("1.2");
    expect(s.written).toEqual([0xa0, 0xa1, 0xa4, 0x02]);
  });

  it("O8 handshake v1.0: no MCPORT", async () => {
    const l = new PS1CardLink();
    const s = makeScriptedSerial();
    s.setResponder((sent) => {
      const last = sent[sent.length - 1];
      if (last === 0xa0) return toBytes("PS1CLNK");
      if (last === 0xa1) return new Uint8Array([0x10]);
      return null;
    });
    stubSerial(s);

    expect(await l.start("ps1cardlink", 115200, [], () => {})).toBeNull();
    expect(l.firmware()).toBe("1.0");
    expect(s.written).toEqual([0xa0, 0xa1]);
  });

  it("O9 a bad ID aborts the handshake", async () => {
    vi.useFakeTimers();
    try {
      const l = new PS1CardLink();
      const s = makeScriptedSerial();
      s.setResponder((sent) =>
        sent[sent.length - 1] === 0xa0
          ? new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05])
          : null,
      );
      stubSerial(s);
      const p = l.start("ps1cardlink", 115200, [], () => {});
      await vi.advanceTimersByTimeAsync(6000);
      const err = await p;
      expect(err).not.toBeNull();
      expect(err).toContain("not detected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("O10 name/features/type contract", () => {
    const l = new PS1CardLink();
    expect(l.name()).toBe("PS1CardLink");
    expect(l.features()).toBe(SupportedFeatures.RealtimeMode);
    expect(l.type).toBe(Types.PS1CardLink);
  });
});
