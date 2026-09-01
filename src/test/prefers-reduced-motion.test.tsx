import { act, render, renderHook } from "@testing-library/react";

import PocketStationMonoIcon from "@/components/memory-card/pocketstation-mono-icon";
import PS1BlockIcon from "@/components/ui/ps1-icon";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { IconPalette, SlotIconData } from "@/lib/ps1-memory-card";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initial,
    media: REDUCED_MOTION_QUERY,
    addEventListener(_type: string, listener: EventListener) {
      listeners.add(listener as () => void);
    },
    removeEventListener(_type: string, listener: EventListener) {
      listeners.delete(listener as () => void);
    },
    dispatch(next: boolean) {
      mql.matches = next;
      for (const listener of listeners) listener();
    },
  };

  window.matchMedia = ((query: string) => {
    expect(query).toBe(REDUCED_MOTION_QUERY);
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return mql;
}

const palette: IconPalette = [
  [255, 0, 0, 255],
  [0, 0, 255, 255],
];

function twoFrameIcon(): SlotIconData {
  return [new Array(256).fill(0), new Array(256).fill(1)];
}

function firstPixelFill(container: HTMLElement) {
  return container.querySelector("rect")?.getAttribute("fill");
}

describe("usePrefersReducedMotion", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("is false when the browser has no motion preference", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("is true when the browser prefers reduced motion", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the preference changes", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => media.dispatch(true));
    expect(result.current).toBe(true);
  });
});

describe("PS1 icon frames", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it("cycles frames when motion is allowed", () => {
    stubMatchMedia(false);
    const { container } = render(
      <PS1BlockIcon
        iconData={twoFrameIcon()}
        iconPalette={palette}
        iconFrameCount={2}
      />,
    );
    expect(firstPixelFill(container)).toBe("rgba(255,0,0,1)");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(firstPixelFill(container)).toBe("rgba(0,0,255,1)");
  });

  it("holds the first frame when reduced motion is preferred", () => {
    stubMatchMedia(true);
    const { container } = render(
      <PS1BlockIcon
        iconData={twoFrameIcon()}
        iconPalette={palette}
        iconFrameCount={2}
      />,
    );
    expect(firstPixelFill(container)).toBe("rgba(255,0,0,1)");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(firstPixelFill(container)).toBe("rgba(255,0,0,1)");
  });
});

describe("PocketStation icon frames", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  it("holds the first frame when reduced motion is preferred", () => {
    stubMatchMedia(true);
    const frames = new Uint8Array(256);
    frames[128] = 0x80;
    const { container } = render(<PocketStationMonoIcon frames={frames} />);
    expect(container.querySelectorAll("rect")).toHaveLength(1024);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelectorAll("rect")).toHaveLength(1024);
  });
});
