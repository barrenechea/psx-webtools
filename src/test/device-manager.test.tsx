import { act, renderHook, waitFor } from "@testing-library/react";

import { useDeviceManager } from "@/hooks/use-device-manager";
import { HardwareInterface } from "@/lib/ps1/hardware/core";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";

import { connectMemcarduino, delay, wrapper } from "./device-manager-harness";

describe("useDeviceManager slot queue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not export raw checkCard, classifySlot, runBulk, withSlotLock, or withLoadingDialog", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    expect(result.current).not.toHaveProperty("checkCard");
    expect(result.current).not.toHaveProperty("classifySlot");
    expect(result.current).not.toHaveProperty("runBulk");
    expect(result.current).not.toHaveProperty("withSlotLock");
    expect(result.current).not.toHaveProperty("withLoadingDialog");
    expect(result.current).not.toHaveProperty("resetSlotPreview");
    expect(result.current).not.toHaveProperty("readSlotKind");
    expect(result.current).not.toHaveProperty("probeNow");
    expect(result.current.canPocketStation).toBe(false);
    expect(await result.current.formatSlotKind()).toBeNull();
  });

  it("runs overlapping bulk ops one at a time", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);

    const active = new Set<string>();
    let overlapped = false;
    const enter = (name: string) => {
      if (active.size > 0) overlapped = true;
      active.add(name);
    };
    const leave = (name: string) => {
      active.delete(name);
    };

    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      enter("serial");
      await delay(25);
      leave("serial");
      return { serial: 1, errorMsg: null };
    });
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      async () => {
        enter("check");
        await delay(25);
        leave("check");
        return { present: true, kind: "ps1" };
      },
    );

    let serial = 0;
    let kind: string | null = null;
    await act(async () => {
      const serialP = result.current.readPocketStationSerial();
      const kindP = result.current.formatSlotKind();
      serial = await serialP;
      kind = await kindP;
    });

    expect(serial).toBe(1);
    expect(kind).toBe("ps1");
    expect(overlapped).toBe(false);
  });

  it("starts the next bulk after the previous one rejects", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);

    vi.spyOn(MemCARDuino.prototype, "readPocketStationSerial")
      .mockImplementationOnce(async () => {
        await delay(10);
        return { serial: 0, errorMsg: "boom" };
      })
      .mockImplementationOnce(() =>
        Promise.resolve({ serial: 7, errorMsg: null }),
      );

    let firstError: unknown = null;
    let second = 0;
    await act(async () => {
      const firstP = result.current.readPocketStationSerial();
      const secondP = result.current.readPocketStationSerial();
      firstError = await firstP.then(
        () => null,
        (err: unknown) => err,
      );
      second = await secondP;
    });

    expect(firstError).toBeInstanceOf(Error);
    expect((firstError as Error).message).toBe("boom");
    expect(second).toBe(7);
  });

  it("defers a slot Probe until every queued bulk finishes", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    const log: string[] = [];
    let serialCalls = 0;
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      const n = ++serialCalls;
      log.push(`serial-${n}-start`);
      await delay(25);
      log.push(`serial-${n}-end`);
      return { serial: n, errorMsg: null };
    });
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      () => {
        log.push("check");
        return Promise.resolve({ present: true, kind: "ps1" });
      },
    );

    await act(async () => {
      const first = result.current.readPocketStationSerial();
      const second = result.current.readPocketStationSerial();
      hardware?.onCardEvent?.(0x01);
      await Promise.all([first, second]);
    });

    await waitFor(() => {
      expect(log).toEqual([
        "serial-1-start",
        "serial-1-end",
        "serial-2-start",
        "serial-2-end",
        "check",
      ]);
    });
  });

  it("runs a preview Probe and a later bulk one at a time", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    const active = new Set<string>();
    let overlapped = false;
    const enter = (name: string) => {
      if (active.size > 0) overlapped = true;
      active.add(name);
    };
    const leave = (name: string) => {
      active.delete(name);
    };

    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      async () => {
        enter("check");
        await delay(25);
        leave("check");
        return { present: true, kind: "ps1" };
      },
    );
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      enter("serial");
      await delay(25);
      leave("serial");
      return { serial: 1, errorMsg: null };
    });

    await act(async () => {
      hardware?.onCardEvent?.(0x01);
      await result.current.readPocketStationSerial();
    });

    expect(overlapped).toBe(false);
  });

  it("coalesces extra 0x83 inserts into one follow-up Probe", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    let inflight = 0;
    let maxInflight = 0;
    let checks = 0;
    let releaseFirst: (() => void) | undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      async () => {
        const n = (checks += 1);
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        if (n === 1) await firstHeld;
        else await delay(10);
        inflight -= 1;
        return { present: true, kind: "ps1" };
      },
    );

    act(() => {
      hardware?.onCardEvent?.(0x01);
    });
    await waitFor(() => expect(checks).toBe(1));
    act(() => {
      hardware?.onCardEvent?.(0x01);
      hardware?.onCardEvent?.(0x01);
    });
    expect(checks).toBe(1);
    act(() => {
      releaseFirst?.();
    });
    await waitFor(() => expect(checks).toBe(2));
    await act(async () => {
      await delay(30);
    });
    expect(checks).toBe(2);
    expect(maxInflight).toBe(1);
  });

  it("drops a warm format-kind cache when a card is inserted during a bulk op", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    let checkKind: "ps1" | "ps2" = "ps1";
    let checks = 0;
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      () => {
        checks += 1;
        return Promise.resolve({ present: true, kind: checkKind });
      },
    );
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      await delay(40);
      return { serial: 1, errorMsg: null };
    });

    act(() => {
      hardware?.onCardEvent?.(0x01);
    });
    await waitFor(() => expect(result.current.detectedCard).toBe("ps1"));
    const checksAfterProbe = checks;
    expect(await result.current.formatSlotKind()).toBe("ps1");
    expect(checks).toBe(checksAfterProbe);

    let kindDuringBusy: string | null = null;
    await act(async () => {
      const serialP = result.current.readPocketStationSerial();
      checkKind = "ps2";
      hardware?.onCardEvent?.(0x03);
      kindDuringBusy = await result.current.formatSlotKind();
      await serialP;
    });

    expect(kindDuringBusy).toBe("ps2");
    expect(result.current.detectedCard).toBe("ps2");
    await act(async () => {
      await delay(30);
    });
    expect(checks).toBe(checksAfterProbe + 1);
  });
});
