import { inflateZlib } from "@/lib/ps2/ps2-zlib";

const eq = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// Compress with the Web CompressionStream so the test shares the same API
// family (and environment) as the inflate under test.
async function deflateWeb(data: Uint8Array): Promise<Uint8Array> {
  const compressor = new CompressionStream("deflate");
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(compressor);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe("ps2-zlib", () => {
  it("inflates a zlib stream", async () => {
    const src = new TextEncoder().encode(
      "Hello PS2 memory card, this is a CodeBreaker body payload. 0123456789.",
    );
    const compressed = await deflateWeb(src);
    expect(eq(await inflateZlib(compressed), src)).toBe(true);
  });

  it("round-trips binary and larger payloads", async () => {
    for (const n of [1, 31, 1024, 8192]) {
      const src = new Uint8Array(n);
      for (let i = 0; i < n; i++) src[i] = (i * 131) & 0xff;
      const compressed = await deflateWeb(src);
      expect(eq(await inflateZlib(compressed), src), `n=${n}`).toBe(true);
    }
  });
});
