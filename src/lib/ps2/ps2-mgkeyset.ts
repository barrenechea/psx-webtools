// User-supplied MagicGate key file (ps3mca.ini) parsing + localStorage
// persistence helpers. The parser maps slot names to a Ps2MgKeyset; it accepts
// both the ps3mca original `MC_*` names and the KELFTool `MG_*` aliases, and the
// hex in any of the shapes sd2psXtd accepts (0x-prefixed, spaced, concatenated).
// No key bytes ship with the code — a section is only produced from a file the
// user loads at runtime.

import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import { Ps2CardError } from "@/lib/ps2/ps2-mechacon";

/** localStorage key for the selected keyset (never committed, never logged). */
export const PS2_MG_KEYSET_STORAGE_KEY = "psx-webtools.ps2-mg-keyset";

/** A valid keyset parsed from one `[section]` of a ps3mca.ini. */
export interface ParsedMgSection {
  section: string;
  keyset: Ps2MgKeyset;
}

// The five handshake rows per keyset. `_1`/`_2` are the two 3DES halves inside
// a section, not F7 indices. Original `MC_*` names plus KELFTool `MG_*` aliases.
type MgFieldKey =
  "hashKey1" | "hashKey2" | "material1" | "material2" | "challengeMaterial";

interface MgFieldDef {
  key: MgFieldKey;
  expect: number;
}

function matchMgField(name: string): MgFieldDef | null {
  switch (name.toLowerCase()) {
    case "mc_cardkey_hashkey_1":
    case "mg_cardkey_0":
      return { key: "hashKey1", expect: 16 };
    case "mc_cardkey_hashkey_2":
    case "mg_cardkey2_0":
      return { key: "hashKey2", expect: 16 };
    case "mc_cardkey_material_1":
    case "mg_cardiv_0":
      return { key: "material1", expect: 8 };
    case "mc_cardkey_material_2":
    case "mg_cardiv2_0":
      return { key: "material2", expect: 8 };
    case "mc_challenge_material":
    case "mg_challenge_iv":
      return { key: "challengeMaterial", expect: 8 };
    default:
      return null; // keychange_param / MG_KBIT_* / MG_KC_* / MG_SIG_* — ignored
  }
}

function unhex(ch: string | undefined): number {
  if (ch === undefined) return -1;
  const code = ch.charCodeAt(0);
  if (ch >= "0" && ch <= "9") return code - 48;
  if (ch >= "a" && ch <= "f") return code - 87;
  if (ch >= "A" && ch <= "F") return code - 55;
  return -1;
}

// Port of sd2psXtd parse_hex_bytes: accept 0x-prefixed, spaced, or concatenated
// hex (and commas), reject any input that does not yield exactly `expect`
// bytes. Storage-sourced callers pass through fromStoredMgKeyset, so a
// non-string (or missing) field is rejected, never a crash.
export function parseMgHex(value: string, expect: number): Uint8Array | null {
  if (typeof value !== "string") return null;
  const out = new Uint8Array(expect);
  let i = 0;
  let n = 0;
  const len = value.length;
  while (i < len && n < expect) {
    // Skip a 0x / 0X prefix.
    if (
      value[i] === "0" &&
      (value[i + 1] === "x" || value[i + 1] === "X") &&
      unhex(value[i + 2]) >= 0
    ) {
      i += 2;
      continue;
    }
    // Skip non-hex separators (spaces, commas).
    if (unhex(value[i]) < 0) {
      i++;
      continue;
    }
    const hi = unhex(value[i]);
    i++;
    // Skip non-hex between the two nibbles, watching for a 0x prefix.
    while (i < len && unhex(value[i]) < 0) {
      if (
        value[i] === "0" &&
        (value[i + 1] === "x" || value[i + 1] === "X") &&
        unhex(value[i + 2]) >= 0
      ) {
        i += 2;
        break;
      }
      i++;
    }
    if (unhex(value[i]) < 0) return null; // odd nibble / ran out
    const lo = unhex(value[i]);
    i++;
    out[n++] = (hi << 4) | lo;
  }
  // Anything hex-like left over is a length mismatch.
  while (i < len) {
    if (
      value[i] === "0" &&
      (value[i + 1] === "x" || value[i + 1] === "X") &&
      unhex(value[i + 2]) >= 0
    )
      return null;
    if (unhex(value[i]) >= 0) return null;
    i++;
  }
  return n === expect ? out : null;
}

