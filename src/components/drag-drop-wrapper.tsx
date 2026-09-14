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

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setIsDragging(false);
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

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex h-full w-full justify-center"
    >
      {children}
      <div
        aria-hidden={!isDragging}
        className={cn(
          "pointer-events-none absolute inset-0 z-50 flex items-center justify-center backdrop-blur-xs transition-opacity duration-200",
          isDragging ? "bg-background/80 opacity-100" : "invisible opacity-0",
        )}
      >
        <div className="rounded-lg border-2 border-dashed border-primary p-8 text-center">
          <p className="text-lg font-semibold">
            Drop your memory card files here
          </p>
          <p className="text-sm text-muted-foreground">
            PS1 (.mcr, .gme, .vgs, .vmp, .mcs) and PS2 (.ps2, .mcd, .sdt, .psu)
            images
          </p>
        </div>
      </div>
    </div>
  );
};
