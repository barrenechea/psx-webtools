// Scripted transport fakes for the Web Serial / WebUSB hardware classes.
// The classes reach into `reader`/`writer`/`device` (injected in tests via a
// typed cast, matching the repo's no-`any` convention), so these fakes only
// need to model the surface each class actually calls.

// Narrow `Uint8Array | null` to `Uint8Array`, failing the test if null.
export function nonNull(x: Uint8Array | null): Uint8Array {
  if (x === null) throw new Error("expected non-null bytes");
  return x;
}

export type ScriptedReader = {
  read(): Promise<{ value?: Uint8Array; done?: boolean }>;
  cancel(): Promise<void>;
  releaseLock(): void;
};

export type ScriptedWriter = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  releaseLock(): void;
};

export type ScriptedSerial = {
  /** Every byte sent by the class under test, in order. */
  written: number[];
  reader: ScriptedReader;
  writer: ScriptedWriter;
  /** Queue a chunk for the next read (used to seed a reply by hand). */
  push(chunk: Uint8Array): void;
  /**
   * Consulted after every write with the full byte stream sent so far. Return
   * a chunk to deliver to the reader (the device "answering" its command) or
   * null for no reply. Responding here keeps the reply out of discard()/drain()
   * quiet windows, since the command has already been sent.
   */
  setResponder(fn: (sent: number[]) => Uint8Array | null): void;
};

export function makeScriptedSerial(): ScriptedSerial {
  const written: number[] = [];
  const queued: Uint8Array[] = [];
  let pending: ((r: { value?: Uint8Array; done?: boolean }) => void) | null =
    null;
  let responder: ((sent: number[]) => Uint8Array | null) | null = null;

  function push(chunk: Uint8Array) {
    if (pending) {
      const p = pending;
      pending = null;
      p({ value: chunk, done: false });
    } else {
      queued.push(chunk);
    }
  }

  const reader: ScriptedReader = {
    read() {
      const next = queued.shift();
      if (next) return Promise.resolve({ value: next, done: false });
      return new Promise((resolve) => {
        pending = resolve;
      });
    },
    cancel() {
      return Promise.resolve();
    },
    releaseLock() {},
  };

  const writer: ScriptedWriter = {
    async write(chunk: Uint8Array) {
      for (const b of chunk) written.push(b);
      if (responder) {
        const reply = responder(written.slice());
        if (reply) push(reply);
      }
    },
    close() {
      return Promise.resolve();
    },
    releaseLock() {},
  };

  return {
    written,
    reader,
    writer,
    push,
    setResponder(fn) {
      responder = fn;
    },
  };
}

export type ScriptedUsbIn = { status: string; data?: Uint8Array };

export type ScriptedUsb = {
  /** Every transferOut payload, copied, in order. */
  writes: Uint8Array[];
  /** Every transferIn call (endpoint + requested length), in order. */
  inTransfers: { ep: number; length: number }[];
  /** Queue a bulk (non-interrupt) transferIn reply; next transferIn dequeues. */
  enqueueIn(data: Uint8Array): void;
  /** Queue a 1-byte interrupt (endpoint 3) token to be dispatched. */
  enqueueInt(byte: number): void;
  /** Make transferOut throw (models a USB write failure). */
  failWrites(value: boolean): void;
  /** Force every transferIn to report this status (default "ok"). */
  setInStatus(status: string): void;
  device: {
    open(): Promise<void>;
    selectConfiguration(_config: number): Promise<void>;
    claimInterface(_index: number): Promise<void>;
    close(): Promise<void>;
    transferOut(
      ep: number,
      data: Uint8Array,
    ): Promise<{ bytesWritten: number }>;
    transferIn(ep: number, length: number): Promise<ScriptedUsbIn>;
  };
  /** A navigator.usb stub whose requestDevice() returns `device`. */
  usb: {
    requestDevice(_opts?: unknown): Promise<ScriptedUsb["device"]>;
    addEventListener(_type: string, _listener: unknown): void;
    removeEventListener(_type: string, _listener: unknown): void;
  };
};

export function makeScriptedUsb(): ScriptedUsb {
  const writes: Uint8Array[] = [];
  const inTransfers: { ep: number; length: number }[] = [];
  const inQueue: Uint8Array[] = [];
  // Separate, edge-triggered interrupt pipe for endpoint 3: one queued token at
  // a time, else the transferIn blocks (NAK) until a token or close arrives.
  const intQueue: number[] = [];
  let intPending: {
    resolve: (r: ScriptedUsbIn) => void;
    reject: (e: Error) => void;
  } | null = null;
  let writeError = false;
  let inStatus = "ok";

  const device: ScriptedUsb["device"] = {
    async open(): Promise<void> {},
    async selectConfiguration(_config: number): Promise<void> {},
    async claimInterface(_index: number): Promise<void> {},
    async close(): Promise<void> {
      if (intPending) {
        const p = intPending;
        intPending = null;
        p.reject(new Error("device closed"));
      }
    },
    async transferOut(
      _ep: number,
      data: Uint8Array,
    ): Promise<{ bytesWritten: number }> {
      if (writeError) throw new Error("usb write failed");
      writes.push(new Uint8Array(data));
      return { bytesWritten: data.length };
    },
    async transferIn(ep: number, length: number): Promise<ScriptedUsbIn> {
      inTransfers.push({ ep, length });
      if (ep === 3) {
        if (intQueue.length > 0) {
          const byte = intQueue.shift() as number;
          return { status: inStatus, data: new Uint8Array([byte]) };
        }
        return new Promise<ScriptedUsbIn>((resolve, reject) => {
          intPending = { resolve, reject };
        });
      }
      const next = inQueue.length > 0 ? inQueue.shift() : new Uint8Array(0);
      return { status: inStatus, data: next };
    },
  };

  return {
    writes,
    inTransfers,
    enqueueIn(data) {
      inQueue.push(data);
    },
    enqueueInt(byte) {
      if (intPending) {
        const p = intPending;
        intPending = null;
        p.resolve({ status: inStatus, data: new Uint8Array([byte]) });
      } else {
        intQueue.push(byte);
      }
    },
    failWrites(value) {
      writeError = value;
    },
    setInStatus(status) {
      inStatus = status;
    },
    device,
    usb: {
      async requestDevice(_opts?: unknown): Promise<ScriptedUsb["device"]> {
        return device;
      },
      addEventListener(_type: string, _listener: unknown) {},
      removeEventListener(_type: string, _listener: unknown) {},
    },
  };
}
