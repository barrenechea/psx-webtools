import { useEffect, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { IconPalette, SlotIconData } from "@/lib/ps1-memory-card";

interface PS1BlockIconProps {
  iconData: SlotIconData;
  iconPalette: IconPalette;
  iconFrameCount: number;
}

const PS1BlockIcon: React.FC<PS1BlockIconProps> = ({
  iconData,
  iconPalette,
  iconFrameCount,
}) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [currentFrame, setCurrentFrame] = useState(0);
  const animate = iconFrameCount > 1 && !prefersReducedMotion;

  useEffect(() => {
    if (!animate) {
      return;
    }
    const interval = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % iconFrameCount);
    }, 200);

    return () => clearInterval(interval);
  }, [animate, iconFrameCount]);

  return (
    <div className="mr-2 size-8 shrink-0">
      <svg width="32" height="32" viewBox="0 0 16 16">
        {iconData[animate ? currentFrame : 0].map((colorIndex, i) => {
          const [r, g, b, a] = iconPalette[colorIndex] || [0, 0, 0, 0];
          return (
            <rect
              key={i}
              x={(i % 16) * 1}
              y={Math.floor(i / 16) * 1}
              width="1"
              height="1"
              fill={`rgba(${r},${g},${b},${a / 255})`}
            />
          );
        })}
      </svg>
    </div>
  );
};

export default PS1BlockIcon;
