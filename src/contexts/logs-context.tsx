import { createContext, useCallback, useState } from "react";

export interface LogEntry {
  message: string;
  timestamp: Date;
}

export interface LogsContextType {
  logs: LogEntry[];
  appendLog: (message: string) => void;
}

export const LogsContext = createContext<LogsContextType | undefined>(
  undefined
);

export const LogsProvider: React.FC<{ children: React.JSX.Element }> = ({
  children,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const appendLog = useCallback((message: string): void => {
    setLogs((prevLogs) => [...prevLogs, { message, timestamp: new Date() }]);
  }, []);

  return (
    <LogsContext.Provider value={{ logs, appendLog }}>
      {children}
    </LogsContext.Provider>
  );
};
