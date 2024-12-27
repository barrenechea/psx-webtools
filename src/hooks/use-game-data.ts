import { useQuery } from "@tanstack/react-query";

import { fetchGameData, gameDataKeys } from "@/lib/query";

export function useGameData(platform: string, region: string, gameId: string) {
  const query = useQuery({
    queryKey: gameDataKeys.details(region, gameId),
    queryFn: () => fetchGameData(region, gameId),
    enabled: Boolean(platform && region && gameId),
  });

  return {
    gameData: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
  };
}
