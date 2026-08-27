// OSDSYS built-in 3D icons from ROMDIR ICOIMAGE. `_SCE8` (Your System
// Configuration / BEDATA-SYSTEM) is ICOBYSYS; missing or unreadable save
// icons use ICOBFBRK, the untextured cube.

import type { Ps2IconModel } from "./ps2-icon";
import { parsePs2Icon } from "./ps2-icon";
import type { Ps2SaveInfo } from "./ps2-types";

const STOCK_ICON_BASE = `${import.meta.env.BASE_URL}ps2/`;

export const PS2_STOCK_ICON_FILES = {
  broken: "icobfbrk.icn",
  system: "icobysys.icn",
} as const;

export type Ps2StockIconFile =
  (typeof PS2_STOCK_ICON_FILES)[keyof typeof PS2_STOCK_ICON_FILES];

/** Lighting from the BIOS default `_SCE8` icon.sys blobs. */
export const PS2_BIOS_DEFAULT_LIGHTING: NonNullable<
  Ps2SaveInfo["iconLighting"]
> = {
  dirs: [
    [0.5, 0.5, 0.5],
    [0, -0.4, -1],
    [-0.5, -0.5, 0.5],
  ],
  cols: [
    [0.48, 0.48, 0.43],
    [0.26, 0.33, 0.5],
    [0.14, 0.14, 0.38],
  ],
  ambient: [0.24, 0.24, 0.24],
};

function channelHasLight(values: number[] | undefined): boolean {
  return (values ?? []).some((value) => value !== 0 && Number.isFinite(value));
}

/** Use on-card lighting when it has energy; otherwise the BIOS defaults. */
export function iconLightingOrBiosDefault(
  lighting: Ps2SaveInfo["iconLighting"],
): NonNullable<Ps2SaveInfo["iconLighting"]> {
  if (!lighting) return PS2_BIOS_DEFAULT_LIGHTING;
  const lit =
    channelHasLight(lighting.ambient) ||
    lighting.cols.some((col) => channelHasLight(col));
  return lit ? lighting : PS2_BIOS_DEFAULT_LIGHTING;
}

function isSystemConfigDir(name: string): boolean {
  return /^B[IEA]DATA-SYSTEM$/i.test(name);
}

/** Built-in ICOIMAGE member used when the save has no on-card 3D icon file. */
export function stockIconFileForSave(
  save: Pick<Ps2SaveInfo, "name" | "viewIcon">,
): Ps2StockIconFile {
  if (save.viewIcon.toUpperCase() === "_SCE8" || isSystemConfigDir(save.name)) {
    return PS2_STOCK_ICON_FILES.system;
  }
  return PS2_STOCK_ICON_FILES.broken;
}

export function stockIconUrl(file: Ps2StockIconFile): string {
  return `${STOCK_ICON_BASE}${file}`;
}

const stockIconCache = new Map<string, Promise<Ps2IconModel | null>>();

async function fetchStockIcon(url: string): Promise<Ps2IconModel | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return parsePs2Icon(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Load and parse a built-in OSDSYS icon; cached per URL. */
export function loadStockPs2Icon(
  file: Ps2StockIconFile = PS2_STOCK_ICON_FILES.broken,
): Promise<Ps2IconModel | null> {
  const url = stockIconUrl(file);
  let pending = stockIconCache.get(url);
  if (!pending) {
    pending = fetchStockIcon(url);
    stockIconCache.set(url, pending);
  }
  return pending;
}
