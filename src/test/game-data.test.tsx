import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  gameDataTargetsFromPs2Saves,
  gameDataTargetsFromSaves,
  usePrefetchGameData,
} from "@/hooks/use-game-data";
import { type SaveInfo, SlotTypes } from "@/lib/ps1-memory-card";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";
import {
  fetchGameData,
  type GameData,
  gameDataKeys,
  isGameSerial,
  regionOfProductCode,
} from "@/lib/query";

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

function ps2Save(overrides: Partial<Ps2SaveInfo> = {}): Ps2SaveInfo {
  return {
    name: "BASLUS-20062GTA30000",
    title: "GTA III",
    iconType: 0,
    created: { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2001 },
    modified: { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2001 },
    entryCount: 4,
    dataCluster: 0,
    hidden: false,
    ps1: false,
    pocketStation: false,
    totalSize: 100,
    files: [],
    background: [],
    backgroundTransparency: 0,
    viewIcon: "",
    iconModel: null,
    iconLighting: null,
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

const samplePs2Game: GameData = {
  id: "SLUS-20062",
  title: "GRAND THEFT AUTO III",
  discs: 1,
  languages: ["en"],
  cover: "https://psxdatacenter.com/psx2/images2/covers/SLUS-20062.jpg",
  description: "",
};

describe("regionOfProductCode", () => {
  it("maps serial prefixes to DataCenter region folders", () => {
    expect(regionOfProductCode("SLUS-20062")).toBe("America");
    expect(regionOfProductCode("SCUS-97399")).toBe("America");
    expect(regionOfProductCode("SLES-54107")).toBe("Europe");
    expect(regionOfProductCode("SCES-53133")).toBe("Europe");
    expect(regionOfProductCode("SLPM-65078")).toBe("Japan");
    expect(regionOfProductCode("SLKA-25001")).toBe("Japan");
    expect(regionOfProductCode("DATA-SYSTEM")).toBeNull();
  });

  it("accepts only standard game serials", () => {
    expect(isGameSerial("SLUS-20062")).toBe(true);
    expect(isGameSerial("DATA-SYSTEM")).toBe(false);
    expect(isGameSerial("EXEC-SYSTEM")).toBe(false);
  });
});

describe("gameDataTargetsFromSaves", () => {
  it("dedupes slots that share a region and product code", () => {
    expect(
      gameDataTargetsFromSaves([
        save({ slotNumber: 0, productCode: "SCES-00001" }),
        save({ slotNumber: 1, productCode: "SCES-00001" }),
        save({ slotNumber: 2, productCode: "SCES-00001" }),
      ]),
    ).toEqual([{ platform: "ps1", region: "Europe", gameId: "SCES-00001" }]);
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
      { platform: "ps1", region: "America", gameId: "SCUS-94103" },
      { platform: "ps1", region: "Europe", gameId: "SCES-00001" },
      { platform: "ps1", region: "Japan", gameId: "SLPS-00001" },
    ]);
  });
});

describe("gameDataTargetsFromPs2Saves", () => {
  it("uses the product code as the game id and infers region from it", () => {
    expect(
      gameDataTargetsFromPs2Saves([
        ps2Save(),
        ps2Save({ name: "BESCES-53133GodOfWar" }),
        ps2Save({ name: "BISLPM-65078MGS2" }),
      ]),
    ).toEqual([
      { platform: "ps2", region: "America", gameId: "SLUS-20062" },
      { platform: "ps2", region: "Europe", gameId: "SCES-53133" },
      { platform: "ps2", region: "Japan", gameId: "SLPM-65078" },
    ]);
  });

  it("skips system directories and dedupes shared product codes", () => {
    expect(
      gameDataTargetsFromPs2Saves([
        ps2Save({ name: "BEDATA-SYSTEM" }),
        ps2Save({ name: "BASLUS-20062GTA30000" }),
        ps2Save({ name: "BASLUS-20062GTA30001" }),
        ps2Save({ name: "BIEXEC-SYSTEM" }),
      ]),
    ).toEqual([{ platform: "ps2", region: "America", gameId: "SLUS-20062" }]);
  });

  it("fetches PS1-on-PS2 saves from ps1data", () => {
    expect(
      gameDataTargetsFromPs2Saves([
        ps2Save({ name: "BASCES-00001RIDGE", ps1: true }),
      ]),
    ).toEqual([{ platform: "ps1", region: "Europe", gameId: "SCES-00001" }]);
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

    const data = await fetchGameData("ps1", "Europe", "SCES-00001");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://ps1data.pages.dev/Europe/SCES-00001.json",
    );
    expect(data.cover).toBe(
      "https://ps1data.pages.dev/Europe/covers/SCES-00001.png",
    );
    expect(coverSrcs).toEqual([data.cover]);
  });

  it("fetches PS2 metadata from ps2data using the product code region", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(samplePs2Game),
    );

    const data = await fetchGameData("ps2", "", "SLUS-20062");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://ps2data.pages.dev/America/SLUS-20062.json",
    );
    expect(data.cover).toBe(
      "https://ps2data.pages.dev/America/covers/SLUS-20062.jpg",
    );
    expect(coverSrcs).toEqual([data.cover]);
  });

  it("skips cover warming when the game has no cover", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ...sampleGame, cover: null }),
    );

    const data = await fetchGameData("ps1", "America", "SCUS-94103");

    expect(data.cover).toBeNull();
    expect(coverSrcs).toEqual([]);
  });

  it("throws when the API response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, false));

    await expect(fetchGameData("ps1", "Europe", "SCES-00001")).rejects.toThrow(
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
        usePrefetchGameData(
          gameDataTargetsFromSaves([
            save(),
            save({ slotNumber: 1, productCode: "SCES-00001" }),
            save({ slotType: SlotTypes.Formatted, productCode: "SCES-00999" }),
          ]),
        ),
      { wrapper },
    );

    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          gameDataKeys.details("ps1", "Europe", "SCES-00001"),
        ),
      ).toMatchObject({ officialTitle: "Ridge Racer" });
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
