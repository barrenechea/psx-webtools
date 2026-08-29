import { crc32 } from "@/lib/crc32";
import { MODE_DIR, MODE_EXISTS, MODE_FILE } from "@/lib/ps2/ps2-pfs";
import { PS2SAVE_CBS_RC4S, rc4Crypt } from "@/lib/ps2/ps2-rc4";
import {
  containerFormatToExtension,
  detectPs2Container,
  type Ps2Container,
  Ps2ContainerFormat,
  readPs2Container,
  writePs2Container,
} from "@/lib/ps2/ps2-single-save";

const DF_RWX = 0x0007;
const DF_0400 = 0x0400;
const DIR_MODE = DF_RWX | MODE_DIR | DF_0400 | MODE_EXISTS;
const FILE_MODE = DF_RWX | MODE_FILE | DF_0400 | MODE_EXISTS;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const eq = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const setU16 = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
};

const setU32 = (b: Uint8Array, o: number, v: number): void => {
  const x = v >>> 0;
  b[o] = x & 0xff;
  b[o + 1] = (x >> 8) & 0xff;
  b[o + 2] = (x >> 16) & 0xff;
  b[o + 3] = (x >> 24) & 0xff;
};

const swap16 = (x: number): number =>
  (((x << 8) & 0xff00) | ((x >> 8) & 0xff)) & 0xffff;

const nameAt = (b: Uint8Array, o: number, name: string): void => {
  const n = enc(name);
  for (let i = 0; i < 32; i++) b[o + i] = i < n.length ? n[i] : 0;
};

// Compress with the Web CompressionStream so the test shares the same API
// family (and environment) as the inflate used by the CodeBreaker reader.
async function deflateWeb(data: Uint8Array): Promise<Uint8Array> {
  const compressor = new CompressionStream("deflate");
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(compressor);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const total = arrs.reduce((a, r) => a + r.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const r of arrs) {
    out.set(r, off);
    off += r.length;
  }
  return out;
};

interface RawFile {
  name: string;
  data: Uint8Array;
}

// --- SharkPort / X-Port -----------------------------------------------------

function buildSharkPort(files: RawFile[], dirname: string): Uint8Array {
  const dirlen = files.length + 2;
  const hlen = 124;
  const fhlen = 124;
  const p: number[] = [];
  const push = (b: Uint8Array): void => {
    for (const x of b) p.push(x);
  };
  push(new Uint8Array([13, 0, 0, 0, ...enc("SharkPortSave")]));
  setU32Into(p, 0);
  const dn = enc(dirname);
  setU32Into(p, dn.length);
  push(dn);
  setU32Into(p, 0); // datestamp_len
  setU32Into(p, 0); // comment_len
  setU32Into(p, 0); // flen
  p.push(hlen & 0xff, (hlen >> 8) & 0xff); // hlen
  push(new Uint8Array(64)); // name
  setU32Into(p, dirlen);
  push(new Uint8Array(8));
  p.push(swap16(DIR_MODE) & 0xff, (swap16(DIR_MODE) >> 8) & 0xff);
  push(new Uint8Array(2));
  push(new Uint8Array(8)); // created
  push(new Uint8Array(8)); // modified
  push(new Uint8Array(hlen - 98));
  for (const f of files) {
    p.push(fhlen & 0xff, (fhlen >> 8) & 0xff); // fhlen
    const nm = enc(f.name);
    const nb = new Uint8Array(64);
    nb.set(nm.subarray(0, 64));
    push(nb);
    setU32Into(p, f.data.length);
    push(new Uint8Array(8));
    p.push(swap16(FILE_MODE) & 0xff, (swap16(FILE_MODE) >> 8) & 0xff);
    push(new Uint8Array(2));
    push(new Uint8Array(8)); // created
    push(new Uint8Array(8)); // modified
    push(new Uint8Array(fhlen - 98));
    push(f.data);
  }
  return new Uint8Array(p);
}

function setU32Into(arr: number[], v: number): void {
  const x = v >>> 0;
  arr.push(x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >> 24) & 0xff);
}

