import { noop, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { type SaveInfo, SlotTypes } from "@/lib/ps1-memory-card";
import { ps2SaveProductCode, ps2SaveRegion } from "@/lib/ps2/ps2-dirname";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";
import {
  fetchGameData,
  gameDataKeys,
  type GameDataTarget,
  type GamePlatform,
  isGameSerial,
  regionOfProductCode,
  resolveGameDataRegion,
} from "@/lib/query";

export function useGameData(
  platform: GamePlatform,
  region: string,
  gameId: string,
) {
  const apiRegion = resolveGameDataRegion(region, gameId);
  const query = useQuery({
    queryKey: gameDataKeys.details(platform, apiRegion, gameId),
    queryFn: () => fetchGameData(platform, apiRegion, gameId),
    enabled: Boolean(platform && apiRegion && gameId),
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

export function gameDataTargetsFromSaves(saves: SaveInfo[]): GameDataTarget[] {
  const seen = new Set<string>();
  const targets: GameDataTarget[] = [];

  for (const save of saves) {
    if (!PREFETCHABLE_SLOT_TYPES.has(save.slotType)) continue;
    const { region, productCode: gameId } = save;
    const apiRegion = resolveGameDataRegion(region, gameId);
    if (!apiRegion || !gameId) continue;
    const key = `ps1\0${apiRegion}\0${gameId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ platform: "ps1", region: apiRegion, gameId });
  }

  return sortGameDataTargets(targets);
}

export function gameDataTargetsFromPs2Saves(
  saves: Ps2SaveInfo[],
): GameDataTarget[] {
  const seen = new Set<string>();
  const targets: GameDataTarget[] = [];

  for (const save of saves) {
    const gameId = ps2SaveProductCode(save.name);
    if (!isGameSerial(gameId)) continue;
    const region = regionOfProductCode(gameId) ?? ps2SaveRegion(save.name);
    if (!region) continue;
    const platform: GamePlatform = save.ps1 ? "ps1" : "ps2";
    const key = `${platform}\0${region}\0${gameId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ platform, region, gameId });
  }

  return sortGameDataTargets(targets);
}

function sortGameDataTargets(targets: GameDataTarget[]): GameDataTarget[] {
  return targets.sort((a, b) =>
    a.platform === b.platform
      ? a.region === b.region
        ? a.gameId.localeCompare(b.gameId)
        : a.region.localeCompare(b.region)
      : a.platform.localeCompare(b.platform),
  );
}

export function usePrefetchGameData(targets: GameDataTarget[]): void {
  const queryClient = useQueryClient();
  const serialized = JSON.stringify(targets);

  useEffect(() => {
    const parsed = JSON.parse(serialized) as GameDataTarget[];
    for (const { platform, region, gameId } of parsed) {
      void queryClient
        .query({
          queryKey: gameDataKeys.details(platform, region, gameId),
          queryFn: () => fetchGameData(platform, region, gameId),
        })
        .catch(noop);
    }
  }, [queryClient, serialized]);
}
