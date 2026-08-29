// LZA-R: the PS2 arithmetic-coded LZ coder used by MAX-format single saves.
// A sliding 4096-byte window emits 3..60-byte matches or literal bytes,
// range-coded (15-bit) with a sliding frequency model. Follows Okumura 1989
// LZARI.C (N=4096, F=60, THRESHOLD=2, M=15): one shared cumulative-frequency
// orientation so encoder and decoder stay in lockstep. Match sources are
// distances 1..N-F — the live window the original tree finder covers; the
// decoder never has the F-byte lookahead. MAX stores the uncompressed length
// in its container header, not as LZARI.C's 4-byte stream prefix. All
// arithmetic stays below 2^33, so plain doubles are exact.

const MIN_MATCH_LEN = 3;
const MAX_MATCH_LEN = 60;
const HIST_LEN = 4096;
const THRESHOLD = MIN_MATCH_LEN - 1;

const N = HIST_LEN;
const F = MAX_MATCH_LEN;
const N_CHAR = 256 - THRESHOLD + F;

const M = 15;
const Q1 = 1 << M;
const Q2 = Q1 * 2;
const Q3 = Q1 * 3;
const Q4 = Q1 * 4;
const MAX_CUM = Q1 - 1;

const CODE_BITS = M + 2;

class LzariCodec {
  private symFreq = new Array<number>(N_CHAR + 1).fill(0);
  private symCum = new Array<number>(N_CHAR + 1).fill(0);
  private symToChar = new Array<number>(N_CHAR + 1).fill(0);
  private charToSym = new Array<number>(N_CHAR).fill(0);
  private posCum = new Array<number>(N + 1).fill(0);

  private low = 0;
  private high = Q4;
  private value = 0;
  private shifts = 0;

  private bitOut: number[] = [];
  private bitBuf = 0;
  private bitCnt = 0;
  private bitIn: Uint8Array = new Uint8Array(0);
  private bitInPos = 0;

  private outputBit(bit: number): void {
    this.bitBuf = (this.bitBuf << 1) | (bit & 1);
    this.bitCnt++;
    if (this.bitCnt === 8) {
      this.bitOut.push(this.bitBuf & 0xff);
      this.bitCnt = 0;
      this.bitBuf = 0;
    }
  }

  private flushBits(): void {
    if (this.bitCnt !== 0) {
      this.bitBuf <<= 8 - this.bitCnt;
      this.bitOut.push(this.bitBuf & 0xff);
      this.bitCnt = 0;
      this.bitBuf = 0;
    }
  }

  private inputBit(): number {
    if (this.bitCnt === 0) {
      if (this.bitInPos >= this.bitIn.length) return 0;
      this.bitBuf = this.bitIn[this.bitInPos++];
      this.bitCnt = 8;
    }
    const b = (this.bitBuf >> 7) & 1;
    this.bitBuf <<= 1;
    this.bitCnt--;
    return b;
  }

  // Single model orientation shared by encoder and decoder: symCum is
  // descending (symCum[0] = total, symCum[N_CHAR] = 0).
  private initModel(): void {
    this.symCum[N_CHAR] = 0;
    for (let sym = N_CHAR; sym >= 1; sym--) {
      const ch = sym - 1;
      this.charToSym[ch] = sym;
      this.symToChar[sym] = ch;
      this.symFreq[sym] = 1;
      this.symCum[sym - 1] = this.symCum[sym] + this.symFreq[sym];
    }
    this.symFreq[0] = 0;
    this.posCum[N] = 0;
    for (let i = N; i >= 1; i--) {
      this.posCum[i - 1] = this.posCum[i] + Math.floor(10000 / (i + 200));
    }
    this.low = 0;
    this.high = Q4;
    this.value = 0;
    this.shifts = 0;
  }

  private updateModel(sym: number): void {
    if (this.symCum[0] >= MAX_CUM) {
      let c = 0;
      for (let i = N_CHAR; i > 0; i--) {
        this.symCum[i] = c;
        const half = (this.symFreq[i] + 1) >> 1;
        this.symFreq[i] = half;
        c += half;
      }
      this.symCum[0] = c;
    }
    let i = sym;
    while (this.symFreq[i] === this.symFreq[i - 1]) i--;
    if (i < sym) {
      const chI = this.symToChar[i];
      const chSym = this.symToChar[sym];
      this.symToChar[i] = chSym;
      this.symToChar[sym] = chI;
      this.charToSym[chI] = sym;
      this.charToSym[chSym] = i;
    }
    this.symFreq[i] += 1;
    while (--i >= 0) this.symCum[i] += 1;
  }

