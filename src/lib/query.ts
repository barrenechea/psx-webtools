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

export const gameDataKeys = {
  all: ["game-data"] as const,
  details: (region: string, gameId: string) =>
    [...gameDataKeys.all, "details", region, gameId] as const,
};

export interface GameData {
  commonTitle: string;
  cover: string | null;
  description: string;
  developer: string;
  discs: number;
  genre: string;
  id: string | string[];
  languages: string[];
  officialTitle: string;
  publisher: string;
  region: string;
  releaseDate: string;
  title: string;
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

// Kick the cover into the browser HTTP cache so the details sidebar's <img>
// can paint without a second round-trip. Failures are ignored: a missing
// cover must not fail the JSON query.
function warmCoverCache(url: string): void {
  const img = new Image();
  img.src = url;
}

export async function fetchGameData(
  region: string,
  gameId: string,
): Promise<GameData> {
  const apiRegion = mapRegionToApi(region);
  const response = await fetch(
    `https://ps1data.pages.dev/${apiRegion}/${gameId}.json`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch game data");
  }

  const data = (await response.json()) as GameData;
  const cover = data.cover
    ? `https://ps1data.pages.dev/${apiRegion}/covers/${gameId}.${data.cover.split(".").pop()}`
    : null;

  if (cover) warmCoverCache(cover);

  return { ...data, cover };
}
