// PS2 single-save container codecs: MAX Drive, EMS (raw .psu), SharkPort,
// X-Port, CodeBreaker, and PSV. Reads any of the formats a PC save file uses;
// writes the MAX Drive and EMS layouts. Layouts follow the mymc++/mymc
// implementations.

import { crc32 } from "../crc32";
import { lzariCompress, lzariDecompress } from "./ps2-lzari";
import { MODE_DIR, MODE_EXISTS, MODE_FILE } from "./ps2-pfs";
import { PS2SAVE_CBS_RC4S, rc4Crypt } from "./ps2-rc4";
import type { Ps2DateTime } from "./ps2-types";
import { inflateZlib } from "./ps2-zlib";

const DF_RWX = 0x0007;
const DF_0400 = 0x0400;
const DIRENT_LENGTH = 512;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const MAX_MAGIC = enc("Ps2PowerSave");
const SPS_MAGIC = new Uint8Array([13, 0, 0, 0, ...enc("SharkPortSave")]);
const CBS_MAGIC = enc("CFU\0");
const NPO_MAGIC = enc("nPort");
const PSV_MAGIC = enc("\0VSP");

export const ZERO_TIME: Ps2DateTime = {
  sec: 0,
  min: 0,
  hour: 0,
  day: 0,
  month: 0,
  year: 0,
};

export enum Ps2ContainerFormat {
  MaxDrive = 0,
  Ems = 1,
  SharkPort = 2,
  XPort = 3,
  CodeBreaker = 4,
  Psv = 5,
  NPort = 6,
  Unknown = 7,
}

export interface Ps2ContainerFile {
  name: string;
  data: Uint8Array;
  created: Ps2DateTime;
  modified: Ps2DateTime;
}

export interface Ps2Container {
  format: Ps2ContainerFormat;
  title: string;
  created: Ps2DateTime;
  modified: Ps2DateTime;
  files: Ps2ContainerFile[];
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function readTod(b: Uint8Array, o: number): Ps2DateTime {
  return {
    sec: b[o + 1],
    min: b[o + 2],
    hour: b[o + 3],
    day: b[o + 4],
    month: b[o + 5],
    year: b[o + 6] | (b[o + 7] << 8),
  };
}

function writeTod(b: Uint8Array, o: number, t: Ps2DateTime): void {
  b[o] = 0;
  b[o + 1] = t.sec;
  b[o + 2] = t.min;
  b[o + 3] = t.hour;
  b[o + 4] = t.day;
  b[o + 5] = t.month;
  b[o + 6] = t.year & 0xff;
  b[o + 7] = (t.year >> 8) & 0xff;
}

// Null-terminated ASCII name (low 7 bits), bounded by length.
function readName(b: Uint8Array, o: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = b[o + i];
    if (c === 0) break;
    s += String.fromCharCode(c & 0x7f);
  }
  return s;
}

function writeName(b: Uint8Array, o: number, name: string): void {
  for (let i = 0; i < 32; i++) {
    b[o + i] = i < name.length ? name.charCodeAt(i) & 0x7f : 0;
  }
}

const roundUp = (a: number, n: number): number => Math.ceil(a / n) * n;
const swap16 = (x: number): number =>
  (((x << 8) & 0xff00) | ((x >> 8) & 0xff)) & 0xffff;

class Reader {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}

  get remaining(): number {
    return this.b.length - this.pos;
  }

  read(n: number): Uint8Array {
    if (this.pos + n > this.b.length) throw new Error("Unexpected EOF");
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  u16(): number {
    const v = readU16(this.b, this.pos);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = readU32(this.b, this.pos);
    this.pos += 4;
    return v;
  }

  skip(n: number): void {
    if (this.pos + n > this.b.length) throw new Error("Unexpected EOF");
    this.pos += n;
  }

  // Absolute sub-view (does not advance the cursor) — used by PSV, whose
  // entries reference file offsets independent of the parse position.
  abs(offset: number, length: number): Uint8Array {
    if (offset < 0 || offset + length > this.b.length) {
      throw new Error("Out-of-bounds PSV offset");
    }
    return this.b.subarray(offset, offset + length);
  }
}

// ---------------------------------------------------------------------------
// 512-byte directory entry pack/unpack (same layout as the card PFS entry)
// ---------------------------------------------------------------------------