// --- CodeBreaker (.cbs) -----------------------------------------------------

async function buildCodeBreaker(
  files: RawFile[],
  dirname: string,
): Promise<Uint8Array> {
  let blob: Uint8Array = new Uint8Array(0);
  for (const f of files) {
    const hdr = new Uint8Array(64);
    // created @0, modified @8 (zero)
    setU32(hdr, 16, f.data.length); // fsize
    setU16(hdr, 20, FILE_MODE); // fmode
    nameAt(hdr, 32, f.name);
    blob = concat(blob, hdr, f.data);
  }
  const zlibBody = await deflateWeb(blob);
  const body = rc4Crypt(PS2SAVE_CBS_RC4S, zlibBody);

  const hlen = 124;
  const header = new Uint8Array(hlen - 12); // 112
  setU32(header, 0, 0); // dlen (unused by reader)
  setU32(header, 4, body.length); // flen
  const dn = enc(dirname);
  for (let i = 0; i < 32; i++) header[8 + i] = i < dn.length ? dn[i] : 0;
  // created @40, modified @48, dirmode @64
  setU32(header, 64, DIR_MODE);

  return concat(
    enc("CFU\0"),
    new Uint8Array([0, 0, 0, 0]), // d04
    new Uint8Array([
      hlen & 0xff,
      (hlen >> 8) & 0xff,
      (hlen >> 16) & 0xff,
      (hlen >> 24) & 0xff,
    ]),
    header,
    body,
  );
}

// --- PSV (.psv) -------------------------------------------------------------

function buildPsv1(data: Uint8Array, title: string): Uint8Array {
  const saveOffset = 256;
  const out = new Uint8Array(saveOffset + data.length);
  out[0] = 0;
  out[1] = 0x56; // V
  out[2] = 0x53; // S
  out[3] = 0x50; // P
  setU32(out, 4, 0); // version
  setU32(out, 56, 0); // next_section_size
  setU32(out, 60, 1); // savetype
  setU32(out, 64, data.length); // save_size
  setU32(out, 68, saveOffset); // save_offset
  const t = enc(title);
  for (let i = 0; i < 20; i++) out[100 + i] = i < t.length ? t[i] : 0;
  out.set(data, saveOffset);
  return out;
}

function buildPsv2(files: RawFile[], title: string): Uint8Array {
  // 0x40 psv header, 0x40..0x68 ten u32s (numberOfFiles at 0x64),
  // 0x68 directory (0x38), file records at 0xA0.
  const entriesStart = 0xa0;
  const entriesEnd = entriesStart + files.length * 60;
  const dataStart = Math.max(256, entriesEnd);
  const totalData = files.reduce((a, f) => a + f.data.length, 0);
  const out = new Uint8Array(dataStart + totalData);
  out[0] = 0;
  out[1] = 0x56;
  out[2] = 0x53;
  out[3] = 0x50;
  setU32(out, 4, 0); // version
  setU32(out, 56, 0); // next_section_size
  setU32(out, 60, 2); // savetype
  setU32(out, 0x60, 0xdeadbeef); // icon3Size decoy: must not be read as filesCount
  setU32(out, 0x64, files.length); // numberOfFiles
  setU32(out, 0x7c, MODE_DIR | MODE_EXISTS); // rootMode
  const t = enc(title);
  for (let i = 0; i < 32; i++) out[0x80 + i] = i < t.length ? t[i] : 0;
  let off = dataStart;
  for (let i = 0; i < files.length; i++) {
    const e = entriesStart + i * 60;
    setU32(out, e + 16, files[i].data.length); // fileSize
    setU32(out, e + 20, MODE_FILE | MODE_EXISTS); // fileMode
    const nm = enc(files[i].name);
    for (let j = 0; j < 32; j++) out[e + 24 + j] = j < nm.length ? nm[j] : 0;
    setU32(out, e + 56, off); // fileOffset
    out.set(files[i].data, off);
    off += files[i].data.length;
  }
  return out;
}

