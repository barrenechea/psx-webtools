import { useContext } from "react";

import { LogsContext, type LogsContextType } from "@/contexts/logs-context";

export const useLogs = (): LogsContextType => {
  const context = useContext(LogsContext);
  if (context === undefined) {
    throw new Error("useLogs must be used within a LogsProvider");
  }
  return context;
};
