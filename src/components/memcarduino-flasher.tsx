import { AlertCircle, CheckCircle2, GithubIcon } from "lucide-react";
import { useState } from "react";
import { type Board } from "stk500-esm";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useArduinoProgrammer from "@/hooks/use-arduino-programmer";

const arduinoBoards: Board[] = [
  {
    name: "Arduino Nano",
    baudRate: 115200,
    signature: Buffer.from([0x1e, 0x95, 0x0f]),
    pageSize: 128,
    timeout: 400,
  },
  {
    name: "Arduino Nano (Old Bootloader)",
    signature: Buffer.from([0x1e, 0x95, 0x0f]),
    pageSize: 128,
    timeout: 400,
    baudRate: 57600,
  },
];

const memcarduinoVersions = [
  { name: "v0.9", value: "0.9" },
  { name: "v0.8", value: "0.8" },
  { name: "v0.7", value: "0.7" },
  { name: "v0.6", value: "0.6" },
  { name: "v0.5", value: "0.5" },
  { name: "v0.4", value: "0.4" },
];

export function MemcarduinoFlasher() {
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [selectedVersion, setSelectedVersion] = useState("");
  const { upload, progress, error } = useArduinoProgrammer();

  const handleFlash = async () => {
    if (!selectedBoard || !selectedVersion) return;

    const hexFileUrl = `/memcarduino-hex/MemCARDuino_v${selectedVersion}_nano.hex`;
    await upload(selectedBoard, hexFileUrl, "url");
  };

  return (
    <div className="flex size-full items-center justify-center bg-transparent p-4">
      <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-xl shadow-xl">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-muted/80 p-2">
          <h1 className="pl-2 font-light text-muted-foreground">
            MemCARDuino Flasher{" "}
            <span className="text-xs text-destructive dark:text-red-400">
              Beta
            </span>
          </h1>
        </div>

        {/* Main content */}
        <div className="flex grow overflow-hidden">
          <div className="flex grow flex-col bg-card/80">
            <div className="flex items-center justify-between border-b border-border bg-muted/80 p-4 px-6">
              <div>
                <h2 className="mb-1 text-lg font-semibold">
                  Flash MemCARDuino Firmware
                </h2>
                <p className="text-sm text-muted-foreground">
                  Select your Arduino board and MemCARDuino version to flash
                </p>
              </div>
            </div>
            <ScrollArea className="grow" type="auto">
              <div className="space-y-6 p-6">
                <div className="space-y-2">
                  <label htmlFor="board-select" className="text-sm font-medium">
                    Select Arduino Board
                  </label>
                  <Select
                    value={selectedBoard?.name}
                    onValueChange={(value) =>
                      setSelectedBoard(
                        arduinoBoards.find((b) => b.name === value) ?? null
                      )
                    }
                  >
                    <SelectTrigger id="board-select">
                      <SelectValue placeholder="Choose a board" />
                    </SelectTrigger>
                    <SelectContent>
                      {arduinoBoards.map((board) => (
                        <SelectItem key={board.name} value={board.name}>
                          {board.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="version-select"
                    className="text-sm font-medium"
                  >
                    Select MemCARDuino Version
                  </label>
                  <Select
                    value={selectedVersion}
                    onValueChange={setSelectedVersion}
                  >
                    <SelectTrigger id="version-select">
                      <SelectValue placeholder="Choose a version" />
                    </SelectTrigger>
                    <SelectContent>
                      {memcarduinoVersions.map((version) => (
                        <SelectItem key={version.value} value={version.value}>
                          {version.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {progress > 0 && progress < 100 && (
                  <div className="space-y-2">
                    <Progress value={progress} className="w-full" />
                    <p className="text-sm text-muted-foreground">
                      Flashing... {progress.toFixed(0)}%
                    </p>
                  </div>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {progress === 100 && (
                  <Alert
                    variant="default"
                    className="border-green-500 bg-green-50 dark:bg-green-950"
                  >
                    <CheckCircle2 className="size-4 text-green-500" />
                    <AlertTitle className="text-green-700 dark:text-green-300">
                      Success
                    </AlertTitle>
                    <AlertDescription className="text-green-600 dark:text-green-400">
                      MemCARDuino firmware has been successfully flashed to your
                      device.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex justify-end">
                  <Button
                    onClick={() => void handleFlash()}
                    disabled={
                      !selectedBoard || !selectedVersion || progress > 0
                    }
                  >
                    Flash MemCARDuino
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between border-t border-border bg-muted/80 px-4 py-2 text-sm text-muted-foreground">
          <div className="flex items-center space-x-2">
            <span>
              Powered by{" "}
              <a
                href="https://github.com/barrenechea/stk500-esm"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                stk500-esm
              </a>
            </span>
          </div>
          <div>
            <a
              href="https://github.com/ShendoXT/memcarduino"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 hover:text-foreground"
            >
              <GithubIcon className="size-4" />
              <span>View MemCARDuino on GitHub</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
