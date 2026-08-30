// PS2 single-save container codecs: MAX Drive, EMS (raw .psu), SharkPort,
// X-Port, CodeBreaker, and PSV. Reads and writes every format a PC save file
// uses except nPort (recognized but not parsed). Layouts follow the mymc++/
// mymc implementations and the scene tools that emit each container.

import { crc32 } from "../crc32";
import { aesCbcDecrypt } from "../crypto-utils";
import { generateSaltSeed } from "../ps1-keys";
import { ICON_MAGIC, ICON_SYS_SIZE, parseIconSys } from "./ps2-iconsys";
import { psvIv, psvPs2Key } from "./ps2-keys";
import { lzariCompress, lzariDecompress } from "./ps2-lzari";
import { MODE_DIR, MODE_EXISTS, MODE_FILE } from "./ps2-pfs";
import { PS2SAVE_CBS_RC4S, rc4Crypt } from "./ps2-rc4";
import { encodeDirentName } from "./ps2-sjis";
import type { Ps2DateTime } from "./ps2-types";
import { deflateZlib, inflateZlib } from "./ps2-zlib";

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

// Null-terminated name bytes (Latin-1 / SJIS), bounded by length.
function readName(b: Uint8Array, o: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = b[o + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function writeNameBytes(
  b: Uint8Array,
  o: number,
  len: number,
  name: string,
): void {
  const bytes = encodeDirentName(name) ?? new Uint8Array();
  for (let i = 0; i < len; i++) {
    b[o + i] = i < bytes.length ? bytes[i] : 0;
  }
}

function writeName(b: Uint8Array, o: number, name: string): void {
  writeNameBytes(b, o, 32, name);
}

function writeNameN(b: Uint8Array, o: number, len: number, name: string): void {
  writeNameBytes(b, o, len, name);
}

function setU32(b: Uint8Array, o: number, v: number): void {
  const x = v >>> 0;
  b[o] = x & 0xff;
  b[o + 1] = (x >> 8) & 0xff;
  b[o + 2] = (x >> 16) & 0xff;
  b[o + 3] = (x >> 24) & 0xff;
}

function xorByte(b: Uint8Array, x: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i] ^ x;
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
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
// Writers (every format but nPort)
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

// The container's icon.sys bytes when a valid one is present (named icon.sys,
// at least ICON_SYS_SIZE long, magic "PS2D"), else null. The raw Shift-JIS
// title lives at offset 0xC0; callers copy those bytes directly rather than
// round-tripping through the decoded (Unicode) title.
function iconSysData(c: Ps2Container): Uint8Array | null {
  for (const f of c.files) {
    if (f.name.toUpperCase() !== "ICON.SYS") continue;
    if (f.data.length < ICON_SYS_SIZE) return null;
    let magic = "";
    for (let i = 0; i < 4; i++) magic += String.fromCharCode(f.data[i] & 0x7f);
    if (magic !== ICON_MAGIC) return null;
    return f.data;
  }
  return null;
}

// ASCII-printable subset (0x20..0x7E) of a decoded title, for X-Port's
// title_ascii field. Drops everything else, so a non-ASCII title yields "".
function asciiTitle(title: string): string {
  let out = "";
  for (let i = 0; i < title.length; i++) {
    const code = title.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) out += String.fromCharCode(code);
  }
  return out;
}

// --- SharkPort / X-Port (.sps / .xps) --------------------------------------
// One 250-byte descriptor (xpsEntry_t layout) per directory/file record. The
// mode field is stored byte-swapped in its low 16 bits so the reader's swap16
// recovers the real mode. SharkPort and X-Port emit identical bytes; only the
// file extension differs.

const XPS_ENTRY_SIZE = 250;
const XPS_DIR_MODE = DF_RWX | MODE_DIR | DF_0400 | MODE_EXISTS;
const XPS_FILE_MODE = DF_RWX | MODE_FILE | DF_0400 | MODE_EXISTS;

function writeXpsDesc(
  b: Uint8Array,
  o: number,
  name: string,
  length: number,
  mode: number,
  created: Ps2DateTime,
  modified: Ps2DateTime,
  titleAscii = "",
): void {
  b[o] = XPS_ENTRY_SIZE & 0xff;
  b[o + 1] = (XPS_ENTRY_SIZE >> 8) & 0xff;
  writeNameN(b, o + 2, 64, name);
  setU32(b, o + 66, length); // file bytes, or dirent count for the dir record
  // u32 start @70 and u32 end @74 stay 0 (sector hints; unused on PC files)
  setU32(b, o + 78, swap16(mode)); // low 16 = swapped mode, high 16 = 0
  writeTod(b, o + 82, created);
  writeTod(b, o + 90, modified);
  if (titleAscii) writeNameN(b, o + 114, 64, titleAscii); // title_ascii[64]
}

function writeSharkPort(c: Ps2Container): Uint8Array {
  const dn = enc(c.title);
  const fileCount = c.files.length;
  const header = new Uint8Array(37 + dn.length);
  header.set(SPS_MAGIC, 0); // magic @0 (17)
  // savetype @17 (4) stays 0
  setU32(header, 21, dn.length); // dirname length
  header.set(dn, 25); // dirname
  setU32(header, 25 + dn.length, 0); // datestamp length
  setU32(header, 25 + dn.length + 4, 0); // comment length
  // flen @25+dn.length+8 is set once the payload length is known

  const chunks: Uint8Array[] = [header];
  // Directory title_ascii is ASCII: the printable subset of the decoded icon
  // title, falling back to the directory name when nothing printable remains.
  const icon = iconSysData(c);
  const decoded = icon !== null ? parseIconSys(icon).title : c.title;
  const subset = asciiTitle(decoded);
  const dirTitleAscii = subset !== "" ? subset : c.title;
  const dirDesc = new Uint8Array(XPS_ENTRY_SIZE);
  writeXpsDesc(
    dirDesc,
    0,
    c.title,
    fileCount + 2,
    XPS_DIR_MODE,
    c.created,
    c.modified,
    dirTitleAscii,
  );
  chunks.push(dirDesc);
  for (const f of c.files) {
    const desc = new Uint8Array(XPS_ENTRY_SIZE);
    writeXpsDesc(
      desc,
      0,
      f.name,
      f.data.length,
      XPS_FILE_MODE,
      f.created,
      f.modified,
    );
    chunks.push(desc);
    chunks.push(f.data);
  }
  chunks.push(new Uint8Array(4)); // trailing checksum (zero)

  const total = chunks.reduce((a, ch) => a + ch.length, 0);
  // flen = size of "files and descriptors" = rest of the file minus the
  // trailing 4-byte checksum.
  setU32(header, 25 + dn.length + 8, total - (37 + dn.length) - 4);

  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.length;
  }
  return out;
}

