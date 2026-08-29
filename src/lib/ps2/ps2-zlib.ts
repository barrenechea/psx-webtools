// zlib (RFC 1950) inflate over the Web DecompressionStream API. Used to decode
// the CodeBreaker (.cbs) body, which is RC4 keystream then a zlib stream. The
// "deflate" label covers the full zlib wrapper (2-byte header + adler32).

export async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const decompressor = new DecompressionStream("deflate");
  const source = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(decompressor);
  const reader = source.getReader();
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
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}

/**
 * The inverse of {@link inflateZlib}: a zlib (RFC 1950) deflation over the Web
 * CompressionStream API. Produces the stream the CodeBreaker (.cbs) body
 * expects (the 2-byte zlib header + adler32 wrapper, not raw deflate).
 */
export async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const compressor = new CompressionStream("deflate");
  const source = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(compressor);
  const reader = source.getReader();
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
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}
