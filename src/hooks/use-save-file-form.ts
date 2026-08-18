import { useState } from "react";

import { getFileExtension, withSingleExtension } from "@/lib/ps1-memory-card";

interface UseSaveFileFormOptions<T extends number> {
  defaultFileName: string;
  defaultFormat: T;
  /**
   * The extensions a format can be saved with. A single entry means the format
   * has one fixed extension; multiple entries mean the dialog should offer an
   * extension picker (e.g. the many raw-card extensions).
   */
  extensionsFor: (format: T) => readonly string[];
}

/**
 * Shared state for the "save file" dialogs (full card + single save): a file
 * name whose extension always matches the selected format, defaulting to the
 * source file's own extension when it is a valid one for that format.
 */
export function useSaveFileForm<T extends number>({
  defaultFileName,
  defaultFormat,
  extensionsFor,
}: UseSaveFileFormOptions<T>) {
  const originalExt = getFileExtension(defaultFileName);

  // For formats with several allowed extensions, also surface the source
  // file's original extension (if any) so it can be preselected.
  const optionsFor = (format: T): readonly string[] => {
    const base = extensionsFor(format);
    if (base.length > 1 && originalExt && !base.includes(originalExt)) {
      return [...base, originalExt];
    }
    return base;
  };

  const pickExtension = (format: T): string => {
    const options = optionsFor(format);
    return originalExt && options.includes(originalExt)
      ? originalExt
      : options[0];
  };

  const [saveType, setSaveType] = useState<T>(defaultFormat);
  const [subExtension, setSubExtension] = useState<string>(() =>
    pickExtension(defaultFormat),
  );
  const [fileName, setFileName] = useState<string>(() =>
    withSingleExtension(defaultFileName, pickExtension(defaultFormat)),
  );

  const setFormat = (format: T) => {
    const ext = pickExtension(format);
    setSaveType(format);
    setSubExtension(ext);
    setFileName((prev) => withSingleExtension(prev, ext));
  };

  const setExtension = (ext: string) => {
    setSubExtension(ext);
    setFileName((prev) => withSingleExtension(prev, ext));
  };

  const currentExtensions = optionsFor(saveType);

  return {
    fileName,
    setFileName,
    saveType,
    setFormat,
    subExtension,
    setExtension,
    currentExtensions,
    hasExtensionPicker: currentExtensions.length > 1,
  };
}

export default useSaveFileForm;