interface IniEntry {
  section: string;
  name: string;
  value: string;
}

// Minimal INI: `[section]` headers, `name = value` lines, `#`/`;` comments.
function* iniEntries(text: string): Generator<IniEntry> {
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash);
    const semi = line.indexOf(";");
    if (semi >= 0) line = line.slice(0, semi);
    line = line.trim();
    if (line === "") continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (name === "") continue;
    yield { section, name, value };
  }
}

// Parse a ps3mca.ini into the keysets it contains. A section is kept only when
// it has a valid keychange_param (0–3) plus all five handshake rows.
export function parsePs3mcaIni(text: string): ParsedMgSection[] {
  const result: ParsedMgSection[] = [];
  let cur: {
    section: string;
    param: number | null;
    fields: Partial<Record<MgFieldKey, Uint8Array>>;
  } | null = null;

  const flush = () => {
    if (cur) {
      const f = cur.fields;
      if (
        cur.param !== null &&
        f.hashKey1 &&
        f.hashKey2 &&
        f.material1 &&
        f.material2 &&
        f.challengeMaterial
      ) {
        result.push({
          section: cur.section,
          keyset: {
            keychangeParam: cur.param,
            hashKey1: f.hashKey1,
            hashKey2: f.hashKey2,
            material1: f.material1,
            material2: f.material2,
            challengeMaterial: f.challengeMaterial,
          },
        });
      }
    }
    cur = null;
  };

  for (const { section, name, value } of iniEntries(text)) {
    if (!cur || cur.section !== section) {
      flush();
      cur = { section, param: null, fields: {} };
    }
    if (name.toLowerCase() === "keychange_param") {
      const p = parseInt(value, 10);
      if (Number.isInteger(p) && p >= 0 && p <= 3) cur.param = p;
      continue;
    }
    const field = matchMgField(name);
    if (!field) continue;
    const bytes = parseMgHex(value, field.expect);
    if (bytes) cur.fields[field.key] = bytes;
  }
  flush();
  return result;
}

// localStorage is JSON, so persist the keyset as hex strings (round-trips
// cleanly) rather than binary. The section name is kept for display only.
export interface StoredMgKeyset {
  section: string;
  keychangeParam: number;
  hashKey1: string;
  hashKey2: string;
  material1: string;
  material2: string;
  challengeMaterial: string;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++)
    s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

export function toStoredMgKeyset(
  section: string,
  keyset: Ps2MgKeyset,
): StoredMgKeyset {
  return {
    section,
    keychangeParam: keyset.keychangeParam,
    hashKey1: toHex(keyset.hashKey1),
    hashKey2: toHex(keyset.hashKey2),
    material1: toHex(keyset.material1),
    material2: toHex(keyset.material2),
    challengeMaterial: toHex(keyset.challengeMaterial),
  };
}

// Restore a keyset from its persisted (JSON) form. localStorage can hold
// anything — `{}`, the string "null", a bare number — so validate the whole
// shape before trusting a single field: the param must be an integer 0–3 and
// every hex row must restore to the right length, else the entry is treated as
// absent (the manager re-prompts instead of crashing on load).
export function fromStoredMgKeyset(
  stored: StoredMgKeyset | null,
): Ps2MgKeyset | null {
  if (stored === null || stored === undefined) return null;
  const param = stored.keychangeParam;
  if (!Number.isInteger(param) || param < 0 || param > 3) return null;
  const hashKey1 = parseMgHex(stored.hashKey1, 16);
  const hashKey2 = parseMgHex(stored.hashKey2, 16);
  const material1 = parseMgHex(stored.material1, 8);
  const material2 = parseMgHex(stored.material2, 8);
  const challengeMaterial = parseMgHex(stored.challengeMaterial, 8);
  if (!hashKey1 || !hashKey2 || !material1 || !material2 || !challengeMaterial)
    return null;
  return {
    keychangeParam: param,
    hashKey1,
    hashKey2,
    material1,
    material2,
    challengeMaterial,
  };
}

// True when a thrown error means the stored keyset is wrong and must be cleared
// (a MagicGate rejection that named the packet it died at, e.g. "F0 0A"), so
// the user is re-prompted for a different keyset.
export function shouldClearKeysetOn(err: unknown): boolean {
  return err instanceof Ps2CardError && err.step !== undefined;
}
