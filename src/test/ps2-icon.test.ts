// PS2 3D icon file parser: header, static geometry/animation segment walk, and
// A1B5G5R5 texture decoding (raw and RLE-compressed).

import { parsePs2Icon } from "@/lib/ps2/ps2-icon";
import {
  PS2_ICON_CAMERA_DISTANCE,
  PS2_ICON_LIGHT_INTENSITY,
  PS2_ICON_SPIN_RAD_PER_SEC,
  ps2IconCameraPosition,
  ps2IconShouldAnimate,
  toPs2IconDisplay,
} from "@/lib/ps2/ps2-icon-render";
import {
  ICON_SYS_TRANSPARENCY_OPAQUE,
  iconSysBackgroundAlpha,
} from "@/lib/ps2/ps2-iconsys";
import {
  iconLightingOrBiosDefault,
  PS2_BIOS_DEFAULT_LIGHTING,
  PS2_STOCK_ICON_FILES,
  stockIconFileForSave,
} from "@/lib/ps2/ps2-stock-icon";

const SIZE = 128;

interface BuildIconOpts {
  texType: number;
  pixel: number;
  vertexCount?: number;
  animShapes?: number;
  frameCount?: number;
  keyCount?: number;
}

// One uniform-pixel icon with configurable segment sizes.
function buildIcon(opts: BuildIconOpts): Uint8Array {
  const animShapes = opts.animShapes ?? 1;
  const vertexCount = opts.vertexCount ?? 3;
  const frameCount = opts.frameCount ?? 1;
  const keyCount = opts.keyCount ?? 1;
  const perVertex = animShapes * 8 + 8 + 4 + 4;
  const frameSize = 8 + keyCount * 8;
  const animStart = 20 + vertexCount * perVertex;
  const frameStart = animStart + 20;
  const texStart = frameStart + frameCount * frameSize;

  const texBytes = new Uint8Array(SIZE * SIZE * 2);
  for (let i = 0; i < SIZE * SIZE; i++) {
    texBytes[i * 2] = opts.pixel & 0xff;
    texBytes[i * 2 + 1] = (opts.pixel >> 8) & 0xff;
  }
  let texSeg: Uint8Array;
  if ((opts.texType & 0x08) !== 0) {
    // One RLE literal run covering the whole texture.
    const code = 0x8000 | (0x8000 - SIZE * SIZE);
    const size = 2 + texBytes.length;
    texSeg = new Uint8Array(4 + size);
    texSeg[0] = size & 0xff;
    texSeg[1] = (size >> 8) & 0xff;
    texSeg[2] = (size >> 16) & 0xff;
    texSeg[3] = (size >> 24) & 0xff;
    texSeg[4] = code & 0xff;
    texSeg[5] = (code >> 8) & 0xff;
    texSeg.set(texBytes, 6);
  } else {
    texSeg = texBytes;
  }

  const out = new Uint8Array(texStart + texSeg.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000, true); // magic
  view.setUint32(4, animShapes, true);
  view.setUint32(8, opts.texType, true);
  view.setFloat32(12, 1, true); // OSDSYS scale (0x3F800000)
  view.setUint32(16, vertexCount, true);
  view.setUint32(animStart, 0x01, true); // animation magic
  view.setUint32(animStart + 4, frameCount, true); // frameLength
  view.setFloat32(animStart + 8, 1.5, true); // animSpeed
  view.setUint32(animStart + 12, 7, true); // playOffset
  view.setUint32(animStart + 16, frameCount, true); // frameCount
  for (let f = 0; f < frameCount; f++) {
    view.setUint32(frameStart + f * frameSize + 4, keyCount, true);
  }
  out.set(texSeg, texStart);
  return out;
}

