// PS2 icon.sys (mcIcon) reader/writer. The icon file is the first entry of a
// save directory (always a single 964-byte cluster file) and carries the title
// the console shows, plus icon file names and colors.

export const ICON_SYS_SIZE = 964;
/** icon.sys background transparency: 0x00 clear … 0x80 opaque. */
export const ICON_SYS_TRANSPARENCY_OPAQUE = 0x80;
export const ICON_MAGIC = "PS2D";

/** Map the icon.sys transparency field to CSS/WebGL opacity 0..1. */
export function iconSysBackgroundAlpha(transparency: number): number {
  if (!Number.isFinite(transparency) || transparency <= 0) return 0;
  return (
    Math.min(transparency, ICON_SYS_TRANSPARENCY_OPAQUE) /
    ICON_SYS_TRANSPARENCY_OPAQUE
  );
}

export interface Ps2IconCorner {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Ps2IconSys {
  type: number;
  newlineOffset: number;
  transparency: number;
  /** Background corner colors, top-left, top-right, bottom-left, bottom-right. */
  bgColors: Ps2IconCorner[];
  lightDir: number[][];
  lightCol: number[][];
  lightAmbient: number[];
  title: string;
  viewIcon: string;
  copyIcon: string;
  delIcon: string;
}

function readAscii(data: Uint8Array, off: number, len: number): string {
  let end = 0;
  while (end < len && data[off + end] !== 0) end++;
  let s = "";
  for (let i = 0; i < end; i++) s += String.fromCharCode(data[off + i] & 0x7f);
  return s;
}

// 68-byte null-terminated Shift-JIS byte stream; the double-byte sequences
// span the u16 slots, so both bytes of each slot are title bytes.
function readTitle(data: Uint8Array): string {
  const bytes: number[] = [];
  for (let i = 0; i < 34; i++) {
    const off = 0xc0 + i * 2;
    const lo = data[off];
    const hi = data[off + 1];
    if (lo === 0 && hi === 0) break;
    bytes.push(lo, hi);
  }
  const end = bytes.indexOf(0);
  const buf = Uint8Array.from(end === -1 ? bytes : bytes.slice(0, end));
  try {
    return new TextDecoder("shift-jis").decode(buf).normalize("NFKC");
  } catch {
    try {
      return new TextDecoder("ascii").decode(buf);
    } catch {
      return "Unknown";
    }
  }
}

function writeTitle(data: Uint8Array, title: string): void {
  const raw = new TextEncoder().encode(title);
  for (let i = 0; i < 64; i++) {
    data[0xc0 + i] = i < raw.length ? raw[i] : 0;
  }
}

/** Parse a 964-byte icon.sys. Throws if the magic does not match. */
export function parseIconSys(data: Uint8Array): Ps2IconSys {
  if (data.length < ICON_SYS_SIZE) {
    throw new Error("icon.sys is too small");
  }
  const head = readAscii(data, 0, 4);
  if (head !== ICON_MAGIC) {
    throw new Error("Not an icon.sys (bad magic)");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Four corners, each R,G,B,A stored as a uint32 (value 0..255).
  const bgColors: Ps2IconCorner[] = [];
  for (let i = 0; i < 4; i++) {
    const off = 0x10 + i * 16;
    bgColors.push({
      r: view.getUint32(off, true),
      g: view.getUint32(off + 4, true),
      b: view.getUint32(off + 8, true),
      a: view.getUint32(off + 12, true),
    });
  }
  const lightDir: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const off = 0x50 + i * 16;
    lightDir.push([
      view.getFloat32(off, true),
      view.getFloat32(off + 4, true),
      view.getFloat32(off + 8, true),
    ]);
  }
  const lightCol: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const off = 0x80 + i * 16;
    lightCol.push([
      view.getFloat32(off, true),
      view.getFloat32(off + 4, true),
      view.getFloat32(off + 8, true),
    ]);
  }
  const lightAmbient = [0, 1, 2, 3].map((i) =>
    view.getFloat32(0xb0 + i * 4, true),
  );
  return {
    type: view.getUint16(0x04, true),
    newlineOffset: view.getUint16(0x06, true),
    transparency: view.getUint32(0x0c, true),
    bgColors,
    lightDir,
    lightCol,
    lightAmbient,
    title: readTitle(data),
    viewIcon: readAscii(data, 0x104, 64),
    copyIcon: readAscii(data, 0x144, 64),
    delIcon: readAscii(data, 0x184, 64),
  };
}

export interface Ps2IconSysFields {
  type?: number;
  title?: string;
  newlineOffset?: number;
  transparency?: number;
  bgColors?: Ps2IconCorner[];
  viewIcon?: string;
  copyIcon?: string;
  delIcon?: string;
}

/** Build a 964-byte icon.sys; omitted fields stay zeroed. */
export function buildIconSys(f: Ps2IconSysFields = {}): Uint8Array {
  const data = new Uint8Array(ICON_SYS_SIZE);
  data.fill(0);
  data.set(new TextEncoder().encode(ICON_MAGIC), 0);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint16(0x04, f.type ?? 0, true);
  view.setUint16(0x06, f.newlineOffset ?? 0, true);
  view.setUint32(0x0c, f.transparency ?? 0, true);
  const colors = f.bgColors ?? [];
  for (let i = 0; i < 4; i++) {
    const c = colors[i];
    if (!c) continue;
    const off = 0x10 + i * 16;
    view.setUint32(off, c.r & 0xff, true);
    view.setUint32(off + 4, c.g & 0xff, true);
    view.setUint32(off + 8, c.b & 0xff, true);
    view.setUint32(off + 12, c.a & 0xff, true);
  }
  writeTitle(data, f.title ?? "");
  const writeAscii = (off: number, name: string) => {
    const bytes = new TextEncoder().encode(name);
    for (let i = 0; i < 64 && i < bytes.length; i++) data[off + i] = bytes[i];
  };
  if (f.viewIcon) writeAscii(0x104, f.viewIcon);
  if (f.copyIcon) writeAscii(0x144, f.copyIcon);
  if (f.delIcon) writeAscii(0x184, f.delIcon);
  return data;
}