  private encodeSymbol(sym: number): void {
    const range = this.high - this.low;
    const total = this.symCum[0];
    this.high = this.low + Math.floor((range * this.symCum[sym - 1]) / total);
    this.low = this.low + Math.floor((range * this.symCum[sym]) / total);
    for (;;) {
      if (this.high <= Q2) {
        this.outputBit(0);
        for (; this.shifts > 0; this.shifts--) this.outputBit(1);
      } else if (this.low >= Q2) {
        this.outputBit(1);
        for (; this.shifts > 0; this.shifts--) this.outputBit(0);
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.shifts++;
        this.low -= Q1;
        this.high -= Q1;
      } else {
        break;
      }
      this.low <<= 1;
      this.high <<= 1;
    }
    this.updateModel(sym);
  }

  private decodeSymbol(): number {
    const range = this.high - this.low;
    const total = this.symCum[0];
    const n = Math.floor(((this.value - this.low + 1) * total - 1) / range);
    const i = this.binarySearchSym(n);
    this.high = this.low + Math.floor((range * this.symCum[i - 1]) / total);
    this.low = this.low + Math.floor((range * this.symCum[i]) / total);
    for (;;) {
      if (this.low >= Q2) {
        this.value -= Q2;
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.value -= Q1;
        this.low -= Q1;
        this.high -= Q1;
      } else if (this.high > Q2) {
        break;
      }
      this.low <<= 1;
      this.high <<= 1;
      this.value = (this.value << 1) + this.inputBit();
    }
    const ret = this.symToChar[i];
    this.updateModel(i);
    return ret;
  }

  private encodePosition(position: number): void {
    const range = this.high - this.low;
    const total = this.posCum[0];
    this.high = this.low + Math.floor((range * this.posCum[position]) / total);
    this.low =
      this.low + Math.floor((range * this.posCum[position + 1]) / total);
    for (;;) {
      if (this.high <= Q2) {
        this.outputBit(0);
        for (; this.shifts > 0; this.shifts--) this.outputBit(1);
      } else if (this.low >= Q2) {
        this.outputBit(1);
        for (; this.shifts > 0; this.shifts--) this.outputBit(0);
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.shifts++;
        this.low -= Q1;
        this.high -= Q1;
      } else {
        break;
      }
      this.low <<= 1;
      this.high <<= 1;
    }
  }

  private decodePosition(): number {
    const range = this.high - this.low;
    const total = this.posCum[0];
    const n = Math.floor(((this.value - this.low + 1) * total - 1) / range);
    const position = this.binarySearchPos(n);
    this.high = this.low + Math.floor((range * this.posCum[position]) / total);
    this.low =
      this.low + Math.floor((range * this.posCum[position + 1]) / total);
    for (;;) {
      if (this.low >= Q2) {
        this.value -= Q2;
        this.low -= Q2;
        this.high -= Q2;
      } else if (this.low >= Q1 && this.high <= Q3) {
        this.value -= Q1;
        this.low -= Q1;
        this.high -= Q1;
      } else if (this.high > Q2) {
        break;
      }
      this.low <<= 1;
      this.high <<= 1;
      this.value = (this.value << 1) + this.inputBit();
    }
    return position;
  }

  // symCum is descending; returns the symbol s with symCum[s] <= x < symCum[s-1].
  private binarySearchSym(x: number): number {
    let i = 1;
    let j = N_CHAR;
    while (i < j) {
      const k = (i + j) >> 1;
      if (this.symCum[k] > x) i = k + 1;
      else j = k;
    }
    return i;
  }

  // posCum is descending; returns the position p with posCum[p] <= x < posCum[p-1].
  private binarySearchPos(x: number): number {
    let i = 1;
    let j = N;
    while (i < j) {
      const k = (i + j) >> 1;
      if (this.posCum[k] > x) i = k + 1;
      else j = k;
    }
    return i - 1;
  }

