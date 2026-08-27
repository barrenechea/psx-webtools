// PS2 3D icon file (.ico/.icn) reader: morph geometry, animation keys, and the
// A1B5G5R5 texture (RLE-compressed or raw). Coordinates are stored as 1/4096
// fixed point values.

export const ICON_TEXTURE_SIZE = 128;
const ICON_MAGIC = 0x00010000;
const ANIM_MAGIC = 0x01;
const FIXED_POINT = 4096;
const VALID_SHAPE_COUNTS = new Set([1, 2, 4, 6, 8]);
const SHAPE_VERTEX_CAPS: Record<number, number> = {
  1: 1800,
  2: 1650,
  4: 1500,
  6: 1350,
  8: 1200,
};

function expand5(value: number): number {
  return (value << 3) | (value >> 2);
}

export interface Ps2IconFrame {
  shapeId: number;
  /** (time, weight) keyframes. */
  keys: [number, number][];
}

export interface Ps2IconModel {
  vertexCount: number;
  frameLength: number;
  animSpeed: number;
  /** Animation-header play offset (cycle start), from OSDSYS. */
  playOffset: number;
  /** Header float at +0x0C; BIOS rejects negatives. Typical 1.0. */
  vertexScale: number;
  /** Morph shapes, each containing [vertexCount x 3] floats. */
  positions: Float32Array[];
  /** Per-vertex normals, [vertexCount x 3] floats. */
  normals: Float32Array;
  /** Per-vertex UVs, [vertexCount x 2] floats. */
  uvs: Float32Array;
  /** Per-vertex RGBA colors. */
  colors: Uint8Array;
  frames: Ps2IconFrame[];
  /** Opaque RGBA texture data in stored row order. */
  texture: Uint8Array | null;
}

// A1B5G5R5: bit 15 is GS A1. OSDSYS icon TEXA treats A=0 as opaque as well
// (the bit is clear on most save textures); using it as 50% alpha punches
// holes in the mesh, so both values stay opaque here.
function decodeA1B5G5R5(raw: Uint8Array): Uint8Array {
  const data = new Uint8Array(ICON_TEXTURE_SIZE * ICON_TEXTURE_SIZE * 4);
  const pixelCount = Math.min(
    raw.length >> 1,
    ICON_TEXTURE_SIZE * ICON_TEXTURE_SIZE,
  );
  for (let i = 0; i < pixelCount; i++) {
    const p = raw[i * 2] | (raw[i * 2 + 1] << 8);
    data[i * 4] = expand5(p & 0x1f);
    data[i * 4 + 1] = expand5((p >> 5) & 0x1f);
    data[i * 4 + 2] = expand5((p >> 10) & 0x1f);
    data[i * 4 + 3] = 255;
  }
  return data;
}

// RLE: a code with the MSB set copies `0x8000 - (code ^ 0x8000)` u16s verbatim;
// a small code repeats the following u16 `code` times.
function decodeRle(data: Uint8Array): Uint8Array | null {
  const out = new Uint8Array(ICON_TEXTURE_SIZE * ICON_TEXTURE_SIZE * 2);
  let outLen = 0;
  let off = 0;
  while (off < data.length && outLen < out.length) {
    if (off + 2 > data.length) return null;
    const code = data[off] | (data[off + 1] << 8);
    off += 2;
    if ((code & 0x8000) !== 0) {
      const count = 0x8000 - (code ^ 0x8000);
      const byteCount = count * 2;
      if (off + byteCount > data.length) return null;
      const writable = Math.min(byteCount, out.length - outLen);
      out.set(data.subarray(off, off + writable), outLen);
      outLen += writable;
      off += byteCount;
    } else if (code > 0) {
      if (off + 2 > data.length) return null;
      const lo = data[off];
      const hi = data[off + 1];
      off += 2;
      for (let i = 0; i < code && outLen < out.length; i++) {
        out[outLen++] = lo;
        out[outLen++] = hi;
      }
    }
  }
  return out;
}

