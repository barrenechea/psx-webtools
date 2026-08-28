import { PS3MemCardAdaptor } from "@/lib/ps1/hardware/ps3memcardadaptor";
import { mgCbcEncrypt } from "@/lib/ps2/ps2-des";
import type { Ps2MgKeyset } from "@/lib/ps2/ps2-mechacon";
import type { Ps2SpecsResult } from "@/lib/ps2/ps2-types";

import { makeScriptedUsb, type ScriptedUsb } from "./hardware-helpers";
import { equalBytes } from "./psx-helpers";

type Ps3Shape = { device: USBDevice | null };
function connect(a: PS3MemCardAdaptor): ScriptedUsb {
  const usb = makeScriptedUsb();
  (a as unknown as Ps3Shape).device = usb.device as unknown as USBDevice;
  return usb;
}

const bytes = (v: number[]) => new Uint8Array(v);

// Fake, non-secret keyset (the same arbitrary pattern as the mechacon test).
const keyset: Ps2MgKeyset = {
  keychangeParam: 1,
  hashKey1: bytes([
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x21, 0x22, 0x23, 0x24,
    0x25, 0x26, 0x27, 0x28,
  ]),
  hashKey2: bytes([
    0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x41, 0x42, 0x43, 0x44,
    0x45, 0x46, 0x47, 0x48,
  ]),
  material1: bytes([0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58]),
  material2: bytes([0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68]),
  challengeMaterial: bytes([0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78]),
};

