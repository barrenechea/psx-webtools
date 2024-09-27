interface PS1BlockIconProps {
  iconData: number[];
  iconPalette: [number, number, number, number][];
}

const PS1BlockIcon: React.FC<PS1BlockIconProps> = ({
  iconData,
  iconPalette,
}) => {
  return (
    <div className="mr-2 size-8 shrink-0">
      <svg width="32" height="32" viewBox="0 0 16 16">
        {iconData.map((colorIndex, i) => {
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
