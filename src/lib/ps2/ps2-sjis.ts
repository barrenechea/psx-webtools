// Shift-JIS helpers for icon.sys titles and PFS dirent names.
// ASCII 0x20–0x7F maps to console fullwidth pairs (not generic CP932:
// '=' → 815C, '\\' → 818F, '~' → 8160, DEL → 8151).
export const ASCII_TO_SJIS = Uint16Array.from([
  0x8140, 0x8149, 0x8168, 0x8194, 0x8190, 0x8193, 0x8195, 0x8166, 0x8169,
  0x816a, 0x8196, 0x817b, 0x8143, 0x817c, 0x8144, 0x815e, 0x824f, 0x8250,
  0x8251, 0x8252, 0x8253, 0x8254, 0x8255, 0x8256, 0x8257, 0x8258, 0x8146,
  0x8147, 0x8183, 0x815c, 0x8184, 0x8148, 0x8197, 0x8260, 0x8261, 0x8262,
  0x8263, 0x8264, 0x8265, 0x8266, 0x8267, 0x8268, 0x8269, 0x826a, 0x826b,
  0x826c, 0x826d, 0x826e, 0x826f, 0x8270, 0x8271, 0x8272, 0x8273, 0x8274,
  0x8275, 0x8276, 0x8277, 0x8278, 0x8279, 0x816d, 0x818f, 0x816e, 0x814f,
  0x8151, 0x8165, 0x8281, 0x8282, 0x8283, 0x8284, 0x8285, 0x8286, 0x8287,
  0x8288, 0x8289, 0x828a, 0x828b, 0x828c, 0x828d, 0x828e, 0x828f, 0x8290,
  0x8291, 0x8292, 0x8293, 0x8294, 0x8295, 0x8296, 0x8297, 0x8298, 0x8299,
  0x829a, 0x816f, 0x8162, 0x8170, 0x8160, 0x8151,
]);

const TITLE_PAIRS = 0x21;
const TITLE_COPY = 0x40;
const TITLE_FIELD = 68;

export function latin1FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

let unicodeToSjis: Map<number, number> | null = null;

function getUnicodeToSjis(): Map<number, number> {
  if (unicodeToSjis !== null) return unicodeToSjis;
  const map = new Map<number, number>();
  const decoder = new TextDecoder("shift-jis");
  const add = (bytes: Uint8Array, code: number) => {
    const s = decoder.decode(bytes);
    if (s.length !== 1 || s === "\uFFFD") return;
    const cp = s.codePointAt(0);
    if (cp === undefined || cp <= 0x7f || map.has(cp)) return;
    map.set(cp, code);
  };
  for (let lead = 0x81; lead <= 0x9f; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      add(Uint8Array.of(lead, trail), (lead << 8) | trail);
    }
  }
  for (let lead = 0xe0; lead <= 0xfc; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      add(Uint8Array.of(lead, trail), (lead << 8) | trail);
    }
  }
  for (let b = 0x80; b <= 0xff; b++) add(Uint8Array.of(b), b);
  unicodeToSjis = map;
  return map;
}

function pushSjis(bytes: number[], cp: number): boolean {
  if (cp <= 0x7f) {
    bytes.push(cp);
    return true;
  }
  const pair = getUnicodeToSjis().get(cp);
  if (pair === undefined) return false;
  if (pair <= 0xff) bytes.push(pair);
  else {
    bytes.push(pair >> 8, pair & 0xff);
  }
  return true;
}

function titleToInputBytes(title: string): number[] {
  let latin1 = true;
  for (let i = 0; i < title.length; i++) {
    if (title.charCodeAt(i) > 0xff) {
      latin1 = false;
      break;
    }
  }
  if (latin1) {
    const bytes: number[] = [];
    for (let i = 0; i < title.length; i++)
      bytes.push(title.charCodeAt(i) & 0xff);
    return bytes;
  }
  const bytes: number[] = [];
  for (const ch of title) {
    const cp = ch.codePointAt(0)!;
    if (!pushSjis(bytes, cp)) bytes.push(0x1f);
  }
  return bytes;
}

