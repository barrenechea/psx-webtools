import { noop, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { type SaveInfo, SlotTypes } from "@/lib/ps1-memory-card";
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

const PREFETCHABLE_SLOT_TYPES = new Set([
  SlotTypes.Initial,
  SlotTypes.DeletedInitial,
]);

export function gameDataTargetsFromSaves(
  saves: SaveInfo[],
): { region: string; gameId: string }[] {
  const seen = new Set<string>();
  const targets: { region: string; gameId: string }[] = [];

  for (const save of saves) {
    if (!PREFETCHABLE_SLOT_TYPES.has(save.slotType)) continue;
    const { region, productCode: gameId } = save;
    if (!region || !gameId) continue;
    const key = `${region}\0${gameId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ region, gameId });
  }

  targets.sort((a, b) =>
    a.region === b.region
      ? a.gameId.localeCompare(b.gameId)
      : a.region.localeCompare(b.region),
  );
  return targets;
}

export function usePrefetchGameData(saves: SaveInfo[]): void {
  const queryClient = useQueryClient();
  const serialized = JSON.stringify(gameDataTargetsFromSaves(saves));

  useEffect(() => {
    const targets = JSON.parse(serialized) as {
      region: string;
      gameId: string;
    }[];
    for (const { region, gameId } of targets) {
      void queryClient
        .query({
          queryKey: gameDataKeys.details(region, gameId),
          queryFn: () => fetchGameData(region, gameId),
        })
        .catch(noop);
    }
  }, [queryClient, serialized]);
}
