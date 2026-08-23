import { useEffect, useState } from "react";

import { decodePocketStationMonoIcon } from "@/lib/ps1/pocketstation";

interface PocketStationMonoIconProps {
  frames: Uint8Array;
}

const PocketStationMonoIcon: React.FC<PocketStationMonoIconProps> = ({
  frames,
}) => {
  const frameCount = Math.floor(frames.length / 128);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    if (frameCount > 1) {
      const interval = setInterval(
        () => setCurrentFrame((prev) => (prev + 1) % frameCount),
        200,
      );
      return () => clearInterval(interval);
    }
  }, [frameCount]);

  const frame = frames.subarray(currentFrame * 128, (currentFrame + 1) * 128);
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