/** Parse a 3D icon file. Null when the data is not a valid icon. */
export function parsePs2Icon(raw: Uint8Array): Ps2IconModel | null {
  if (raw.length < 20) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = view.getUint32(0, true);
  const animShapes = view.getUint32(4, true);
  const texType = view.getUint32(8, true);
  const headerScale = view.getFloat32(12, true);
  const vertexCount = view.getUint32(16, true);
  if (magic !== ICON_MAGIC || !VALID_SHAPE_COUNTS.has(animShapes)) {
    return null;
  }
  if (vertexCount === 0 || vertexCount % 3 !== 0) return null;
  if (vertexCount > (SHAPE_VERTEX_CAPS[animShapes] ?? 0)) return null;
  // OSDSYS: lwc1 of +0x0C, c.lt.s vs 0, reject if negative. 0 is stored; the
  // GIF/VU path still draws those icons (ICOIMAGE members often have 0), so
  // treat non-positive as identity rather than collapsing the mesh.
  if (!Number.isFinite(headerScale) || headerScale < 0) return null;
  const vertexScale = headerScale > 0 ? headerScale : 1;
  if (20 + vertexCount * (animShapes * 8 + 16) > raw.length) return null;

  // Geometry: per vertex, one position block per morph shape (3xint16 + u16
  // which OSDSYS copies into the GIF/VU record and then writes W=1.0), a
  // normal block, 2xint16 uv and 4xuint8 color. Positions/normals: lh +
  // cvt.s.w × 1/4096 (`lui 0x3980`) then the header scale.
  const xyzScale = vertexScale / FIXED_POINT;
  const uvScale = 1 / FIXED_POINT;
  const positions = Array.from(
    { length: animShapes },
    () => new Float32Array(vertexCount * 3),
  );
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Uint8Array(vertexCount * 4);
  let offset = 20;
  for (let v = 0; v < vertexCount; v++) {
    for (let shape = 0; shape < animShapes; shape++) {
      positions[shape][v * 3] = view.getInt16(offset, true) * xyzScale;
      positions[shape][v * 3 + 1] = view.getInt16(offset + 2, true) * xyzScale;
      positions[shape][v * 3 + 2] = view.getInt16(offset + 4, true) * xyzScale;
      offset += 8;
    }
    normals[v * 3] = view.getInt16(offset, true) * xyzScale;
    normals[v * 3 + 1] = view.getInt16(offset + 2, true) * xyzScale;
    normals[v * 3 + 2] = view.getInt16(offset + 4, true) * xyzScale;
    offset += 8;
    uvs[v * 2] = view.getInt16(offset, true) * uvScale;
    uvs[v * 2 + 1] = view.getInt16(offset + 2, true) * uvScale;
    offset += 4;
    colors[v * 4] = raw[offset];
    colors[v * 4 + 1] = raw[offset + 1];
    colors[v * 4 + 2] = raw[offset + 2];
    colors[v * 4 + 3] = raw[offset + 3];
    offset += 4;
  }

  // Animation header.
  if (offset + 20 > raw.length) return null;
  const animMagic = view.getUint32(offset, true);
  const frameLength = view.getUint32(offset + 4, true);
  const animSpeed = view.getFloat32(offset + 8, true);
  const playOffset = view.getUint32(offset + 12, true);
  const frameCount = view.getUint32(offset + 16, true);
  offset += 20;
  if (animMagic !== ANIM_MAGIC) return null;

  const frames: Ps2IconFrame[] = [];
  for (let f = 0; f < frameCount; f++) {
    if (offset + 8 > raw.length) return null;
    const shapeId = view.getUint32(offset, true);
    const keyCount = view.getUint32(offset + 4, true);
    const frameSize = 8 + keyCount * 8;
    if (offset + frameSize > raw.length) return null;
    const keys: [number, number][] = [];
    for (let key = 0; key < keyCount; key++) {
      keys.push([
        view.getFloat32(offset + 8 + key * 8, true),
        view.getFloat32(offset + 12 + key * 8, true),
      ]);
    }
    if (keys.length === 0) keys.push([0, f === 0 ? 1 : 0]);
    frames.push({ shapeId, keys });
    offset += frameSize;
  }

  let texture: Uint8Array | null = null;
  if ((texType & 0x04) !== 0) {
    if ((texType & 0x08) !== 0) {
      if (offset + 4 > raw.length) return null;
      const compressedSize = view.getUint32(offset, true);
      offset += 4;
      if (compressedSize % 2 !== 0 || offset + compressedSize > raw.length) {
        return null;
      }
      const decoded = decodeRle(raw.subarray(offset, offset + compressedSize));
      if (!decoded) return null;
      texture = decodeA1B5G5R5(decoded);
    } else {
      const size = ICON_TEXTURE_SIZE * ICON_TEXTURE_SIZE * 2;
      texture = decodeA1B5G5R5(
        raw.subarray(offset, Math.min(offset + size, raw.length)),
      );
    }
  }

  return {
    vertexCount,
    frameLength,
    animSpeed,
    playOffset,
    vertexScale,
    positions,
    normals,
    uvs,
    colors,
    frames,
    texture,
  };
}
