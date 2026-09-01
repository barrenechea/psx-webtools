import { useEffect, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { decodePocketStationMonoIcon } from "@/lib/ps1/pocketstation";

interface PocketStationMonoIconProps {
  frames: Uint8Array;
}

const PocketStationMonoIcon: React.FC<PocketStationMonoIconProps> = ({
  frames,
}) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const frameCount = Math.floor(frames.length / 128);
  const [currentFrame, setCurrentFrame] = useState(0);
  const animate = frameCount > 1 && !prefersReducedMotion;

  useEffect(() => {
    if (!animate) {
      return;
    }
    const interval = setInterval(
      () => setCurrentFrame((prev) => (prev + 1) % frameCount),
      200,
    );
    return () => clearInterval(interval);
  }, [animate, frameCount]);

  const frameIndex = animate ? currentFrame : 0;
  const frame = frames.subarray(frameIndex * 128, (frameIndex + 1) * 128);
  const pixels = decodePocketStationMonoIcon(frame);

  return (
    <svg width="32" height="32" viewBox="0 0 32 32" className="block">
      {pixels.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={i % 32}
            y={Math.floor(i / 32)}
            width="1"
            height="1"
            fill="currentColor"
          />
        ) : null,
      )}
    </svg>
  );
};

export default PocketStationMonoIcon;
