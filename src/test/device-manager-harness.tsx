import { act } from "@testing-library/react";

import { LoadingDialogProvider } from "@/contexts/loading-dialog-context";
import { useDeviceManager } from "@/hooks/use-device-manager";
import { MemCARDuino } from "@/lib/ps1/hardware/memcarduino";

export function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <LoadingDialogProvider>
      <div>{children}</div>
    </LoadingDialogProvider>
  );
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function connectMemcarduino(
  result: { current: ReturnType<typeof useDeviceManager> },
  onStart?: (hardware: MemCARDuino) => void,
) {
  vi.spyOn(MemCARDuino.prototype, "start").mockImplementation(
    function (this: MemCARDuino) {
      onStart?.(this);
      return Promise.resolve(null);
    },
  );
  await act(async () => {
    await result.current.connectMemcarduino("arduino_uno", "standard");
  });
}
