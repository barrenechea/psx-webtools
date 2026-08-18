import { useCallback, useState } from "react";

/**
 * useState that mirrors its value to localStorage under `key`. The stored value
 * is JSON-encoded, so any JSON-serialisable type works. Falls back to
 * `defaultValue` when nothing is stored or the stored value can't be parsed.
 */
export function usePersistentState<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode, quota, etc.) — keep the in-memory
        // value; persistence is best-effort.
      }
    },
    [key],
  );

  return [value, update] as const;
}

export default usePersistentState;
