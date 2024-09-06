import { AlertCircle, Upload, X } from "lucide-react";
import { ChangeEvent, useCallback, useRef, useState } from "react";

import { LogViewer } from "@/components/log-viewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useLogs } from "@/hooks/use-logs";
import { useSerial } from "@/hooks/use-serial";

const WRITE_TIMEOUT = 500; // in milliseconds

export const EXELoader: React.FC = () => {
  const { isConnected, writeToPort, cancelCurrentOperation } = useSerial();
  const { logs, appendLog } = useLogs();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);
  const uploadCancelledRef = useRef<boolean>(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      appendLog(`File selected: ${selectedFile.name}`);
    } else {
      setFile(null);
      appendLog("File selection cleared");
    }
  };

  const uploadEXE = useCallback(async () => {
    if (!isConnected || !file) {
      appendLog("Please connect to a port and select a file first");
      return;
    }

    setUploading(true);
    setProgress(0);
    uploadCancelledRef.current = false;

    try {
      const fileContent = await file.arrayBuffer();
      const data = new Uint8Array(fileContent);

      const writeWithRetry = async (
        chunk: Uint8Array,
        retries = 3
      ): Promise<void> => {
        try {
          if (uploadCancelledRef.current)
            throw new DOMException("Aborted", "AbortError");
          await writeToPort(chunk, WRITE_TIMEOUT);
        } catch (error) {
          if (retries > 0 && (error as Error).name !== "AbortError") {
            appendLog(`Write failed, retrying... (${retries} attempts left)`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await writeWithRetry(chunk, retries - 1);
          } else {
            throw error;
          }
        }
      };

      // Send sync byte
      await writeWithRetry(new Uint8Array([0x63]));
      if (uploadCancelledRef.current)
        throw new DOMException("Aborted", "AbortError");
      appendLog("Sending Sync");
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Send header (2048 bytes)
      await writeWithRetry(data.slice(0, 2048));
      if (uploadCancelledRef.current)
        throw new DOMException("Aborted", "AbortError");
      appendLog("Sending Header");
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send Init PC (4 bytes starting at offset 16)
      await writeWithRetry(data.slice(16, 20));
      appendLog("Sending Init PC");
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for 0.1 second

      // Send Addr (4 bytes starting at offset 24)
      await writeWithRetry(data.slice(24, 28));
      appendLog("Sending Addr");
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for 0.1 second

      // Send Filesize (4 bytes starting at offset 28)
      await writeWithRetry(data.slice(28, 32));
      appendLog("Sending Filesize");

      // Send the rest of the file in 2048-byte chunks
      const totalChunks = Math.ceil((data.length - 2048) / 2048);
      for (let i = 0; i < totalChunks; i++) {
        if (uploadCancelledRef.current)
          throw new DOMException("Aborted", "AbortError");
        const start = 2048 + i * 2048;
        const end = Math.min(start + 2048, data.length);
        await writeWithRetry(data.slice(start, end));
        appendLog(`Sending Chunk ${i + 1}/${totalChunks}`);
        setProgress(((i + 1) / totalChunks) * 100);
      }

      // Send EOF padding
      if (uploadCancelledRef.current)
        throw new DOMException("Aborted", "AbortError");
      await writeWithRetry(new Uint8Array(2048).fill(0xff));

      appendLog("Executing");
      appendLog("Operation Complete");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        appendLog("Upload cancelled");
      } else {
        appendLog(`Error during upload: ${(error as Error).message}`);
      }
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [file, isConnected, writeToPort, appendLog]);

  const cancelUpload = useCallback(() => {
    uploadCancelledRef.current = true;
    cancelCurrentOperation();
    appendLog("Cancelling upload...");
  }, [cancelCurrentOperation, appendLog]);

  const isButtonEnabled = isConnected && !!file && !uploading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">EXE Loader</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          type="file"
          onChange={handleFileChange}
          accept=".exe"
          disabled={uploading}
        />

        {uploading ? (
          <Button
            onClick={cancelUpload}
            disabled={uploadCancelledRef.current}
            variant="destructive"
            className="w-full"
          >
            <X className="mr-2 size-4" /> Cancel Upload
          </Button>
        ) : (
          <Button
            onClick={() => void uploadEXE()}
            disabled={!isButtonEnabled}
            className="w-full"
          >
            <Upload className="mr-2 size-4" /> Upload and Execute
          </Button>
        )}

        {uploading && <Progress value={progress} className="w-full" />}

        <LogViewer logs={logs} />

        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>Note</AlertTitle>
          <AlertDescription>
            This app requires a browser that supports the Web Serial API.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