// Card-side state and the host nonce (fixed so the scripted MISO is known).
const cardIv = bytes([0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8]);
const cardMaterial = bytes([0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8]);
const cardNonce = bytes([0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8]);
const sessionKey = bytes([0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8]);
const nonce = bytes([0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

// The 16-byte UniqueKey both sides derive (host via PS2Mechacon, card here).
function uniqueKey(): Uint8Array {
  const input = new Uint8Array(8);
  for (let i = 0; i < 8; i++) input[i] = cardIv[i] ^ cardMaterial[i];
  const k = new Uint8Array(16);
  k.set(mgCbcEncrypt(keyset.hashKey1, keyset.material1, input), 0);
  k.set(mgCbcEncrypt(keyset.hashKey2, keyset.material2, input), 8);
  return k;
}

// Wire helpers: build the card's MISO for each packet type.
function reply(miso: Uint8Array): Uint8Array {
  const r = new Uint8Array(4 + miso.length);
  r[0] = 0x55;
  r[1] = 0x5a;
  r[2] = miso.length & 0xff;
  r[3] = 0x00;
  r.set(miso, 4);
  return r;
}
function mg5(term = 0x5a, id = 0x2b): Uint8Array {
  const m = new Uint8Array(5);
  m[3] = id;
  m[4] = term;
  return m;
}
function mgRead(data: Uint8Array, term = 0x5a): Uint8Array {
  const m = new Uint8Array(14);
  m[3] = 0x2b;
  for (let i = 0; i < 8; i++) m[4 + i] = data[7 - i];
  let x = 0;
  for (let i = 4; i <= 11; i++) x ^= m[i];
  m[12] = x;
  m[13] = term;
  return m;
}
function mgWrite(term = 0x5a, id = 0x2b): Uint8Array {
  const m = new Uint8Array(14);
  m[12] = id;
  m[13] = term;
  return m;
}

// The card's CR1/CR2/CR3 (computed with the card's UniqueKey). The card recovers
// the host nonce from C1; here it is known directly (equivalent).
function cardResponses(uk: Uint8Array): {
  cr1: Uint8Array;
  cr2: Uint8Array;
  cr3: Uint8Array;
} {
  const cr1 = mgCbcEncrypt(uk, keyset.challengeMaterial, cardNonce);
  const cr2 = mgCbcEncrypt(uk, cr1, nonce);
  const cr3 = mgCbcEncrypt(uk, cr2, sessionKey);
  return { cr1, cr2, cr3 };
}

// The host's C1/C2/C3 (what ps2AuthMg writes at F0 06/07/0B).
function hostChallenges(uk: Uint8Array): {
  c1: Uint8Array;
  c2: Uint8Array;
  c3: Uint8Array;
} {
  const c1 = mgCbcEncrypt(uk, keyset.challengeMaterial, nonce);
  const c2 = mgCbcEncrypt(uk, c1, cardNonce);
  const c3 = mgCbcEncrypt(uk, c2, cardIv);
  return { c1, c2, c3 };
}

// A 14-byte F0 write frame: AA 42 0E 00 81 F0 sub rev(data)[7..14] XOR@15 0 0.
function findWrite(writes: Uint8Array[], sub: number): Uint8Array {
  const w = writes.find((x) => x[5] === 0xf0 && x[6] === sub);
  if (!w) throw new Error(`no F0 ${sub.toString(16)} write`);
  return w;
}
function expectVectorFrame(w: Uint8Array, data: Uint8Array): void {
  for (let i = 0; i < 8; i++) expect(w[7 + i]).toBe(data[7 - i]);
  let x = 0;
  for (let i = 0; i < 8; i++) x ^= data[i];
  expect(w[15]).toBe(x);
}

// The full CEX response sequence (F3, F7, F0 00..14), MISO in send order.
function cexResponses(uk: Uint8Array): Uint8Array[] {
  const { cr1, cr2, cr3 } = cardResponses(uk);
  return [
    mg5(), // F3
    mg5(), // F7
    mg5(), // F0 00
    mgRead(cardIv), // F0 01
    mgRead(cardMaterial), // F0 02
    mg5(), // F0 03
    mgRead(cardNonce), // F0 04
    mg5(), // F0 05
    mgWrite(), // F0 06 (C3)
    mgWrite(), // F0 07 (C2)
    mg5(), // F0 08
    mg5(), // F0 09
    mg5(), // F0 0A
    mgWrite(), // F0 0B (C1)
    mg5(), // F0 0C
    mg5(), // F0 0D
    mg5(), // F0 0E
    mgRead(cr1), // F0 0F
    mg5(), // F0 10
    mgRead(cr2), // F0 11
    mg5(), // F0 12
    mgRead(cr3), // F0 13
    mg5(), // F0 14
  ];
}

describe("ps2AuthMg", () => {
  it("authenticates a matching CEX card and recovers the SessionKey", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    for (const m of cexResponses(uniqueKey())) usb.enqueueIn(reply(m));

    const result = await a.ps2AuthMg(keyset, nonce);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(equalBytes(result.sessionKey, sessionKey)).toBe(true);
    }
    // All 23 packets were driven (F3, F7, F0 00..14).
    expect(usb.writes.length).toBe(23);
    // The first written vector (F0 06, C3) is a 14-byte F0 write.
    const w6 = usb.writes[8];
    expect(w6[5]).toBe(0xf0);
    expect(w6[6]).toBe(0x06);
  });

  it("polls F3 while not-ready (0x66) before the handshake continues", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const uk = uniqueKey();
    usb.enqueueIn(reply(mg5(0x66))); // F3 not-ready (id 0x2B, term 0x66)
    for (const m of cexResponses(uk)) usb.enqueueIn(reply(m)); // F3 ok + rest

    const result = await a.ps2AuthMg(keyset, nonce);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(equalBytes(result.sessionKey, sessionKey)).toBe(true);
    }
    // One extra F3 transfer for the not-ready poll (23 handshake + 1 = 24).
    expect(usb.writes.length).toBe(24);
    expect(usb.writes[0][5]).toBe(0xf3);
    expect(usb.writes[1][5]).toBe(0xf3);
  });

  it("stores the SessionKey from a successful handshake", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    for (const m of cexResponses(uniqueKey())) usb.enqueueIn(reply(m));

    await a.ps2AuthMg(keyset, nonce);
    const sk = a.getPs2SessionKey();
    expect(sk).not.toBeNull();
    // CR3 plaintext: the key the card would later use for KELF content.
    if (sk) expect(equalBytes(sk, sessionKey)).toBe(true);
  });

  it("clears the SessionKey when a later F3 fails", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    for (const m of cexResponses(uniqueKey())) usb.enqueueIn(reply(m));
    await a.ps2AuthMg(keyset, nonce);
    expect(a.getPs2SessionKey()).not.toBeNull();

    // A second handshake whose F3 keeps reporting not-ready must clear it.
    for (let i = 0; i < 5; i++) usb.enqueueIn(reply(mg5(0x66)));
    usb.enqueueIn(reply(mg5())); // reset F3 issued on failure
    const result = await a.ps2AuthMg(keyset, nonce);
    expect(result.status).toBe("error");
    expect(a.getPs2SessionKey()).toBeNull();
  });

  it("writes C3/C2/C1 byte-reversed with a host-order XOR", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const uk = uniqueKey();
    for (const m of cexResponses(uk)) usb.enqueueIn(reply(m));

    await a.ps2AuthMg(keyset, nonce);
    const { c1, c2, c3 } = hostChallenges(uk);
    expectVectorFrame(findWrite(usb.writes, 0x06), c3);
    expectVectorFrame(findWrite(usb.writes, 0x07), c2);
    expectVectorFrame(findWrite(usb.writes, 0x0b), c1);
  });

  it("stops at F0 0A on a card mismatch and does not send C1", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const seq = cexResponses(uniqueKey());
    // Ok through F0 09 (index 11), fail at F0 0A (index 12), then the reset F3.
    for (let i = 0; i < 12; i++) usb.enqueueIn(reply(seq[i]));
    usb.enqueueIn(reply(mg5(0x66))); // F0 0A fails
    usb.enqueueIn(reply(mg5())); // reset F3 issued on failure

    const result = await a.ps2AuthMg(keyset, nonce);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.step).toBe("F0 0A");
    }
    // No F0 0B (write C1) was sent.
    const sentF00B = usb.writes.some((w) => w[5] === 0xf0 && w[6] === 0x0b);
    expect(sentF00B).toBe(false);
  });

  it("omits the F7 key-change packet for DEX (keychangeParam 0)", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    const dex: Ps2MgKeyset = { ...keyset, keychangeParam: 0 };
    // DEX skips F7: drop seq index 1.
    const dseq = cexResponses(uniqueKey());
    for (const m of [dseq[0], ...dseq.slice(2)]) usb.enqueueIn(reply(m));

    const result = await a.ps2AuthMg(dex, nonce);
    expect(result.status).toBe("ok");
    // The 2nd packet is F0 00, not F7.
    expect(usb.writes[1][5]).toBe(0xf0);
    expect(usb.writes[1][6]).toBe(0x00);
    expect(usb.writes.length).toBe(22);
  });
});