describe("parsePs2Icon", () => {
  it("parses a raw (uncompressed) texture", () => {
    const icon = parsePs2Icon(buildIcon({ texType: 0x04, pixel: 0xffff }));
    expect(icon).not.toBeNull();
    expect(icon?.vertexCount).toBe(3);
    expect(icon?.frameLength).toBe(1);
    expect(icon?.animSpeed).toBe(1.5);
    expect(icon?.playOffset).toBe(7);
    expect(icon?.vertexScale).toBe(1);
    const texture = icon?.texture;
    expect(texture?.length).toBe(SIZE * SIZE * 4);
    // 0xFFFF: r5=g5=b5=31, A1 set → bit-replicated 255, opaque.
    expect([...(texture?.subarray(0, 4) ?? [])]).toEqual([255, 255, 255, 255]);
  });

  it("parses an RLE-compressed texture", () => {
    const icon = parsePs2Icon(buildIcon({ texType: 0x0c, pixel: 0x5555 }));
    const texture = icon?.texture;
    // 0x5555: r5=21, g5=10, b5=21, A1 clear (still opaque).
    expect([...(texture?.subarray(0, 4) ?? [])]).toEqual([173, 82, 173, 255]);
  });

  it("locates the texture past larger geometry and animation segments", () => {
    const icon = parsePs2Icon(
      buildIcon({
        texType: 0x04,
        vertexCount: 3,
        animShapes: 2,
        frameCount: 4,
        keyCount: 5,
        pixel: 0x30c3,
      }),
    );
    // 0x30C3: r5=3, g5=6, b5=12, A1 clear (still opaque).
    expect([...(icon?.texture?.subarray(0, 4) ?? [])]).toEqual([
      24, 49, 99, 255,
    ]);
  });

  it("parses geometry attributes (positions, normals, uv, colors)", () => {
    const data = buildIcon({
      texType: 0x04,
      vertexCount: 3,
      animShapes: 2,
      pixel: 0xffff,
    });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    // Vertex 0: two shape position blocks, then normal, uv and color.
    view.setInt16(20, 100, true);
    view.setInt16(22, 200, true);
    view.setInt16(24, 300, true);
    view.setInt16(28, -100, true);
    view.setInt16(30, -200, true);
    view.setInt16(32, -300, true);
    view.setInt16(36, 1000, true);
    view.setInt16(38, 2000, true);
    view.setInt16(40, 3000, true);
    view.setInt16(44, 500, true);
    view.setInt16(46, 1500, true);
    data[48] = 10;
    data[49] = 20;
    data[50] = 30;
    data[51] = 40;
    const frameStart = 20 + 3 * (2 * 8 + 16) + 20;
    view.setUint32(frameStart, 1, true);
    view.setFloat32(frameStart + 8, 30, true);
    view.setFloat32(frameStart + 12, 1, true);
    const icon = parsePs2Icon(data);
    expect([...(icon?.positions[0] ?? [])]).toEqual([
      100 / 4096,
      200 / 4096,
      300 / 4096,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect([...(icon?.positions[1] ?? [])]).toEqual([
      -100 / 4096,
      -200 / 4096,
      -300 / 4096,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect([...(icon?.normals ?? [])]).toEqual([
      1000 / 4096,
      2000 / 4096,
      3000 / 4096,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect([...(icon?.uvs ?? [])]).toEqual([
      500 / 4096,
      1500 / 4096,
      0,
      0,
      0,
      0,
    ]);
    expect([...(icon?.colors ?? new Uint8Array())]).toEqual([
      10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(icon?.frames).toEqual([{ shapeId: 1, keys: [[30, 1]] }]);
  });

  it("rejects invalid data", () => {
    expect(parsePs2Icon(new Uint8Array(10))).toBeNull();
    const broken = buildIcon({ texType: 0x04, pixel: 1 });
    broken[0] = 0xff; // break the magic
    expect(parsePs2Icon(broken)).toBeNull();
    const noTexture = buildIcon({ texType: 0x00, pixel: 1 });
    expect(parsePs2Icon(noTexture)?.texture).toBeNull();
    const negativeScale = buildIcon({ texType: 0x04, pixel: 1 });
    new DataView(negativeScale.buffer).setFloat32(12, -1, true);
    expect(parsePs2Icon(negativeScale)).toBeNull();
    const zeroScale = buildIcon({ texType: 0x04, pixel: 1 });
    new DataView(zeroScale.buffer).setFloat32(12, 0, true);
    expect(parsePs2Icon(zeroScale)?.vertexScale).toBe(1);
    const badShapes = buildIcon({ texType: 0x04, pixel: 1 });
    new DataView(badShapes.buffer).setUint32(4, 3, true);
    expect(parsePs2Icon(badShapes)).toBeNull();
    expect(
      parsePs2Icon(buildIcon({ texType: 0x04, pixel: 1, vertexCount: 1 })),
    ).toBeNull();
  });
});

describe("OSDSYS stock icon", () => {
  it("maps system-config saves to ICOBYSYS and others to ICOBFBRK", () => {
    expect(
      stockIconFileForSave({ name: "BEDATA-SYSTEM", viewIcon: "_SCE8" }),
    ).toBe(PS2_STOCK_ICON_FILES.system);
    expect(
      stockIconFileForSave({ name: "BADATA-SYSTEM", viewIcon: "_SCE8" }),
    ).toBe(PS2_STOCK_ICON_FILES.system);
    expect(stockIconFileForSave({ name: "BIDATA-SYSTEM", viewIcon: "" })).toBe(
      PS2_STOCK_ICON_FILES.system,
    );
    expect(
      stockIconFileForSave({ name: "BASLUS-21590GTA40001", viewIcon: "" }),
    ).toBe(PS2_STOCK_ICON_FILES.broken);
    expect(
      stockIconFileForSave({
        name: "BASLUS-21590GTA40001",
        viewIcon: "icon.icn",
      }),
    ).toBe(PS2_STOCK_ICON_FILES.broken);
  });

  it("uses BIOS lighting when on-card lighting is missing or zeroed", () => {
    expect(iconLightingOrBiosDefault(null)).toEqual(PS2_BIOS_DEFAULT_LIGHTING);
    expect(
      iconLightingOrBiosDefault({
        dirs: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        cols: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        ambient: [0, 0, 0],
      }),
    ).toEqual(PS2_BIOS_DEFAULT_LIGHTING);
    const custom = {
      dirs: [[1, 0, 0]],
      cols: [[0.2, 0.3, 0.4]],
      ambient: [0.1, 0.1, 0.1],
    };
    expect(iconLightingOrBiosDefault(custom)).toBe(custom);
  });

  it("maps icon.sys transparency 0x00..0x80 to opacity", () => {
    expect(iconSysBackgroundAlpha(0)).toBe(0);
    expect(iconSysBackgroundAlpha(ICON_SYS_TRANSPARENCY_OPAQUE)).toBe(1);
    expect(iconSysBackgroundAlpha(0x40)).toBe(0.5);
    expect(iconSysBackgroundAlpha(0x100)).toBe(1);
  });
});

describe("icon thumbnail display", () => {
  it("negates X and Y into the display orientation", () => {
    expect(toPs2IconDisplay(1, 2, 3)).toEqual([-1, -2, 3]);
  });

  it("uses a fixed camera instead of auto-fit", () => {
    const [x, y, z] = ps2IconCameraPosition();
    expect(x).toBe(0);
    expect(y).toBeCloseTo(Math.sin(Math.PI / 12) * PS2_ICON_CAMERA_DISTANCE);
    expect(z).toBeCloseTo(-Math.cos(Math.PI / 12) * PS2_ICON_CAMERA_DISTANCE);
  });

  it("uses Lambert intensity π to undo three.js 1/π", () => {
    expect(PS2_ICON_LIGHT_INTENSITY).toBe(Math.PI);
  });

  it("animates selected single-track icons", () => {
    expect(ps2IconShouldAnimate(true, { frames: [{}], frameLength: 1 })).toBe(
      true,
    );
    expect(ps2IconShouldAnimate(true, { frames: [], frameLength: 0 })).toBe(
      true,
    );
    expect(ps2IconShouldAnimate(false, { frames: [{}], frameLength: 1 })).toBe(
      false,
    );
    expect(ps2IconShouldAnimate(true, null)).toBe(false);
  });

  it("uses a 0.523 rad/s Y-spin stand-in", () => {
    expect(PS2_ICON_SPIN_RAD_PER_SEC).toBe(0.523);
  });
});