// --- CodeBreaker (.cbs) -----------------------------------------------------
// Plaintext entry blob -> zlib -> RC4. The 0x128 header matches the scene
// createCBS layout; the body sits exactly at dataOffset (0x128), and the
// reader recovers its length from compressedSize - hlen.

const CBS_HEADER_SIZE = 0x128;
const CBS_DIR_MODE = 0x8427;
const CBS_FILE_MODE = 0x8497;

async function writeCodeBreaker(c: Ps2Container): Promise<Uint8Array> {
  let blobLen = 0;
  for (const f of c.files) blobLen += 64 + f.data.length;
  const blob = new Uint8Array(blobLen);
  let off = 0;
  for (const f of c.files) {
    writeTod(blob, off, f.created); // created @0
    writeTod(blob, off + 8, f.modified); // modified @8
    setU32(blob, off + 16, f.data.length); // length
    setU32(blob, off + 20, CBS_FILE_MODE); // mode
    // unk[8] @24 stays 0
    writeName(blob, off + 32, f.name); // name[32]
    blob.set(f.data, off + 64);
    off += 64 + f.data.length;
  }
  const zlibBody = await deflateZlib(blob);
  const body = rc4Crypt(PS2SAVE_CBS_RC4S, zlibBody);
  const zlibLen = zlibBody.length;

  const header = new Uint8Array(CBS_HEADER_SIZE);
  header.set(CBS_MAGIC, 0); // magic
  setU32(header, 4, 0x1f40); // unk1
  setU32(header, 8, CBS_HEADER_SIZE); // dataOffset
  setU32(header, 0xc, blob.length); // decompressedSize
  setU32(header, 0x10, zlibLen + CBS_HEADER_SIZE); // compressedSize (whole file)
  writeName(header, 0x14, c.title); // name[32]
  writeTod(header, 0x34, c.created); // created
  writeTod(header, 0x3c, c.modified); // modified
  setU32(header, 0x48, CBS_DIR_MODE); // mode
  // unk3[16] @0x4C stays 0; title[72] follows it at 0x5C. The title is a
  // PS2-side string: copy the raw Shift-JIS bytes from the icon.sys title
  // (offset 0xC0, 68 bytes, zero-padded to 72). No icon.sys -> dir name ASCII.
  const icon = iconSysData(c);
  if (icon !== null) {
    for (let i = 0; i < 68; i++) header[0x5c + i] = icon[0xc0 + i];
  } else {
    writeNameN(header, 0x5c, 72, c.title);
  }

  const out = new Uint8Array(CBS_HEADER_SIZE + zlibLen);
  out.set(header, 0);
  out.set(body, CBS_HEADER_SIZE);
  return out;
}