// --- Sample data -------------------------------------------------------------

const A = enc("alpha-save-data-0123456789");
const B = new Uint8Array(300);
for (let i = 0; i < B.length; i++) B[i] = (i * 7 + 3) & 0xff;

const container = (
  format: Ps2ContainerFormat,
  files: RawFile[],
): Ps2Container => ({
  format,
  title: "TESTGAME",
  created: { sec: 0, min: 0, hour: 0, day: 0, month: 0, year: 0 },
  modified: { sec: 0, min: 0, hour: 0, day: 0, month: 0, year: 0 },
  files: files.map((f) => ({
    name: f.name,
    data: f.data,
    created: { sec: 0, min: 0, hour: 0, day: 0, month: 0, year: 0 },
    modified: { sec: 0, min: 0, hour: 0, day: 0, month: 0, year: 0 },
  })),
});

describe("ps2-single-save", () => {
  it("round-trips a MAX Drive container", async () => {
    const files: RawFile[] = [
      { name: "SAVE01.BIN", data: A },
      { name: "PIC.PNG", data: B },
    ];
    const bytes = writePs2Container(
      container(Ps2ContainerFormat.MaxDrive, files),
    );
    expect(detectPs2Container(bytes, "x.psu")).toBe(
      Ps2ContainerFormat.MaxDrive,
    );
    const c = await readPs2Container(bytes, "x.psu");
    expect(c.format).toBe(Ps2ContainerFormat.MaxDrive);
    expect(c.title).toBe("TESTGAME");
    expect(c.files).toHaveLength(2);
    expect(c.files[0].name).toBe("SAVE01.BIN");
    expect(eq(c.files[0].data, A)).toBe(true);
    expect(c.files[1].name).toBe("PIC.PNG");
    expect(eq(c.files[1].data, B)).toBe(true);
    const stored =
      bytes[0x0c] |
      (bytes[0x0d] << 8) |
      (bytes[0x0e] << 16) |
      (bytes[0x0f] << 24);
    const withZeroCrc = bytes.slice();
    withZeroCrc[0x0c] = 0;
    withZeroCrc[0x0d] = 0;
    withZeroCrc[0x0e] = 0;
    withZeroCrc[0x0f] = 0;
    expect(stored >>> 0).toBe(crc32(withZeroCrc));
    expect(stored).not.toBe(0);
  });

  it("round-trips an EMS (.psu) container", async () => {
    const files: RawFile[] = [
      { name: "SAVE01.BIN", data: A },
      { name: "PIC.PNG", data: B },
    ];
    const bytes = writePs2Container(container(Ps2ContainerFormat.Ems, files));
    expect(detectPs2Container(bytes, "x.psu")).toBe(Ps2ContainerFormat.Ems);
    const c = await readPs2Container(bytes, "x.psu");
    expect(c.format).toBe(Ps2ContainerFormat.Ems);
    expect(c.title).toBe("TESTGAME");
    expect(c.files).toHaveLength(2);
    expect(eq(c.files[0].data, A)).toBe(true);
    expect(eq(c.files[1].data, B)).toBe(true);
  });

  it("detects SharkPort from magic and reads files", async () => {
    const files: RawFile[] = [
      { name: "SAVE01.BIN", data: A },
      { name: "PIC.PNG", data: B },
    ];
    const bytes = buildSharkPort(files, "TESTGAME");
    expect(detectPs2Container(bytes, "x.sps")).toBe(
      Ps2ContainerFormat.SharkPort,
    );
    const c = await readPs2Container(bytes, "x.sps");
    expect(c.format).toBe(Ps2ContainerFormat.SharkPort);
    expect(c.title).toBe("TESTGAME");
    expect(c.files).toHaveLength(2);
    expect(eq(c.files[0].data, A)).toBe(true);
    expect(eq(c.files[1].data, B)).toBe(true);
  });

  it("detects X-Port by extension (shared SharkPort layout)", async () => {
    const files: RawFile[] = [{ name: "SAVE01.BIN", data: A }];
    const bytes = buildSharkPort(files, "TESTGAME");
    expect(detectPs2Container(bytes, "x.xps")).toBe(Ps2ContainerFormat.XPort);
    const c = await readPs2Container(bytes, "x.xps");
    expect(c.format).toBe(Ps2ContainerFormat.XPort);
    expect(eq(c.files[0].data, A)).toBe(true);
  });

  it("detects CodeBreaker and decodes RC4 + zlib body", async () => {
    const files: RawFile[] = [
      { name: "SAVE01.BIN", data: A },
      { name: "PIC.PNG", data: B },
    ];
    const bytes = await buildCodeBreaker(files, "TESTGAME");
    expect(detectPs2Container(bytes, "x.cbs")).toBe(
      Ps2ContainerFormat.CodeBreaker,
    );
    const c = await readPs2Container(bytes, "x.cbs");
    expect(c.format).toBe(Ps2ContainerFormat.CodeBreaker);
    expect(c.title).toBe("TESTGAME");
    expect(c.files).toHaveLength(2);
    expect(c.files[0].name).toBe("SAVE01.BIN");
    expect(eq(c.files[0].data, A)).toBe(true);
    expect(eq(c.files[1].data, B)).toBe(true);
  });

  it("reads a PSV type-1 (single file) container", async () => {
    const bytes = buildPsv1(A, "TESTGAME");
    expect(detectPs2Container(bytes, "x.psv")).toBe(Ps2ContainerFormat.Psv);
    const c = await readPs2Container(bytes, "x.psv");
    expect(c.format).toBe(Ps2ContainerFormat.Psv);
    expect(c.title).toBe("TESTGAME");
    expect(c.files).toHaveLength(1);
    expect(c.files[0].name).toBe("SAVEGAME.PSX");
    expect(eq(c.files[0].data, A)).toBe(true);
  });

  it("reads a PSV type-2 (multi-file) container", async () => {
    const files: RawFile[] = [
      { name: "SAVE01.BIN", data: A },
      { name: "PIC.PNG", data: B },
    ];
    const bytes = buildPsv2(files, "TESTGAME");
    expect(detectPs2Container(bytes, "x.psv")).toBe(Ps2ContainerFormat.Psv);
    const c = await readPs2Container(bytes, "x.psv");
    expect(c.format).toBe(Ps2ContainerFormat.Psv);
    expect(c.title).toBe("TESTGAME");
    expect(c.files).toHaveLength(2);
    expect(eq(c.files[0].data, A)).toBe(true);
    expect(eq(c.files[1].data, B)).toBe(true);
  });

  it("falls back to the extension and rejects unknown formats", () => {
    expect(detectPs2Container(new Uint8Array([1, 2, 3]), "x.dat")).toBe(
      Ps2ContainerFormat.Unknown,
    );
    expect(detectPs2Container(new Uint8Array([1, 2, 3]), "x.psu")).toBe(
      Ps2ContainerFormat.Ems,
    );
    return expect(
      readPs2Container(new Uint8Array([1, 2, 3]), "x.dat"),
    ).rejects.toThrow();
  });

  it("maps container formats to export extensions", () => {
    expect(containerFormatToExtension(Ps2ContainerFormat.MaxDrive)).toBe(
      ".psu",
    );
    expect(containerFormatToExtension(Ps2ContainerFormat.Ems)).toBe(".psu");
    expect(containerFormatToExtension(Ps2ContainerFormat.SharkPort)).toBe(
      ".sps",
    );
    expect(containerFormatToExtension(Ps2ContainerFormat.CodeBreaker)).toBe(
      ".cbs",
    );
    expect(containerFormatToExtension(Ps2ContainerFormat.Psv)).toBe(".psv");
  });

  it("refuses to write formats that have no encoder", () => {
    expect(() =>
      writePs2Container(container(Ps2ContainerFormat.Psv, [])),
    ).toThrow();
    expect(() =>
      writePs2Container(container(Ps2ContainerFormat.SharkPort, [])),
    ).toThrow();
  });
});
