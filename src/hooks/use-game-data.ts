import { useEffect, useState } from "react";

interface GameData {
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

export function useGameData(platform: string, region: string, gameId: string) {
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGameData = async () => {
      if (!platform || !region || !gameId) {
        setGameData(null);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const apiRegion = mapRegionToApi(region);
        const response = await fetch(
          `https://psxdata.barrenechea.cl/${apiRegion}/${gameId}.json`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch game data");
        }

        const data = (await response.json()) as GameData;
        setGameData({
          ...data,
          cover: data.cover
            ? `https://psxdata.barrenechea.cl/${apiRegion}/covers/${gameId}.${data.cover.split(".").pop()}`
            : null,
        });
      } catch (err) {
        setError((err as Error).message);
        setGameData(null);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchGameData();
  }, [platform, region, gameId]);

  return { gameData, isLoading, error };
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
      return "America"; // Default to America if unknown
  }
}
