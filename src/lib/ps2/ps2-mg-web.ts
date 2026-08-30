// Fetch the standard MagicGate keystores from a pinned IPFS file and parse them
// into the keyset list the auth path iterates over. No key bytes ship with the
// code: the file lives on IPFS (content-addressed, anonymous), and public
// gateways serve it with Access-Control-Allow-Origin so the browser can fetch
// it directly at runtime.

import { type ParsedMgSection, parsePs3mcaIni } from "@/lib/ps2/ps2-mgkeyset";

// The four standard MagicGate keystores (retail, developer, arcade, prototype)
// pinned as a ps3mca.ini. The CID is the content address; swap it to repoint at
// a different pin. Gateways are tried in order: pinata.cloud serves the file
// without a bot challenge, dweb.link and ipfs.io act as fallbacks.
const PS2_MG_KEYS_CID =
  "bafkreidfxa65ruicroyuib4xjpd7rtsyr7fobosje3m66ygjs2ajr3fngu";
const PS2_MG_KEYS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://ipfs.io/ipfs/",
];

// Fetch and parse the standard keystores, trying each gateway in order so one
// dead gateway does not break the source. Returns the parsed key sets (>=1).
// Throws when no gateway serves a parseable file.
export async function fetchStandardMgKeysets(): Promise<ParsedMgSection[]> {
  let lastError: unknown = null;
  for (const base of PS2_MG_KEYS_GATEWAYS) {
    try {
      const res = await fetch(base + PS2_MG_KEYS_CID, {
        headers: { Accept: "text/plain" },
      });
      if (!res.ok) {
        lastError = new Error(`MagicGate keys returned HTTP ${res.status}.`);
        continue;
      }
      const sections = parsePs3mcaIni(await res.text());
      if (sections.length > 0) return sections;
      lastError = new Error("No usable key sets in the fetched key file.");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not fetch MagicGate keys.");
}
