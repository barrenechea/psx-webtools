import { useState } from "react";

import { cn } from "@/lib/utils";

interface DragDropWrapperProps {
  onFileDrop: (files: File[]) => void;
  children: React.ReactNode;
}

export const DragDropWrapper: React.FC<DragDropWrapperProps> = ({
  onFileDrop,
  children,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      onFileDrop(files);
    }
  };

  const handleOverlayDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.target === event.currentTarget) {
      setIsDragging(false);
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative flex h-full w-full justify-center"
    >
      {children}
      <div
        aria-hidden={!isDragging}
        onDragLeave={handleOverlayDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "absolute inset-0 z-50 flex items-center justify-center backdrop-blur-xs transition-opacity duration-200",
          isDragging
            ? "bg-background/80 opacity-100"
            : "pointer-events-none invisible opacity-0",
        )}
      >
        <div className="border-primary pointer-events-none rounded-lg border-2 border-dashed p-8 text-center">
          <p className="text-lg font-semibold">
            Drop your memory card files here
          </p>
          <p className="text-muted-foreground text-sm">
            Supported formats: .mcr, .mcd, .gme, .vgs, .vmp, .psm, .ps1, .bin,
            .mem, .psx, .pda, .mc, .ddf, .mc1, .mc2, .srm
          </p>
        </div>
      </div>
    </div>
  );
};