// --- PSV savetype 2 (.psv) ---------------------------------------------------
// The PS3 USB wrapper for a PS2 save directory. psv_header_t (0x40), then
// ps2_header_t (10 x u32, numberOfFiles at 0x64), ps2_MainDirInfo_t (0x38),
// per-file ps2_FileInfo_t (60 bytes), then the raw file bytes. The salt at
// 0x08 seeds an HMAC at 0x1C signed with the PS2 PSV key/IV so a PS3 accepts
// the file on OFW (PC import tools skip the check).

const PSV_DIR_MODE = 0x8427;
const PSV_FILE_MODE = 0x8497;

function iconPositions(
  files: Ps2ContainerFile[],
  positions: { pos: number; size: number }[],
): {
  sys: [number, number];
  icon1: [number, number];
  icon2: [number, number];
  icon3: [number, number];
} {
  const result: {
    sys: [number, number];
    icon1: [number, number];
    icon2: [number, number];
    icon3: [number, number];
  } = { sys: [0, 0], icon1: [0, 0], icon2: [0, 0], icon3: [0, 0] };
  let iconIdx = -1;
  for (let i = 0; i < files.length; i++) {
    if (files[i].name.toUpperCase() === "ICON.SYS") {
      iconIdx = i;
      break;
    }
  }
  if (iconIdx < 0) return result;
  result.sys = [positions[iconIdx].pos, positions[iconIdx].size];
  const data = files[iconIdx].data;
  if (data.length < ICON_SYS_SIZE) return result;
  let magic = "";
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(data[i] & 0x7f);
  if (magic !== ICON_MAGIC) return result;
  const sys = parseIconSys(data);
  const findByName = (nm: string): [number, number] | null => {
    if (!nm) return null;
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.toUpperCase() === nm.toUpperCase()) {
        return [positions[i].pos, positions[i].size];
      }
    }
    return null;
  };
  const v = findByName(sys.viewIcon);
  if (v) result.icon1 = v;
  const cp = findByName(sys.copyIcon);
  if (cp) result.icon2 = cp;
  const d = findByName(sys.delIcon);
  if (d) result.icon3 = d;
  return result;
}

