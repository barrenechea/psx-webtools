// Thumbnail view of OSDSYS native 3D save icons. The EE parser writes
// stored (x, y, z) × 1/4096 with W = 1.0 and does not negate axes.
// View, spin, Lambert, and drop-shadow live on VU1/GS and were not
// recovered from the EE payload; these constants are the thumbnail stand-in.

/** Look at stored vertices from −Z with Y up (180° around Z). */
export function toPs2IconDisplay(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [-x, -y, z];
}

/**
 * icon.sys dirs/colors/ambient as OSDSYS copies them. EE COP1 has no madd.s;
 * N·L is VU1/GS. Thumbnails use `ambient + Σ max(N·L, 0) * color`. three.js
 * Lambert is N·L / π, so intensity π recovers that sum.
 */
export const PS2_ICON_LIGHT_INTENSITY = Math.PI;

/** Fixed camera (OSDSYS does not auto-fit). VU1 view matrix not recovered. */
export const PS2_ICON_CAMERA_FOV = 45;
export const PS2_ICON_CAMERA_DISTANCE = 5;
export const PS2_ICON_CAMERA_ELEVATION = Math.PI / 12;

export function ps2IconCameraPosition(): [number, number, number] {
  return [
    0,
    Math.sin(PS2_ICON_CAMERA_ELEVATION) * PS2_ICON_CAMERA_DISTANCE,
    -Math.cos(PS2_ICON_CAMERA_ELEVATION) * PS2_ICON_CAMERA_DISTANCE,
  ];
}

/** Selected-icon Y spin. OSDSYS vsync increment not recovered from EE COP1. */
export const PS2_ICON_SPIN_RAD_PER_SEC = 0.523;

/**
 * Ground blob. ICOIMAGE has no shadow member; VU1/GS drop-shadow was not
 * recovered from the EE payload.
 */
export const PS2_ICON_SHADOW_CENTER_ALPHA = 0.35;
export const PS2_ICON_SHADOW_SIZE_FACTOR = 1.5;

/** Selected/sidebar icons always spin, including single-track meshes. */
export function ps2IconShouldAnimate(
  animate: boolean,
  model: object | null,
): boolean {
  return animate && model !== null;
}
