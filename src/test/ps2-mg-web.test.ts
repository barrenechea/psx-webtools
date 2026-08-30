import { fetchStandardMgKeysets } from "@/lib/ps2/ps2-mg-web";

// A minimal ps3mca.ini-shaped document that parses to a single key set.
const INI = [
  "[retail]",
  "keychange_param = 1",
  "MG_CARDKEY_0 = 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10",
  "MG_CARDKEY2_0 = 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10",
  "MG_CARDIV_0 = 01 02 03 04 05 06 07 08",
  "MG_CARDIV2_0 = 01 02 03 04 05 06 07 08",
  "MG_CHALLENGE_IV = 01 02 03 04 05 06 07 08",
].join("\n");

describe("fetchStandardMgKeysets", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses the first gateway that yields a parseable key set", async () => {
    const urls: string[] = [];
    globalThis.fetch = ((url: string) => {
      urls.push(url);
      if (urls.length === 1) return Promise.reject(new Error("unreachable"));
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(INI),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    const sections = await fetchStandardMgKeysets();
    expect(sections).toHaveLength(1);
    expect(sections[0].section).toBe("retail");
    expect(urls).toHaveLength(2);
  });

  it("surfaces an error when no gateway returns a key set", async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as unknown as Response)) as unknown as typeof fetch;

    await expect(fetchStandardMgKeysets()).rejects.toThrow(/HTTP 404/);
  });
});
