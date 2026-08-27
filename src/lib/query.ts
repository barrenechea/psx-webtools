import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // Data is fresh for 5 minutes
      gcTime: 1000 * 60 * 60, // Unused data is garbage collected after 1 hour
      retry: 1,
    },
  },
});

export type GamePlatform = "ps1" | "ps2";

export const gameDataKeys = {
  all: ["game-data"] as const,
  details: (platform: GamePlatform, region: string, gameId: string) =>
    [...gameDataKeys.all, "details", platform, region, gameId] as const,
};

export interface GameDataTarget {
  platform: GamePlatform;
  region: string;
  gameId: string;
}

export interface GameData {
  commonTitle?: string;
  cover: string | null;
  description?: string;
  developer?: string;
  discs?: number;
  genre?: string;
  id: string | string[];
  languages?: string[];
  officialTitle?: string;
  publisher?: string;
  region?: string;
  releaseDate?: string;
  title: string;
}

const GAME_DATA_ORIGIN: Record<GamePlatform, string> = {
  ps1: "https://ps1data.pages.dev",
  ps2: "https://ps2data.pages.dev",
};

/** Four-letter serial prefix → DataCenter region folder. */
const PRODUCT_PREFIX_REGION: Record<string, string> = {
  SLUS: "America",
  SCUS: "America",
  SLES: "Europe",
  SCES: "Europe",
  SLED: "Europe",
  SCED: "Europe",
  TLES: "Europe",
  TCES: "Europe",
  SLPS: "Japan",
  SCPS: "Japan",
  SLPM: "Japan",
  SCPM: "Japan",
  SCAJ: "Japan",
  SLAJ: "Japan",
  SCCS: "Japan",
  SLKA: "Japan",
  SCKA: "Japan",
  SCPN: "Japan",
  TCPS: "Japan",
};

const GAME_SERIAL = /^[A-Z]{4}-\d{5}$/i;

export function isGameSerial(productCode: string): boolean {
  return GAME_SERIAL.test(productCode.trim());
}

/** DataCenter region folder encoded in a product code (`SLUS-20062` → America). */
export function regionOfProductCode(productCode: string): string | null {
  const prefix = productCode.trim().split("-")[0]?.toUpperCase();
  if (!prefix) return null;
  return PRODUCT_PREFIX_REGION[prefix] ?? null;
}

function mapRegionToApi(region: string): string {
  switch (region.toLowerCase()) {
    case "america":
    case "usa":
    case "ntsc-u":
      return "America";
    case "europe":
    case "pal":
    case "ntsc-pal":
      return "Europe";
    case "japan":
    case "ntsc-j":
      return "Japan";
    default:
      return "America";
  }
}

export function resolveGameDataRegion(region: string, gameId: string): string {
  if (region) return mapRegionToApi(region);
  return regionOfProductCode(gameId) ?? "";
}

// Kick the cover into the browser HTTP cache so the details sidebar's <img>
// can paint without a second round-trip. Failures are ignored: a missing
// cover must not fail the JSON query.
function warmCoverCache(url: string): void {
  const img = new Image();
  img.src = url;
}

export async function fetchGameData(
  platform: GamePlatform,
  region: string,
  gameId: string,
): Promise<GameData> {
  const apiRegion = resolveGameDataRegion(region, gameId);
  const origin = GAME_DATA_ORIGIN[platform];
  const response = await fetch(`${origin}/${apiRegion}/${gameId}.json`);

  if (!response.ok) {
    throw new Error("Failed to fetch game data");
  }

  const data = (await response.json()) as GameData;
  const cover = data.cover
    ? `${origin}/${apiRegion}/covers/${gameId}.${data.cover.split(".").pop()}`
    : null;

  if (cover) warmCoverCache(cover);

  return { ...data, cover };
}
