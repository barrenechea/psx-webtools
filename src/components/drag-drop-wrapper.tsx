import { useEffect, useRef, useState } from "react";

interface DragDropWrapperProps {
  onFileDrop: (file: File) => void;
  children: React.ReactNode;
}

export const DragDropWrapper: React.FC<DragDropWrapperProps> = ({
  onFileDrop,
  children,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const timeoutRef = useRef<number | null>(null);

  const handleDrag = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current++;
    if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      if (dragCounter.current > 0) {
        setIsDragging(true);
      }
    }, 50);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      onFileDrop(files[0]);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDrag={handleDrag}
      className="flex size-full justify-center"
    >
      {children}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs transition-opacity duration-300">
          <div className="rounded-lg border-2 border-dashed border-primary p-8 text-center">
            <p className="text-lg font-semibold">
              Drop your memory card file here
            </p>
            <p className="text-sm text-muted-foreground">
              Supported formats: .mcr, .mcd, .gme, .vgs, .vmp, .psm, .ps1, .bin,
              .mem, .psx, .pda, .mc, .ddf, .mc1, .mc2, .srm
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
