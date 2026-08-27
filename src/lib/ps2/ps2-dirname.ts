// Sony PFS Standards v2.3: a save directory name is
//   Key(2) + ProductNumber(10) + arbitrary(≤8)
// e.g. BA + SLUS-20062 + GTA30000. OSDSYS strcmp's whole system paths
// `/B[IEA]DATA-SYSTEM` (also `/BRDATA-SYSTEM`, `/B[IR]EXEC-SYSTEM` in ROM);
// it does not take 10 bytes of DATA-SYSTEM (that would drop the last M).

export interface Ps2SaveDirName {
  /** Two-byte key (`BA` / `BE` / `BI` / …). */
  key: string;
  /** Ten-byte product number (`SLUS-20062`). */
  productNumber: string;
  /** Remainder after the product number (`GTA30000`). */
  identifier: string;
}

const SYSTEM_AFTER_KEY = /^(DATA|EXEC)-SYSTEM$/i;

export function parsePs2SaveDirName(name: string): Ps2SaveDirName {
  return {
    key: name.slice(0, 2),
    productNumber: name.slice(2, 12),
    identifier: name.slice(12),
  };
}

/** Identifier shown under Save Info: the 10-byte product number. */
export function ps2SaveProductCode(name: string): string {
  const key = name.slice(0, 2);
  const rest = name.slice(2);
  if (/^B[A-Z]$/i.test(key) && SYSTEM_AFTER_KEY.test(rest)) {
    return rest;
  }
  if (name.length >= 12) return name.slice(2, 12);
  return rest || name;
}

/** Region folder from the two-byte directory key (`BA` → America). */
export function ps2SaveRegion(name: string): string {
  switch (name.slice(0, 2).toUpperCase()) {
    case "BI":
      return "Japan";
    case "BA":
      return "America";
    case "BE":
      return "Europe";
    default:
      return "";
  }
}