// Keep a two-byte pair when it is already a console-legal SJIS sequence
// (kana, kanji, fullwidth punctuation). Gaps 0x837F / 0x847F and anything
// else fall through to ASCII mapping or a fullwidth space.
function isCopyThroughPair(lead: number, trail: number): boolean {
  const pair = ((lead & 0xff) << 8) | (trail & 0xff);
  const u = (n: number) => n & 0xffff;
  if (
    ((trail - 0x40) & 0xff) < 0xbd &&
    trail !== 0x7f &&
    pair > 0x889e &&
    pair < 0x9873
  ) {
    return true;
  }
  if (u(pair + 0x7ec0) < 0x3f) return true;
  if (u(pair + 0x7e80) < 0x2d) return true;
  if (u(pair + 0x7e48) < 8) return true;
  if (u(pair + 0x7e38) < 8) return true;
  if (u(pair + 0x7e26) < 0xf) return true;
  if (u(pair + 0x7e10) < 8) return true;
  if (pair === 0x81fc) return true;
  if (u(pair + 0x7db1) < 10) return true;
  if (u(pair + 0x7da0) < 0x1a) return true;
  if (u(pair + 0x7d7f) < 0x1a) return true;
  if (u(pair + 0x7d61) < 0x53) return true;
  if (u(pair + 0x7cc0) < 0x57) {
    if (pair === 0x837f) return false;
    return true;
  }
  if (u(pair + 0x7c61) < 0x18) return true;
  if (u(pair + 0x7c41) < 0x18) return true;
  if (u(pair + 0x7bc0) < 0x21) return true;
  if (u(pair + 0x7b90) > 0x21) {
    if (u(pair + 0x7b61) > 0x1f) return false;
    return true;
  }
  return pair !== 0x847f;
}

/** Encode an icon.sys title: copy legal SJIS pairs, map ASCII, else 8140. */
export function encodeIconTitle(title: string): Uint8Array {
  const input = titleToInputBytes(title);
  const work = new Uint8Array(TITLE_PAIRS * 2 + 1);
  let i = 0;
  let o = 0;
  let pairs = 0;
  while (pairs < TITLE_PAIRS && i < input.length) {
    const b = input[i];
    const next = i + 1 < input.length ? input[i + 1] : 0;
    if (isCopyThroughPair(b, next)) {
      work[o] = b;
      work[o + 1] = next;
      i += 2;
    } else if (b >= 0x20 && b <= 0x7f) {
      const p = ASCII_TO_SJIS[b - 0x20];
      work[o] = p >> 8;
      work[o + 1] = p & 0xff;
      i += 1;
    } else {
      work[o] = 0x81;
      work[o + 1] = 0x40;
      i += 1;
    }
    o += 2;
    pairs++;
  }
  work[o] = 0;
  const out = new Uint8Array(TITLE_FIELD);
  for (let k = 0; k < TITLE_COPY; k++) {
    out[k] = work[k];
    if (work[k] === 0) break;
  }
  out[TITLE_COPY] = 0;
  return out;
}

/**
 * On-card dirent bytes. Code units ≤ 0xFF are a Latin-1 round-trip of the
 * 32-byte name field; anything else is Unicode → Shift-JIS. Returns null when
 * a character has no SJIS encoding.
 */
export function encodeDirentName(name: string): Uint8Array | null {
  let latin1 = true;
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xff) {
      latin1 = false;
      break;
    }
  }
  if (latin1) return latin1ToBytes(name);
  const bytes: number[] = [];
  for (const ch of name) {
    if (!pushSjis(bytes, ch.codePointAt(0)!)) return null;
  }
  return Uint8Array.from(bytes);
}

export function direntNameKey(name: string): string {
  const bytes = encodeDirentName(name);
  return bytes === null ? name : latin1FromBytes(bytes);
}

export function sameDirentName(a: string, b: string): boolean {
  return direntNameKey(a) === direntNameKey(b);
}

/** Shift-JIS decode of a Latin-1 dirent name, for UI only. */
export function displayDirentName(name: string): string {
  try {
    return new TextDecoder("shift-jis").decode(latin1ToBytes(name));
  } catch {
    return name;
  }
}