interface Dirent {
  mode: number;
  length: number;
  cluster: number;
  dirEntry: number;
  created: Ps2DateTime;
  modified: Ps2DateTime;
  attr: number;
  name: string;
}

function unpackDirent(b: Uint8Array): Dirent {
  return {
    mode: readU16(b, 0),
    length: readU32(b, 4),
    cluster: readU32(b, 0x10),
    dirEntry: readU32(b, 0x14),
    created: readTod(b, 0x08),
    modified: readTod(b, 0x18),
    attr: readU32(b, 0x20),
    name: readName(b, 0x40, 32),
  };
}

function packDirent(e: Dirent): Uint8Array {
  const b = new Uint8Array(DIRENT_LENGTH);
  b[0] = e.mode & 0xff;
  b[1] = (e.mode >> 8) & 0xff;
  const len = e.length >>> 0;
  b[4] = len & 0xff;
  b[5] = (len >> 8) & 0xff;
  b[6] = (len >> 16) & 0xff;
  b[7] = (len >> 24) & 0xff;
  writeTod(b, 0x08, e.created);
  const cl = e.cluster >>> 0;
  b[0x10] = cl & 0xff;
  b[0x11] = (cl >> 8) & 0xff;
  b[0x12] = (cl >> 16) & 0xff;
  b[0x13] = (cl >> 24) & 0xff;
  const de = e.dirEntry >>> 0;
  b[0x14] = de & 0xff;
  b[0x15] = (de >> 8) & 0xff;
  b[0x16] = (de >> 16) & 0xff;
  b[0x17] = (de >> 24) & 0xff;
  writeTod(b, 0x18, e.modified);
  const at = e.attr >>> 0;
  b[0x20] = at & 0xff;
  b[0x21] = (at >> 8) & 0xff;
  b[0x22] = (at >> 16) & 0xff;
  b[0x23] = (at >> 24) & 0xff;
  writeName(b, 0x40, e.name);
  return b;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function detectPs2Container(
  bytes: Uint8Array,
  filename: string,
): Ps2ContainerFormat {
  if (startsWith(bytes, MAX_MAGIC)) return Ps2ContainerFormat.MaxDrive;
  if (startsWith(bytes, SPS_MAGIC)) {
    return extensionOf(filename) === ".xps"
      ? Ps2ContainerFormat.XPort
      : Ps2ContainerFormat.SharkPort;
  }
  if (startsWith(bytes, CBS_MAGIC)) return Ps2ContainerFormat.CodeBreaker;
  if (startsWith(bytes, PSV_MAGIC)) return Ps2ContainerFormat.Psv;
  if (startsWith(bytes, NPO_MAGIC)) return Ps2ContainerFormat.NPort;

  switch (extensionOf(filename)) {
    case ".psu":
      return Ps2ContainerFormat.Ems;
    case ".max":
      return Ps2ContainerFormat.MaxDrive;
    case ".sps":
      return Ps2ContainerFormat.SharkPort;
    case ".cbs":
      return Ps2ContainerFormat.CodeBreaker;
    case ".xps":
      return Ps2ContainerFormat.XPort;
    case ".psv":
      return Ps2ContainerFormat.Psv;
    default:
      return Ps2ContainerFormat.Unknown;
  }
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

function readMax(r: Reader): Ps2Container {
  const hdr = r.read(0x5c);
  if (!startsWith(hdr, MAX_MAGIC)) throw new Error("Not a MAX Drive save");
  const clen = readU32(hdr, 0x50);
  const dirlen = readU32(hdr, 0x54);
  const length = readU32(hdr, 0x58);
  const compressed = clen === length ? r.read(r.remaining) : r.read(clen - 4);
  const decompressed = lzariDecompress(compressed, length);
  if (decompressed.length !== length) {
    throw new Error("MAX decompress size mismatch");
  }

  const files: Ps2ContainerFile[] = [];
  let off = 0;
  for (let i = 0; i < dirlen; i++) {
    if (off + 36 > decompressed.length) {
      throw new Error("MAX directory truncated");
    }
    const l = readU32(decompressed, off);
    const name = readName(decompressed, off + 4, 32);
    off += 36;
    if (off + l > decompressed.length) {
      throw new Error("MAX file truncated");
    }
    files.push({
      name,
      data: decompressed.subarray(off, off + l),
      created: { ...ZERO_TIME },
      modified: { ...ZERO_TIME },
    });
    off = roundUp(off + l + 8, 16) - 8;
  }
  return {
    format: Ps2ContainerFormat.MaxDrive,
    title: readName(hdr, 16, 32),
    created: { ...ZERO_TIME },
    modified: { ...ZERO_TIME },
    files,
  };
}

function readEms(r: Reader): Ps2Container {
  const root = unpackDirent(r.read(DIRENT_LENGTH));
  unpackDirent(r.read(DIRENT_LENGTH)); // "."
  unpackDirent(r.read(DIRENT_LENGTH)); // ".."
  if (
    (root.mode & MODE_DIR) === 0 ||
    (root.mode & MODE_EXISTS) === 0 ||
    root.length < 2
  ) {
    throw new Error("Not a valid EMS/PSU file");
  }
  const fileCount = root.length - 2;
  const files: Ps2ContainerFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const ent = unpackDirent(r.read(DIRENT_LENGTH));
    if ((ent.mode & MODE_FILE) === 0) continue;
    const data = r.read(ent.length);
    const pad = roundUp(ent.length, 1024) - ent.length;
    if (pad > 0) r.skip(pad);
    files.push({
      name: ent.name,
      data,
      created: ent.created,
      modified: ent.modified,
    });
  }
  return {
    format: Ps2ContainerFormat.Ems,
    title: root.name,
    created: root.created,
    modified: root.modified,
    files,
  };
}

function readSharkPort(r: Reader, format: Ps2ContainerFormat): Ps2Container {
  const magic = r.read(17);
  if (!startsWith(magic, SPS_MAGIC)) throw new Error("Bad SharkPort magic");
  r.u32(); // savetype
  const dirnameLen = r.u32();
  const dirname = readName(r.read(dirnameLen), 0, dirnameLen);
  const datestampLen = r.u32();
  r.skip(datestampLen);
  const commentLen = r.u32();
  r.skip(commentLen);
  r.u32(); // flen
  const hlen = r.u16();
  r.read(64); // name
  const dirlen = r.u32();
  r.skip(8);
  const dirmode = swap16(r.u16());
  r.skip(2);
  r.read(8); // created
  r.read(8); // modified
  if (hlen > 98) r.skip(hlen - 98);

  if ((dirmode & MODE_DIR) === 0 || dirlen < 2) {
    throw new Error("Invalid SharkPort directory header");
  }

  const files: Ps2ContainerFile[] = [];
  for (let i = 0; i < dirlen - 2; i++) {
    const fhlen = r.u16();
    const fname = readName(r.read(64), 0, 64);
    const fsize = r.u32();
    r.skip(8);
    const fmode = swap16(r.u16());
    r.skip(2);
    const created = readTod(r.read(8), 0);
    const modified = readTod(r.read(8), 0);
    if (fhlen > 98) r.skip(fhlen - 98);
    if ((fmode & MODE_FILE) === 0) {
      throw new Error("Non-file in SharkPort save");
    }
    files.push({ name: fname, data: r.read(fsize), created, modified });
  }
  return {
    format,
    title: dirname,
    created: { ...ZERO_TIME },
    modified: { ...ZERO_TIME },
    files,
  };
}

async function readCodeBreaker(r: Reader): Promise<Ps2Container> {
  const magic = r.read(4);
  if (!startsWith(magic, CBS_MAGIC)) throw new Error("Not a CodeBreaker save");
  r.u32(); // d04
  const hlen = r.u32();
  if (hlen < 124) throw new Error("CodeBreaker header too short");
  const header = r.read(hlen - 12);
  const flen = readU32(header, 4);
  const dirname = readName(header, 8, 32);

  let bodyLen = flen;
  if (bodyLen > r.remaining) bodyLen = r.remaining;
  if (bodyLen !== flen && bodyLen !== flen - hlen) {
    throw new Error("Unexpected EOF in CodeBreaker body");
  }
  const body = r.read(bodyLen);
  const decrypted = rc4Crypt(PS2SAVE_CBS_RC4S, body);
  const decompressed = await inflateZlib(decrypted);

  const files: Ps2ContainerFile[] = [];
  let off = 0;
  while (off + 64 <= decompressed.length) {
    const fsize = readU32(decompressed, off + 16);
    const fmode = readU16(decompressed, off + 20);
    const created = readTod(decompressed, off + 0);
    const modified = readTod(decompressed, off + 8);
    const fname = readName(decompressed, off + 32, 32);
    off += 64;
    if (off + fsize > decompressed.length) break;
    if ((fmode & MODE_FILE) === 0) {
      throw new Error("Non-file in CodeBreaker save");
    }
    files.push({
      name: fname,
      data: decompressed.subarray(off, off + fsize),
      created,
      modified,
    });
    off += fsize;
  }
  return {
    format: Ps2ContainerFormat.CodeBreaker,
    title: dirname,
    created: readTod(header, 40),
    modified: readTod(header, 48),
    files,
  };
}

function readPsv(r: Reader): Ps2Container {
  const magic = r.read(4);
  if (!startsWith(magic, PSV_MAGIC)) throw new Error("Not a PSV file");
  const version = r.u32();
  r.skip(40); // signature
  r.skip(8); // reserved
  r.u32(); // next_section_size
  const savetype = r.u32();
  if (version !== 0) throw new Error("Unsupported PSV version");
  if (savetype !== 1 && savetype !== 2) {
    throw new Error("Unsupported PSV save type");
  }

  if (savetype === 2) {
    r.u32(); // displaySize
    r.u32(); // sysPos
    r.u32(); // sysSize
    r.u32(); // icon1Pos
    r.u32(); // icon1Size
    r.u32(); // icon2Pos
    r.u32(); // icon2Size
    r.u32(); // icon3Pos
    r.u32(); // icon3Size
    const filesCount = r.u32();
    r.skip(8); // root created
    r.skip(8); // root modified
    r.u32(); // root size
    const rootMode = r.u32();
    const title = readName(r.read(32), 0, 32);
    if ((rootMode & MODE_DIR) === 0) {
      throw new Error("PSV root is not a directory");
    }

    interface Pending {
      offset: number;
      size: number;
      name: string;
      created: Ps2DateTime;
      modified: Ps2DateTime;
    }
    const pending: Pending[] = [];
    for (let i = 0; i < filesCount; i++) {
      const created = readTod(r.read(8), 0);
      const modified = readTod(r.read(8), 0);
      const fileSize = r.u32();
      const fileMode = r.u32();
      const name = readName(r.read(32), 0, 32);
      const fileOffset = r.u32();
      if ((fileMode & MODE_FILE) !== 0) {
        pending.push({
          offset: fileOffset,
          size: fileSize,
          name,
          created,
          modified,
        });
      }
    }
    const files: Ps2ContainerFile[] = pending.map((p) => ({
      name: p.name,
      data: r.abs(p.offset, p.size),
      created: p.created,
      modified: p.modified,
    }));
    return {
      format: Ps2ContainerFormat.Psv,
      title,
      created: { ...ZERO_TIME },
      modified: { ...ZERO_TIME },
      files,
    };
  }

  const saveSize = r.u32();
  const saveOffset = r.u32();
  r.skip(20);
  r.u32(); // unused
  r.skip(4);
  const title = readName(r.read(20), 0, 20);
  const data = r.abs(saveOffset, saveSize);
  return {
    format: Ps2ContainerFormat.Psv,
    title,
    created: { ...ZERO_TIME },
    modified: { ...ZERO_TIME },
    files: [
      {
        name: "SAVEGAME.PSX",
        data,
        created: { ...ZERO_TIME },
        modified: { ...ZERO_TIME },
      },
    ],
  };
}

export async function readPs2Container(
  bytes: Uint8Array,
  filename: string,
): Promise<Ps2Container> {
  const format = detectPs2Container(bytes, filename);
  const r = new Reader(bytes);
  switch (format) {
    case Ps2ContainerFormat.MaxDrive:
      return readMax(r);
    case Ps2ContainerFormat.Ems:
      return readEms(r);
    case Ps2ContainerFormat.SharkPort:
    case Ps2ContainerFormat.XPort:
      return readSharkPort(r, format);
    case Ps2ContainerFormat.CodeBreaker:
      return readCodeBreaker(r);
    case Ps2ContainerFormat.Psv:
      return readPsv(r);
    default:
      throw new Error("Unsupported PS2 save format");
  }
}

// ---------------------------------------------------------------------------
// Writers (MAX Drive + EMS only)
// ---------------------------------------------------------------------------

function writeMax(c: Ps2Container): Uint8Array {
  let blobLen = 0;
  for (const f of c.files)
    blobLen = roundUp(blobLen + 36 + f.data.length + 8, 16) - 8;
  const blob = new Uint8Array(blobLen);
  let off = 0;
  for (const f of c.files) {
    const len = f.data.length >>> 0;
    blob[off] = len & 0xff;
    blob[off + 1] = (len >> 8) & 0xff;
    blob[off + 2] = (len >> 16) & 0xff;
    blob[off + 3] = (len >> 24) & 0xff;
    writeName(blob, off + 4, f.name);
    blob.set(f.data, off + 36);
    off = roundUp(off + 36 + len + 8, 16) - 8;
  }
  const compressed = lzariCompress(blob);
  const clen = compressed.length + 4;
  const length = blob.length;

  const out = new Uint8Array(0x5c + compressed.length);
  out.set(MAX_MAGIC, 0);
  writeName(out, 16, c.title);
  // iconsys @0x30 stays zero
  const clenU = clen >>> 0;
  out[0x50] = clenU & 0xff;
  out[0x51] = (clenU >> 8) & 0xff;
  out[0x52] = (clenU >> 16) & 0xff;
  out[0x53] = (clenU >> 24) & 0xff;
  const dl = c.files.length >>> 0;
  out[0x54] = dl & 0xff;
  out[0x55] = (dl >> 8) & 0xff;
  out[0x56] = (dl >> 16) & 0xff;
  out[0x57] = (dl >> 24) & 0xff;
  const ln = length >>> 0;
  out[0x58] = ln & 0xff;
  out[0x59] = (ln >> 8) & 0xff;
  out[0x5a] = (ln >> 16) & 0xff;
  out[0x5b] = (ln >> 24) & 0xff;
  out.set(compressed, 0x5c);
  // CRC-32 of the whole file with this field left 0, then stored at 0x0C.
  const crc = crc32(out);
  out[0x0c] = crc & 0xff;
  out[0x0d] = (crc >> 8) & 0xff;
  out[0x0e] = (crc >> 16) & 0xff;
  out[0x0f] = (crc >> 24) & 0xff;
  return out;
}

function writeEms(c: Ps2Container): Uint8Array {
  const root: Dirent = {
    mode: DF_RWX | MODE_DIR | DF_0400 | MODE_EXISTS,
    length: c.files.length + 2,
    cluster: 0,
    dirEntry: 0,
    created: c.created,
    modified: c.modified,
    attr: 0,
    name: c.title,
  };
  const chunks: Uint8Array[] = [
    packDirent(root),
    packDirent({ ...root, name: "." }),
    packDirent({ ...root, name: ".." }),
  ];
  for (const f of c.files) {
    const ent: Dirent = {
      mode: DF_RWX | MODE_FILE | DF_0400 | MODE_EXISTS,
      length: f.data.length,
      cluster: 0,
      dirEntry: 0,
      created: f.created,
      modified: f.modified,
      attr: 0,
      name: f.name,
    };
    chunks.push(packDirent(ent));
    chunks.push(f.data);
    const pad = roundUp(f.data.length, 1024) - f.data.length;
    if (pad > 0) chunks.push(new Uint8Array(pad));
  }
  const total = chunks.reduce((a, ch) => a + ch.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}

export function writePs2Container(c: Ps2Container): Uint8Array {
  switch (c.format) {
    case Ps2ContainerFormat.MaxDrive:
      return writeMax(c);
    case Ps2ContainerFormat.Ems:
      return writeEms(c);
    default:
      throw new Error("Writing is not supported for this PS2 save format");
  }
}

// ---------------------------------------------------------------------------
// Extension mapping (the scene .sdt stays a raw single file, handled elsewhere)
// ---------------------------------------------------------------------------

export function containerFormatToExtension(format: Ps2ContainerFormat): string {
  switch (format) {
    case Ps2ContainerFormat.MaxDrive:
    case Ps2ContainerFormat.Ems:
      return ".psu";
    case Ps2ContainerFormat.SharkPort:
      return ".sps";
    case Ps2ContainerFormat.CodeBreaker:
      return ".cbs";
    case Ps2ContainerFormat.XPort:
      return ".xps";
    case Ps2ContainerFormat.Psv:
      return ".psv";
    case Ps2ContainerFormat.NPort:
      return ".npo";
    default:
      return ".dat";
  }
}
