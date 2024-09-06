import { useEffect, useRef } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LogEntry } from "@/contexts/logs-context";

interface LogViewerProps {
  logs: LogEntry[];
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs }) => {
  const lastLogRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (logs.length > 0) {
      lastLogRef?.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Logs</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          {logs.map((log, index, row) => (
            <p
              key={index}
              className="text-sm"
              ref={index + 1 === row.length ? lastLogRef : null}
            >
              {log.timestamp.toLocaleTimeString()}: {log.message}
            </p>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
