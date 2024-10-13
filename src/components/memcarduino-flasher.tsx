import { AlertCircle, CheckCircle2, GithubIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type Board } from "stk500-esm";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLoadingDialog } from "@/contexts/loading-dialog-context";
import useArduinoProgrammer from "@/hooks/use-arduino-programmer";

import PicoFlashInstructions from "./pico-flash-instructions";

type BoardwithExtension = Board & { boardWithExtension: string };

const arduinoBoards: BoardwithExtension[] = [
  {
    name: "ATmega328P-based Arduino (Uno, Nano, Pro Mini, etc.)",
    baudRate: 115200,
    signature: new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize: 128,
    timeout: 400,
    boardWithExtension: "atmega328p.hex",
  },
  {
    name: "Arduino Nano (Old Bootloader) (Most chinese clones)",
    signature: new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize: 128,
    timeout: 400,
    baudRate: 57600,
    boardWithExtension: "atmega328p.hex",
  },
  {
    name: "LGT8F328P Arduino Clone",
    signature: new Uint8Array([0x1e, 0x95, 0x0f]),
    pageSize: 128,
    timeout: 400,
    baudRate: 57600,
    boardWithExtension: "lgt8f328p.hex",
  },
  {
    name: "Raspberry Pi Pico",
    baudRate: 115200, // Not used for Pico
    signature: new Uint8Array([0, 0, 0]), // Not used for Pico
    pageSize: 0, // Not used for Pico
    timeout: 0, // Not used for Pico
    boardWithExtension: "pico.uf2",
  },
];

const memcarduinoVersions = [{ name: "v0.9", value: "0.9" }];

export function MemcarduinoFlasher() {
  const [selectedBoard, setSelectedBoard] = useState<BoardwithExtension | null>(
    null
  );
  const [selectedVersion, setSelectedVersion] = useState("");
  const { upload, progress, error, status } = useArduinoProgrammer();
  const { showDialog, updateDialog, hideDialog } = useLoadingDialog();
  const [isFlashing, setIsFlashing] = useState(false);
  const [isPicoDialogOpen, setIsPicoDialogOpen] = useState(false);

  useEffect(() => {
    if (isFlashing) {
      if (error) {
        updateDialog(status, undefined, progress / 100);
        setTimeout(() => {
          hideDialog();
          setIsFlashing(false);
        }, 5000);
      } else if (progress === 100) {
        updateDialog(status, undefined, 1);
        setTimeout(() => {
          hideDialog();
          setIsFlashing(false);
        }, 2000);
      } else {
        updateDialog(status, undefined, progress / 100);
      }
    }
  }, [isFlashing, status, progress, error, updateDialog, hideDialog]);

  const handleFlash = async () => {
    if (!selectedBoard || !selectedVersion) return;

    if (selectedBoard.name === "Raspberry Pi Pico") {
      setIsPicoDialogOpen(true);
      return;
    }

    setIsFlashing(true);
    showDialog("Flashing MemCARDuino", "Preparing to flash...");

    const hexFileUrl = `/memcarduino/MemCARDuino_v${selectedVersion}_${selectedBoard.boardWithExtension}`;
    await upload(selectedBoard, hexFileUrl, "url");
  };

  return (
    <div className="flex size-full items-center justify-center bg-transparent p-4">
      <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-xl shadow-xl">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border bg-muted/80 p-2">
          <h1 className="pl-2 font-light text-muted-foreground">
            MemCARDuino Flasher{" "}
            <span className="text-xs text-sky-500 dark:text-sky-400">Beta</span>
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
                  Select your board and MemCARDuino version to flash
                </p>
              </div>
            </div>
            <ScrollArea className="grow" type="auto">
              <div className="space-y-6 p-6">
                <div className="space-y-2">
                  <label htmlFor="board-select" className="text-sm font-medium">
                    Select Board
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
                {error && !isFlashing && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {progress === 100 && !isFlashing && (
                  <Alert>
                    <CheckCircle2 className="size-4" />
                    <AlertTitle>Success</AlertTitle>
                    <AlertDescription>
                      MemCARDuino firmware has been successfully flashed to your
                      device.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex justify-end">
                  <Button
                    onClick={() => void handleFlash()}
                    disabled={!selectedBoard || !selectedVersion || isFlashing}
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
          <span>
            Builds by{" "}
            <a
              href="https://github.com/barrenechea/memcarduino-builder"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              memcarduino-builder
            </a>
          </span>
          <a
            href="https://github.com/ShendoXT/memcarduino"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-2 underline hover:text-foreground"
          >
            <GithubIcon className="size-4" />
            <span>View MemCARDuino on GitHub</span>
          </a>
        </div>
      </div>
      <PicoFlashInstructions
        isOpen={isPicoDialogOpen}
        version={selectedVersion}
        onClose={() => setIsPicoDialogOpen(false)}
      />
    </div>
  );
}