// --- ps2GetSpecsAuth orchestration (needs-auth → handshake → re-sync → re-Get Specs). ---

type SpecsAuthShape = {
  ps2GetSpecsAuth(keyset?: Ps2MgKeyset): Promise<Ps2SpecsResult>;
};

// 13-byte Get Specs MISO: all 0xFF fails the EDC, so ps2GetSpecs → needs-auth.
function specsMisoNeedsAuth(): Uint8Array {
  return new Uint8Array(13).fill(0xff);
}
// A plausible 512-page... (512-byte page) card: flags, pagesize, EDC, term 0x5A.
function specsMisoOk(): Uint8Array {
  const m = new Uint8Array(13);
  m[2] = 0x2b; // flags (CF_USE_ECC)
  m[3] = 0x00;
  m[4] = 0x02; // pagesize 512
  m[5] = 0x04; // blockPages 4
  m[7] = 0x20; // pageCount 32
  let e = 0;
  for (let i = 3; i <= 10; i++) e ^= m[i];
  m[11] = e;
  m[12] = 0x5a;
  return m;
}
// 5-byte terminator MISO: [4]=0x5A satisfies both the get- and set-terminator polls.
function termSyncMiso(): Uint8Array {
  const m = new Uint8Array(5);
  m[4] = 0x5a;
  return m;
}

// Make crypto.getRandomValues return the fixed `nonce` so the scripted handshake
// is deterministic; ps2GetSpecsAuth generates the mecha nonce with it.
async function withFixedNonce(fn: () => Promise<void>): Promise<void> {
  const c = globalThis.crypto as unknown as {
    getRandomValues: (a: Uint8Array) => Uint8Array;
  };
  const orig = c.getRandomValues;
  c.getRandomValues = (a: Uint8Array) => {
    for (let i = 0; i < a.length; i++) a[i] = nonce[i];
    return a;
  };
  try {
    await fn();
  } finally {
    c.getRandomValues = orig;
  }
}

describe("ps2GetSpecsAuth", () => {
  it("all-0xFF Get Specs → handshake → good Get Specs returns ok", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(reply(specsMisoNeedsAuth()));
    for (const m of cexResponses(uniqueKey())) usb.enqueueIn(reply(m));
    usb.enqueueIn(reply(termSyncMiso())); // get terminator
    usb.enqueueIn(reply(termSyncMiso())); // set terminator
    usb.enqueueIn(reply(specsMisoOk())); // 2nd Get Specs

    await withFixedNonce(async () => {
      const r = await (a as unknown as SpecsAuthShape).ps2GetSpecsAuth(keyset);
      expect(r.status).toBe("ok");
      if (r.status === "ok") expect(r.specs.pageSize).toBe(512);
    });
  });

  it("treats a still-refusing Get Specs after auth as an error, not needs-auth", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(reply(specsMisoNeedsAuth()));
    for (const m of cexResponses(uniqueKey())) usb.enqueueIn(reply(m));
    usb.enqueueIn(reply(termSyncMiso()));
    usb.enqueueIn(reply(termSyncMiso()));
    usb.enqueueIn(reply(specsMisoNeedsAuth())); // 2nd Get Specs still refuses

    await withFixedNonce(async () => {
      const r = await (a as unknown as SpecsAuthShape).ps2GetSpecsAuth(keyset);
      expect(r.status).toBe("error");
    });
  });

  it("keeps the failing step when the handshake is rejected", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(reply(specsMisoNeedsAuth()));
    // F3 retries on 0x66 (not-ready); five of them exhaust the cap so F3 fails.
    for (let i = 0; i < 5; i++) usb.enqueueIn(reply(mg5(0x66)));
    usb.enqueueIn(reply(mg5())); // reset F3 issued on failure

    await withFixedNonce(async () => {
      const r = await (a as unknown as SpecsAuthShape).ps2GetSpecsAuth(keyset);
      expect(r.status).toBe("error");
      if (r.status === "error") expect(r.step).toBe("F3");
    });
  });

  it("returns needs-auth unchanged when no keyset is supplied", async () => {
    const a = new PS3MemCardAdaptor();
    const usb = connect(a);
    usb.enqueueIn(reply(specsMisoNeedsAuth()));

    const r = await (a as unknown as SpecsAuthShape).ps2GetSpecsAuth();
    expect(r.status).toBe("needs-auth");
    expect(usb.writes.length).toBe(1); // only the first Get Specs was sent
  });
});
