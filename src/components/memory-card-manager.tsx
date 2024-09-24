import {
  ArrowRightIcon,
  CopyIcon,
  CpuIcon,
  FolderIcon,
  TrashIcon,
  UsbIcon,
} from "lucide-react";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import PS1MemoryCard, {
  CardTypes,
  SaveInfo,
  SlotTypes,
} from "@/lib/ps1-memory-card";

interface MemoryCard {
  id: number;
  name: string;
  type: "file";
  source: string;
  card: PS1MemoryCard;
}

interface MemoryCardSlotProps {
  slot: SaveInfo;
  index: number;
  isSelected: boolean;
  onClick: (index: number) => void;
}

const MemoryCardSlot: React.FC<MemoryCardSlotProps> = ({
  slot,
  index,
  isSelected,
  onClick,
}) => {
  return (
    <Card
      className={`mb-2 cursor-pointer ${
        isSelected
          ? "border-blue-500 bg-blue-100"
          : "border-transparent hover:bg-gray-50"
      }`}
      onClick={() => onClick(index)}
    >
      <CardContent className="flex items-center p-3">
        <div className="mr-2 w-6 text-xs text-gray-400">
          {(index + 1).toString().padStart(2, "0")}
        </div>
        {slot.slotType !== SlotTypes.Formatted ? (
          <>
            <div className="min-w-0 grow">
              <h3 className="truncate text-sm font-medium text-gray-900">
                {slot.name}
              </h3>
              <p className="truncate text-xs text-gray-500">
                {slot.productCode}
              </p>
            </div>
            <span className="mr-2 shrink-0 text-sm">{slot.region}</span>
            <span className="shrink-0 text-xs text-gray-400">
              {slot.identifier}
            </span>
          </>
        ) : (
          <span className="text-sm text-gray-400">Empty Slot</span>
        )}
      </CardContent>
    </Card>
  );
};

export const MemoryCardManager: React.FC = () => {
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileOpen = () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        ".mcr,.mcd,.gme,.vgs,.vmp,.psm,.ps1,.bin,.mem,.psx,.pda,.mc,.ddf,.mc1,.mc2,.srm";

      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const card = new PS1MemoryCard();
          await card.loadFromFile(file);

          const newCard: MemoryCard = {
            id: Date.now(),
            name: file.name,
            type: "file",
            source: file.name,
            card: card,
          };

          setMemoryCards([...memoryCards, newCard]);
          setSelectedCard(newCard.id);
          setError(null);
        }
      };

      input.click();
    } catch (err) {
      setError(`Error opening file: ${(err as Error).message}`);
    }
  };

  const handleDelete = () => {
    if (selectedCard !== null && selectedSlot !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        card.toggleDeleteSave(selectedSlot);
        setMemoryCards([...memoryCards]);
      }
    }
  };

  const handleCopyMove = (action: "copy" | "move") => {
    setError(
      `${action.charAt(0).toUpperCase() + action.slice(1)} functionality is not implemented yet.`
    );
  };

  const handleSaveMemoryCard = () => {
    if (selectedCard !== null) {
      const card = memoryCards.find((c) => c.id === selectedCard)?.card;
      if (card) {
        const success = card.saveMemoryCard(
          `memory_card_${Date.now()}.mcr`,
          CardTypes.Raw
        );
        if (success) {
          setError(null);
        } else {
          setError("Failed to save memory card");
        }
      }
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-100 p-4">
      <div className="flex size-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        {/* Toolbar */}
        <div className="flex items-center space-x-2 border-b border-gray-200 bg-gray-50 p-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopyMove("copy")}
                  disabled={selectedSlot === null}
                >
                  <CopyIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Copy to other card</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopyMove("move")}
                  disabled={selectedSlot === null}
                >
                  <ArrowRightIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Move to other card</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDelete}
                  disabled={selectedSlot === null}
                >
                  <TrashIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Delete save</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleSaveMemoryCard}
                  disabled={selectedCard === null}
                >
                  <FolderIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Save memory card</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Main content */}
        <div className="flex grow overflow-hidden">
          {/* Sidebar */}
          <div className="flex w-48 flex-col border-r border-gray-200 bg-gray-50">
            <ScrollArea className="grow">
              <div className="p-2">
                {memoryCards.map((card) => (
                  <Button
                    key={card.id}
                    variant="ghost"
                    className={`mb-1 w-full justify-start ${
                      selectedCard === card.id
                        ? "bg-blue-100 text-blue-800"
                        : "hover:bg-gray-100"
                    }`}
                    onClick={() => setSelectedCard(card.id)}
                  >
                    <FolderIcon className="mr-2 size-4" />
                    {card.name}
                  </Button>
                ))}
              </div>
            </ScrollArea>
            <div className="space-y-1 border-t border-gray-200 p-2">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={handleFileOpen}
              >
                <FolderIcon className="mr-2 size-4" />
                Open from file
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() =>
                  setError(
                    "USB device connection is not implemented in this version."
                  )
                }
              >
                <UsbIcon className="mr-2 size-4" />
                Connect USB device
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() =>
                  setError(
                    "Serial device connection is not implemented in this version."
                  )
                }
              >
                <CpuIcon className="mr-2 size-4" />
                Connect Serial device
              </Button>
            </div>
          </div>

          {/* Card content */}
          <div className="flex grow flex-col">
            {selectedCard ? (
              <>
                <div className="border-b border-gray-200 bg-gray-50 p-4">
                  <h2 className="mb-1 text-lg font-semibold">
                    {memoryCards.find((card) => card.id === selectedCard)?.name}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {`Opened via file "${
                      memoryCards.find((card) => card.id === selectedCard)
                        ?.source
                    }"`}
                  </p>
                </div>
                <ScrollArea className="grow">
                  <div className="p-4">
                    {memoryCards
                      .find((card) => card.id === selectedCard)
                      ?.card.getSaves()
                      .map((save, index) => (
                        <MemoryCardSlot
                          key={index}
                          slot={save}
                          index={index}
                          isSelected={selectedSlot === index}
                          onClick={(index) =>
                            setSelectedSlot(
                              selectedSlot === index ? null : index
                            )
                          }
                        />
                      ))}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex grow flex-col items-center justify-center p-4 text-gray-500">
                <p className="mb-4 text-lg">No memory card selected</p>
                <p className="text-sm">
                  Open a memory card file or connect a device to get started
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="border-t border-gray-200 bg-gray-50 p-2 text-sm text-gray-600">
          {error ??
            (selectedCard
              ? `${
                  memoryCards
                    .find((card) => card.id === selectedCard)
                    ?.card.getSaves().length ?? 0
                } items`
              : "No memory card selected")}
        </div>
      </div>
    </div>
  );
};