export async function getPsv2Hmac(
  data: Uint8Array,
  saltSeed: Uint8Array,
): Promise<Uint8Array> {
  const salt = new Uint8Array(0x40);
  salt.set(saltSeed.subarray(0, 0x14), 0);
  const dec = await aesCbcDecrypt(salt, psvPs2Key, psvIv);
  for (let i = 0x14; i < 0x40; i++) dec[i] = 0;
  const hash1 = await crypto.subtle.digest(
    "SHA-1",
    concatBytes(xorByte(dec, 0x36), data),
  );
  const hash2 = await crypto.subtle.digest(
    "SHA-1",
    concatBytes(xorByte(dec, 0x36 ^ 0x6a), new Uint8Array(hash1)),
  );
  return new Uint8Array(hash2);
}

async function writePsv(c: Ps2Container): Promise<Uint8Array> {
  const fileCount = c.files.length;
  const entriesStart = 0xa0;
  const dataStart = entriesStart + fileCount * 60;
  const totalData = c.files.reduce((a, f) => a + f.data.length, 0);
  const out = new Uint8Array(dataStart + totalData);

  out.set(PSV_MAGIC, 0); // magic @0
  setU32(out, 4, 0); // version @4
  // salt @8 (20) and HMAC @0x1c (20) are filled once the header is complete
  setU32(out, 0x38, 0x2c); // next_section_size @0x38
  setU32(out, 0x3c, 2); // save_type @0x3c = 2

  const positions: { pos: number; size: number }[] = [];
  let cursor = dataStart;
  let displaySize = 0;
  for (const f of c.files) {
    positions.push({ pos: cursor, size: f.data.length });
    cursor += f.data.length;
    displaySize += f.data.length;
  }
  const icons = iconPositions(c.files, positions);
  setU32(out, 0x40, displaySize); // displaySize
  setU32(out, 0x44, icons.sys[0]); // sysPos
  setU32(out, 0x48, icons.sys[1]); // sysSize
  setU32(out, 0x4c, icons.icon1[0]); // icon1Pos
  setU32(out, 0x50, icons.icon1[1]); // icon1Size
  setU32(out, 0x54, icons.icon2[0]); // icon2Pos
  setU32(out, 0x58, icons.icon2[1]); // icon2Size
  setU32(out, 0x5c, icons.icon3[0]); // icon3Pos
  setU32(out, 0x60, icons.icon3[1]); // icon3Size
  setU32(out, 0x64, fileCount); // numberOfFiles

  writeTod(out, 0x68, c.created); // root created
  writeTod(out, 0x70, c.modified); // root modified
  setU32(out, 0x78, fileCount + 2); // numberOfFilesInDir
  setU32(out, 0x7c, PSV_DIR_MODE); // root attribute
  writeName(out, 0x80, c.title); // root name[32]

  for (let i = 0; i < fileCount; i++) {
    const e = entriesStart + i * 60;
    writeTod(out, e, c.files[i].created);
    writeTod(out, e + 8, c.files[i].modified);
    setU32(out, e + 16, c.files[i].data.length); // fileSize
    setU32(out, e + 20, PSV_FILE_MODE); // attribute
    writeName(out, e + 24, c.files[i].name); // name[32]
    setU32(out, e + 56, positions[i].pos); // positionInFile
  }

  cursor = dataStart;
  for (const f of c.files) {
    out.set(f.data, cursor);
    cursor += f.data.length;
  }

  const saltSeed = await generateSaltSeed(out);
  out.set(saltSeed.subarray(0, 0x14), 0x8); // salt
  const hmac = await getPsv2Hmac(out, saltSeed);
  out.set(hmac, 0x1c); // HMAC
  return out;
}

export async function writePs2Container(c: Ps2Container): Promise<Uint8Array> {
  switch (c.format) {
    case Ps2ContainerFormat.MaxDrive:
      return writeMax(c);
    case Ps2ContainerFormat.Ems:
      return writeEms(c);
    case Ps2ContainerFormat.SharkPort:
    case Ps2ContainerFormat.XPort:
      return writeSharkPort(c);
    case Ps2ContainerFormat.CodeBreaker:
      return writeCodeBreaker(c);
    case Ps2ContainerFormat.Psv:
      return writePsv(c);
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