  private findLongestMatch(
    text: Uint8Array,
    r: number,
    lookahead: number,
  ): [number, number] {
    // The F lookahead slots [r, r+F) hold input the decoder does not have, so
    // a match source must lie in the produced window behind r: distance 1..N-F.
    // Searching further would reference the preload (or, at dist=N, the ring
    // compared against itself) and emit a reference that cannot be decoded.
    let matchLen = 0;
    let matchPos = 0;
    for (let dist = 1; dist <= N - F; dist++) {
      let len = 0;
      while (
        len < lookahead &&
        len < F &&
        text[(r - dist + N + len) % N] === text[(r + len) % N]
      ) {
        len++;
      }
      if (len > matchLen) {
        matchLen = len;
        matchPos = dist;
        if (matchLen === Math.min(lookahead, F)) break;
      }
    }
    return [matchPos, matchLen];
  }

  compress(input: Uint8Array): Uint8Array {
    if (input.length === 0) return new Uint8Array(0);
    this.initModel();
    this.bitOut = [];
    this.bitBuf = 0;
    this.bitCnt = 0;
    this.shifts = 0;
    this.low = 0;
    this.high = Q4;

    const text = new Uint8Array(N).fill(0x20);
    let r = N - F;
    let lookahead = 0;
    let inPos = 0;
    while (lookahead < F && inPos < input.length) {
      text[(r + lookahead) % N] = input[inPos++];
      lookahead++;
    }

    while (lookahead > 0) {
      const [matchPos, matchLenRaw] = this.findLongestMatch(text, r, lookahead);
      let matchLen = Math.min(matchLenRaw, lookahead);
      if (matchLen <= THRESHOLD) {
        matchLen = 1;
        this.encodeSymbol(this.charToSym[text[r]]);
      } else {
        this.encodeSymbol(this.charToSym[256 + matchLen - MIN_MATCH_LEN]);
        this.encodePosition(matchPos - 1);
      }
      r = (r + matchLen) % N;
      lookahead -= matchLen;
      while (lookahead < F && inPos < input.length) {
        text[(r + lookahead) % N] = input[inPos++];
        lookahead++;
      }
    }

    this.shifts++;
    if (this.low < Q1) {
      this.outputBit(0);
      for (; this.shifts > 0; this.shifts--) this.outputBit(1);
    } else {
      this.outputBit(1);
      for (; this.shifts > 0; this.shifts--) this.outputBit(0);
    }
    this.flushBits();
    return Uint8Array.from(this.bitOut);
  }

  decompress(input: Uint8Array, outputSize = 0): Uint8Array {
    if (input.length === 0) return new Uint8Array(0);
    this.initModel();
    this.bitIn = input;
    this.bitInPos = 0;
    this.bitCnt = 0;
    this.bitBuf = 0;
    this.low = 0;
    this.high = Q4;
    this.value = 0;
    for (let i = 0; i < CODE_BITS; i++) {
      this.value = (this.value << 1) + this.inputBit();
    }

    const text = new Uint8Array(N).fill(0x20);
    let r = N - F;
    const out: number[] = [];

    while (outputSize === 0 || out.length < outputSize) {
      const c = this.decodeSymbol();
      if (c < 256) {
        out.push(c);
        text[r] = c;
        r = (r + 1) % N;
      } else {
        const matchLen = c - 256 + MIN_MATCH_LEN;
        const matchPos = this.decodePosition();
        const p = (r - matchPos - 1 + N) % N;
        for (let i = 0; i < matchLen; i++) {
          const ch = text[(p + i) % N];
          out.push(ch);
          text[r] = ch;
          r = (r + 1) % N;
          if (outputSize !== 0 && out.length >= outputSize) break;
        }
      }
      if (
        outputSize === 0 &&
        this.bitInPos >= this.bitIn.length &&
        this.bitCnt === 0
      ) {
        break;
      }
    }
    return Uint8Array.from(out);
  }
}

/** Compress a byte buffer with LZA-R (used by the MAX single-save format). */
export function lzariCompress(data: Uint8Array): Uint8Array {
  return new LzariCodec().compress(data);
}

/**
 * Decompress LZA-R. `outputSize` is the exact expected length (the MAX header
 * `length` field); pass 0 only when the stream self-terminates on bit EOF.
 */
export function lzariDecompress(data: Uint8Array, outputSize = 0): Uint8Array {
  return new LzariCodec().decompress(data, outputSize);
}
