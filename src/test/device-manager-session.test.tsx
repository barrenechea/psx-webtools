import { act, renderHook, screen, waitFor } from "@testing-library/react";

import { useDeviceManager } from "@/hooks/use-device-manager";
import { HardwareInterface, SupportedFeatures } from "@/lib/ps1/hardware/core";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";
import { newCard } from "@/test/psx-helpers";

import { connectMemcarduino, delay, wrapper } from "./device-manager-harness";

describe("useDeviceManager session lifetime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("drops a warm format-kind cache on unplug and does not Probe", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    let checks = 0;
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      () => {
        checks += 1;
        return Promise.resolve({ present: true, kind: "ps1" });
      },
    );

    act(() => {
      hardware?.onCardEvent?.(0x01);
    });
    await waitFor(() => expect(result.current.detectedCard).toBe("ps1"));
    const checksAfterProbe = checks;

    act(() => {
      hardware?.onDisconnected?.();
    });

    expect(result.current.detectedCard).toBeNull();
    expect(result.current.connectedDevice).toBeNull();
    expect(await result.current.formatSlotKind()).toBeNull();
    expect(checks).toBe(checksAfterProbe);
    const serial = vi.spyOn(MemCARDuino.prototype, "readPocketStationSerial");
    const dump = vi.spyOn(MemCARDuino.prototype, "dumpPocketStationBIOS");
    const setTime = vi.spyOn(MemCARDuino.prototype, "setPocketStationTime");
    await expect(result.current.readPocketStationSerial()).rejects.toThrow(
      "Device disconnected.",
    );
    await expect(result.current.dumpPocketStationBIOS()).rejects.toThrow(
      "Device disconnected.",
    );
    await expect(result.current.setPocketStationTime()).rejects.toThrow(
      "Device disconnected.",
    );
    expect(serial).not.toHaveBeenCalled();
    expect(dump).not.toHaveBeenCalled();
    expect(setTime).not.toHaveBeenCalled();
  });

  it("refuses read, write, and format after unplug without talking to the slot", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    const check = vi.spyOn(HardwareInterface.prototype, "checkCard");
    const readFrame = vi.spyOn(MemCARDuino.prototype, "readMemoryCardFrame");
    const writeFrame = vi.spyOn(MemCARDuino.prototype, "writeMemoryCardFrame");

    let readDone: Promise<unknown> = Promise.resolve();
    let writeDone: Promise<unknown> = Promise.resolve();
    let formatDone: Promise<unknown> = Promise.resolve();
    act(() => {
      hardware?.onDisconnected?.();
      readDone = result.current.readCard(false);
      writeDone = result.current.writeCard(newCard());
      formatDone = result.current.formatCard({ kind: "ps1", quick: true });
    });

    await expect(readDone).rejects.toThrow("Device disconnected.");
    await expect(writeDone).rejects.toThrow("Device disconnected.");
    await expect(formatDone).rejects.toThrow("Device disconnected.");
    expect(check).not.toHaveBeenCalled();
    expect(readFrame).not.toHaveBeenCalled();
    expect(writeFrame).not.toHaveBeenCalled();
  });

  it("refuses queued read, write, and format after unplug during in-flight USB", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    const log: string[] = [];
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      log.push("serial-start");
      await delay(40);
      log.push("serial-end");
      return { serial: 1, errorMsg: null };
    });
    const check = vi.spyOn(HardwareInterface.prototype, "checkCard");
    const readFrame = vi.spyOn(MemCARDuino.prototype, "readMemoryCardFrame");
    const writeFrame = vi.spyOn(MemCARDuino.prototype, "writeMemoryCardFrame");

    await act(async () => {
      const serialP = result.current.readPocketStationSerial();
      await delay(10);
      hardware?.onDisconnected?.();
      const readDone = result.current.readCard(false);
      const writeDone = result.current.writeCard(newCard());
      const formatDone = result.current.formatCard({
        kind: "ps1",
        quick: true,
      });
      await serialP;
      await expect(readDone).rejects.toThrow("Device disconnected.");
      await expect(writeDone).rejects.toThrow("Device disconnected.");
      await expect(formatDone).rejects.toThrow("Device disconnected.");
    });

    expect(log).toEqual(["serial-start", "serial-end"]);
    expect(check).not.toHaveBeenCalled();
    expect(readFrame).not.toHaveBeenCalled();
    expect(writeFrame).not.toHaveBeenCalled();
  });

  it("refuses a queued read after user disconnect without talking to the slot", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);

    const check = vi.spyOn(HardwareInterface.prototype, "checkCard");
    vi.spyOn(MemCARDuino.prototype, "stop").mockImplementation(() =>
      Promise.resolve(),
    );

    await act(async () => {
      const disconnectDone = result.current.disconnectDevice();
      const readDone = result.current.readCard(false);
      await expect(readDone).rejects.toThrow("Device disconnected.");
      await disconnectDone;
    });

    expect(check).not.toHaveBeenCalled();
  });

  it("refuses queued PocketStation after unplug during in-flight USB", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    let serialCalls = 0;
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      serialCalls += 1;
      await delay(40);
      return { serial: serialCalls, errorMsg: null };
    });
    const dump = vi.spyOn(MemCARDuino.prototype, "dumpPocketStationBIOS");
    const setTime = vi.spyOn(MemCARDuino.prototype, "setPocketStationTime");

    await act(async () => {
      const first = result.current.readPocketStationSerial();
      await delay(10);
      hardware?.onDisconnected?.();
      const second = result.current.readPocketStationSerial();
      const dumpDone = result.current.dumpPocketStationBIOS();
      const timeDone = result.current.setPocketStationTime();
      await first;
      await expect(second).rejects.toThrow("Device disconnected.");
      await expect(dumpDone).rejects.toThrow("Device disconnected.");
      await expect(timeDone).rejects.toThrow("Device disconnected.");
    });

    expect(serialCalls).toBe(1);
    expect(dump).not.toHaveBeenCalled();
    expect(setTime).not.toHaveBeenCalled();
  });

  it("refuses PocketStation on a live device that lacks the capability", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    vi.spyOn(MemCARDuino.prototype, "features").mockReturnValue(
      SupportedFeatures.RealtimeMode,
    );
    await connectMemcarduino(result);

    const serial = vi.spyOn(MemCARDuino.prototype, "readPocketStationSerial");
    const dump = vi.spyOn(MemCARDuino.prototype, "dumpPocketStationBIOS");
    const setTime = vi.spyOn(MemCARDuino.prototype, "setPocketStationTime");

    await expect(result.current.readPocketStationSerial()).rejects.toThrow(
      "PocketStation service commands require a MemCARDuino or PS3 MC Adaptor",
    );
    await expect(result.current.dumpPocketStationBIOS()).rejects.toThrow(
      "PocketStation service commands require a MemCARDuino or PS3 MC Adaptor",
    );
    await expect(result.current.setPocketStationTime()).rejects.toThrow(
      "PocketStation service commands require a MemCARDuino or PS3 MC Adaptor",
    );
    expect(result.current.canPocketStation).toBe(false);
    expect(result.current.connectedDevice).toBe("MemCARDuino");
    expect(serial).not.toHaveBeenCalled();
    expect(dump).not.toHaveBeenCalled();
    expect(setTime).not.toHaveBeenCalled();
  });

  it("does not stop() after unplug when disconnect uses the session handle", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    const stop = vi.spyOn(MemCARDuino.prototype, "stop");

    let disconnectDone: Promise<unknown> = Promise.resolve();
    act(() => {
      hardware?.onDisconnected?.();
      disconnectDone = result.current.disconnectDevice();
    });

    await disconnectDone;
    expect(stop).not.toHaveBeenCalled();
    expect(result.current.connectedDevice).toBeNull();
  });

  it("does not restore slot preview from an in-flight Probe after unplug", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    let hardware: MemCARDuino | undefined;
    await connectMemcarduino(result, (device) => {
      hardware = device;
    });

    let checks = 0;
    let releaseCheck: (() => void) | undefined;
    const checkHeld = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockImplementation(
      async () => {
        checks += 1;
        await checkHeld;
        return { present: true, kind: "ps1" };
      },
    );

    act(() => {
      hardware?.onCardEvent?.(0x01);
    });
    await waitFor(() => expect(checks).toBe(1));
    expect(result.current.detectedCard).toBeNull();

    act(() => {
      hardware?.onDisconnected?.();
    });
    expect(result.current.detectedCard).toBeNull();

    act(() => {
      releaseCheck?.();
    });
    await act(async () => {
      await delay(20);
    });

    expect(result.current.detectedCard).toBeNull();
    expect(await result.current.formatSlotKind()).toBeNull();
  });

  it("queues user disconnect behind in-flight slot USB", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);

    const log: string[] = [];
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      log.push("serial-start");
      await delay(40);
      log.push("serial-end");
      return { serial: 1, errorMsg: null };
    });
    vi.spyOn(MemCARDuino.prototype, "stop").mockImplementation(() => {
      log.push("stop");
      return Promise.resolve();
    });

    await act(async () => {
      const serialP = result.current.readPocketStationSerial();
      await delay(10);
      const disconnectP = result.current.disconnectDevice();
      await Promise.all([serialP, disconnectP]);
    });

    expect(log).toEqual(["serial-start", "serial-end", "stop"]);
    expect(result.current.detectedCard).toBeNull();
    expect(result.current.connectedDevice).toBeNull();
  });

  it("refuses PocketStation started in the same turn as user disconnect", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);

    const log: string[] = [];
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(() => {
      log.push("serial");
      return Promise.resolve({ serial: 1, errorMsg: null });
    });
    vi.spyOn(MemCARDuino.prototype, "stop").mockImplementation(() => {
      log.push("stop");
      return Promise.resolve();
    });

    await act(async () => {
      const serialP = result.current.readPocketStationSerial();
      const disconnectP = result.current.disconnectDevice();
      await expect(serialP).rejects.toThrow("Device disconnected.");
      await disconnectP;
    });

    expect(log).toEqual(["stop"]);
    expect(result.current.connectedDevice).toBeNull();
  });

  it("refuses a second connect until the current device is disconnected", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);
    const start = vi.spyOn(MemCARDuino.prototype, "start");
    start.mockClear();

    await expect(
      result.current.connectMemcarduino("arduino_uno", "standard"),
    ).rejects.toThrow(
      "Disconnect the current device before connecting another.",
    );
    expect(start).not.toHaveBeenCalled();
    expect(result.current.connectedDevice).toBe("MemCARDuino");
  });

  it("queues connect behind in-flight slot USB and disconnect", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await connectMemcarduino(result);

    const log: string[] = [];
    vi.spyOn(
      MemCARDuino.prototype,
      "readPocketStationSerial",
    ).mockImplementation(async () => {
      log.push("serial-start");
      await delay(40);
      log.push("serial-end");
      return { serial: 1, errorMsg: null };
    });
    vi.spyOn(MemCARDuino.prototype, "stop").mockImplementation(() => {
      log.push("stop");
      return Promise.resolve();
    });
    vi.spyOn(MemCARDuino.prototype, "start").mockImplementation(() => {
      log.push("start");
      return Promise.resolve(null);
    });

    await act(async () => {
      const serialP = result.current.readPocketStationSerial();
      await delay(10);
      const disconnectP = result.current.disconnectDevice();
      const connectP = result.current.connectMemcarduino(
        "arduino_uno",
        "standard",
      );
      await Promise.all([serialP, disconnectP, connectP]);
    });

    expect(log).toEqual(["serial-start", "serial-end", "stop", "start"]);
    expect(result.current.connectedDevice).toBe("MemCARDuino");
  });

  it("does not mark the session live if the device unplugs during start", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    vi.spyOn(MemCARDuino.prototype, "start").mockImplementation(
      function (this: MemCARDuino) {
        this.onDisconnected?.();
        return Promise.resolve(null);
      },
    );

    await act(async () => {
      await expect(
        result.current.connectMemcarduino("arduino_uno", "standard"),
      ).rejects.toThrow("Device disconnected.");
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectedDevice).toBeNull();
    expect(result.current.detectedCard).toBeNull();
    expect(await result.current.formatSlotKind()).toBeNull();
  });

  it("keeps the session live if a card event fires during start", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    vi.spyOn(MemCARDuino.prototype, "start").mockImplementation(
      function (this: MemCARDuino) {
        this.onCardEvent?.(0x01);
        return Promise.resolve(null);
      },
    );

    await act(async () => {
      await result.current.connectMemcarduino("arduino_uno", "standard");
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectedDevice).toBe("MemCARDuino");
    expect(result.current.detectedCard).toBeNull();
  });

  it("does not probe the slot after connect without SlotProbe", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    const check = vi.spyOn(HardwareInterface.prototype, "checkCard");
    await connectMemcarduino(result);
    await act(async () => {
      await delay(30);
    });
    expect(check).not.toHaveBeenCalled();
    expect(result.current.detectedCard).toBeNull();
  });

  it("probes the slot after connect when the device supports SlotProbe", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    vi.spyOn(MemCARDuino.prototype, "features").mockReturnValue(
      SupportedFeatures.RealtimeMode |
        SupportedFeatures.PocketStation |
        SupportedFeatures.SlotProbe,
    );
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockResolvedValue({
      present: true,
      kind: "ps2",
    });
    await connectMemcarduino(result);
    expect(result.current.detectedCard).toBe("ps2");
  });

  it("probes after connect even if a card event fired during start", async () => {
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    vi.spyOn(MemCARDuino.prototype, "features").mockReturnValue(
      SupportedFeatures.RealtimeMode |
        SupportedFeatures.PocketStation |
        SupportedFeatures.SlotProbe,
    );
    vi.spyOn(HardwareInterface.prototype, "checkCard").mockResolvedValue({
      present: true,
      kind: "ps1",
    });
    vi.spyOn(MemCARDuino.prototype, "start").mockImplementation(
      function (this: MemCARDuino) {
        this.onCardEvent?.(0x01);
        return Promise.resolve(null);
      },
    );

    await act(async () => {
      await result.current.connectMemcarduino("arduino_uno", "standard");
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectedDevice).toBe("MemCARDuino");
    expect(result.current.detectedCard).toBe("ps1");
  });

  it("does not hide a newer loading dialog from an earlier hide timeout", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await act(async () => {
      await connectMemcarduino(result);
    });

    vi.spyOn(HardwareInterface.prototype, "checkCard").mockResolvedValue({
      present: true,
      kind: "ps1",
    });
    let frames = 0;
    let releaseFirst: ((ok: boolean) => void) | undefined;
    vi.spyOn(MemCARDuino.prototype, "writeMemoryCardFrame").mockImplementation(
      () => {
        frames += 1;
        if (frames === 1) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve(true);
      },
    );

    let formatDone: Promise<void> = Promise.resolve();
    act(() => {
      formatDone = result.current.formatCard({ kind: "ps1", quick: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("Formatting Memory Card")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("Formatting Memory Card")).toBeInTheDocument();

    act(() => {
      releaseFirst?.(true);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await formatDone;
  });

  it("does not apply an older dialog update to a newer dialog", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDeviceManager(), { wrapper });
    await act(async () => {
      await connectMemcarduino(result);
    });

    vi.spyOn(HardwareInterface.prototype, "checkCard").mockResolvedValue({
      present: true,
      kind: "ps1",
    });
    let frames = 0;
    let releaseSecond: ((ok: boolean) => void) | undefined;
    vi.spyOn(MemCARDuino.prototype, "writeMemoryCardFrame").mockImplementation(
      () => {
        frames += 1;
        if (frames === 1) return Promise.resolve(true);
        if (frames === 2) {
          return new Promise((resolve) => {
            releaseSecond = resolve;
          });
        }
        return Promise.resolve(true);
      },
    );
    vi.spyOn(MemCARDuino.prototype, "stop").mockImplementation(() =>
      Promise.resolve(),
    );

    let formatDone: Promise<void> = Promise.resolve();
    act(() => {
      formatDone = result.current.formatCard({ kind: "ps1", quick: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("Formatting Memory Card")).toBeInTheDocument();
    expect(
      screen.getByText("Formatting memory card... 2%"),
    ).toBeInTheDocument();

    let disconnectDone: Promise<void> = Promise.resolve();
    act(() => {
      disconnectDone = result.current.disconnectDevice();
    });
    expect(screen.getByText("Disconnecting from device")).toBeInTheDocument();
    expect(
      screen.getByText("Initializing disconnection..."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Formatting memory card/),
    ).not.toBeInTheDocument();

    act(() => {
      releaseSecond?.(true);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await formatDone;
    await disconnectDone;
    expect(
      screen.queryByText(/Formatting memory card/),
    ).not.toBeInTheDocument();
  });
});
