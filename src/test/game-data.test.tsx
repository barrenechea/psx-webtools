import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  gameDataTargetsFromSaves,
  usePrefetchGameData,
} from "@/hooks/use-game-data";
import { type SaveInfo, SlotTypes } from "@/lib/ps1-memory-card";
import { fetchGameData, type GameData, gameDataKeys } from "@/lib/query";

function save(overrides: Partial<SaveInfo> = {}): SaveInfo {
  return {
    slotNumber: 0,
    name: "Test",
    productCode: "SCES-00001",
    identifier: "TESTGAME",
    region: "Europe",
    regionRaw: "BE",
    blockCount: 1,
    iconFrameCount: 1,
    slotType: SlotTypes.Initial,
    comment: "",
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

const sampleGame: GameData = {
  commonTitle: "Ridge Racer",
  cover: "cover.png",
  description: "",
  developer: "Namco",
  discs: 1,
  genre: "Racing",
  id: "SCES-00001",
  languages: ["en"],
  officialTitle: "Ridge Racer",
  publisher: "Sony",
  region: "Europe",
  releaseDate: "1995",
  title: "Ridge Racer",
};

describe("gameDataTargetsFromSaves", () => {
  it("dedupes slots that share a region and product code", () => {
    expect(
      gameDataTargetsFromSaves([
        save({ slotNumber: 0, productCode: "SCES-00001" }),
        save({ slotNumber: 1, productCode: "SCES-00001" }),
        save({ slotNumber: 2, productCode: "SCES-00001" }),
      ]),
    ).toEqual([{ region: "Europe", gameId: "SCES-00001" }]);
  });

  it("collects unique initial saves and skips empty, linked, and formatted slots", () => {
    expect(
      gameDataTargetsFromSaves([
        save({ productCode: "", region: "Europe" }),
        save({
          slotNumber: 1,
          slotType: SlotTypes.Formatted,
          productCode: "SCES-00002",
        }),
        save({
          slotNumber: 2,
          slotType: SlotTypes.MiddleLink,
          productCode: "SCES-00003",
        }),
        save({
          slotNumber: 3,
          slotType: SlotTypes.DeletedInitial,
          productCode: "SCUS-94103",
          region: "America",
        }),
        save({ productCode: "SCES-00001", region: "Europe" }),
        save({
          slotNumber: 5,
          productCode: "SCES-00001",
          region: "Europe",
        }),
        save({
          slotNumber: 6,
          productCode: "SLPS-00001",
          region: "Japan",
        }),
      ]),
    ).toEqual([
      { region: "America", gameId: "SCUS-94103" },
      { region: "Europe", gameId: "SCES-00001" },
      { region: "Japan", gameId: "SLPS-00001" },
    ]);
  });
});

describe("fetchGameData", () => {
  const coverSrcs: string[] = [];

  beforeEach(() => {
    coverSrcs.length = 0;
    vi.stubGlobal(
      "Image",
      class {
        set src(value: string) {
          coverSrcs.push(value);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rewrites the cover URL and warms the image cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(sampleGame));

    const data = await fetchGameData("Europe", "SCES-00001");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://ps1data.pages.dev/Europe/SCES-00001.json",
    );
    expect(data.cover).toBe(
      "https://ps1data.pages.dev/Europe/covers/SCES-00001.png",
    );
    expect(coverSrcs).toEqual([data.cover]);
  });

  it("skips cover warming when the game has no cover", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ...sampleGame, cover: null }),
    );

    const data = await fetchGameData("America", "SCUS-94103");

    expect(data.cover).toBeNull();
    expect(coverSrcs).toEqual([]);
  });

  it("throws when the API response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, false));

    await expect(fetchGameData("Europe", "SCES-00001")).rejects.toThrow(
      "Failed to fetch game data",
    );
    expect(coverSrcs).toEqual([]);
  });
});

describe("usePrefetchGameData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefetches unique save metadata once per game, not once per slot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(sampleGame));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    renderHook(
      () =>
        usePrefetchGameData([
          save(),
          save({ slotNumber: 1, productCode: "SCES-00001" }),
          save({ slotType: SlotTypes.Formatted, productCode: "SCES-00999" }),
        ]),
      { wrapper },
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData(gameDataKeys.details("Europe", "SCES-00001")),
      ).toMatchObject({ officialTitle: "Ridge Racer" });
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
