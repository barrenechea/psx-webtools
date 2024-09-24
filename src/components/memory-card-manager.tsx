import {
  ArrowRightIcon,
  CopyIcon,
  CpuIcon,
  FolderIcon,
  PlusIcon,
  SaveIcon,
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

type Region = "us" | "eu" | "ja";

interface SaveSlot {
  name: string;
  date: string;
  region: Region;
  productCode: string;
  identifier: string;
}

interface MemoryCard {
  id: number;
  name: string;
  type: "file" | "usb" | "serial";
  source: string;
  slots: (SaveSlot | null)[];
}

const regionFlags: Record<Region, string> = {
  us: "🇺🇸",
  eu: "🇪🇺",
  ja: "🇯🇵",
};

const MAX_SLOTS = 15;

interface MemoryCardSlotProps {
  slot: SaveSlot | null;
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
        {slot ? (
          <>
            <SaveIcon className="mr-3 size-5 shrink-0 text-gray-400" />
            <div className="min-w-0 grow">
              <h3 className="truncate text-sm font-medium text-gray-900">
                {slot.name}
              </h3>
              <p className="truncate text-xs text-gray-500">
                {slot.productCode}
              </p>
            </div>
            <span className="mr-2 shrink-0 text-sm">
              {regionFlags[slot.region]}
            </span>
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

  const generateSlot = (): SaveSlot => ({
    name: `Game Save ${Math.floor(Math.random() * 100) + 1}`,
    date: new Date().toLocaleDateString(),
    region: ["us", "eu", "ja"][Math.floor(Math.random() * 3)] as Region,
    productCode: `SLUS-${String(10000 + Math.floor(Math.random() * 1000)).padStart(5, "0")}`,
    identifier: `JNNKG${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
  });

  const addMemoryCard = (type: "file" | "usb" | "serial") => {
    const newCard: MemoryCard = {
      id: Date.now(),
      name: `Memory Card ${memoryCards.length + 1}`,
      type: type,
      source:
        type === "file"
          ? "example.mcr"
          : type === "usb"
            ? "USB Device"
            : "Serial Port",
      slots: Array<SaveSlot | null>(MAX_SLOTS).fill(null),
    };
    setMemoryCards([...memoryCards, newCard]);
    setSelectedCard(newCard.id);
  };

  const addSlot = () => {
    if (selectedCard) {
      const cardIndex = memoryCards.findIndex(
        (card) => card.id === selectedCard
      );
      if (cardIndex !== -1) {
        const emptySlotIndex = memoryCards[cardIndex].slots.findIndex(
          (slot) => slot === null
        );
        if (emptySlotIndex !== -1) {
          const newMemoryCards = [...memoryCards];
          newMemoryCards[cardIndex].slots[emptySlotIndex] = generateSlot();
          setMemoryCards(newMemoryCards);
        }
      }
    }
  };

  const handleCopyMove = (action: "copy" | "move") => {
    setError(null);
    if (selectedCard === null || selectedSlot === null) return;

    const sourceCardIndex = memoryCards.findIndex(
      (card) => card.id === selectedCard
    );
    const destinationCardIndex = memoryCards.findIndex(
      (card) => card.id !== selectedCard
    );

    if (sourceCardIndex !== -1 && destinationCardIndex !== -1) {
      const emptySlotIndex = memoryCards[destinationCardIndex].slots.findIndex(
        (slot) => slot === null
      );
      if (emptySlotIndex !== -1) {
        const newMemoryCards = [...memoryCards];
        const slotToTransfer =
          newMemoryCards[sourceCardIndex].slots[selectedSlot];
        if (slotToTransfer) {
          newMemoryCards[destinationCardIndex].slots[emptySlotIndex] = {
            ...slotToTransfer,
          };
          if (action === "move") {
            newMemoryCards[sourceCardIndex].slots[selectedSlot] = null;
          }
          setMemoryCards(newMemoryCards);
          setSelectedSlot(null);
        }
      } else {
        setError(`Cannot ${action}. The destination memory card is full.`);
      }
    }
  };

  const handleDelete = () => {
    if (selectedCard !== null && selectedSlot !== null) {
      const cardIndex = memoryCards.findIndex(
        (card) => card.id === selectedCard
      );
      if (cardIndex !== -1) {
        const newMemoryCards = [...memoryCards];
        newMemoryCards[cardIndex].slots[selectedSlot] = null;
        setMemoryCards(newMemoryCards);
        setSelectedSlot(null);
      }
    }
  };

  const getCardIcon = (type: "file" | "usb" | "serial") => {
    switch (type) {
      case "file":
        return <FolderIcon className="mr-2 size-4" />;
      case "usb":
        return <UsbIcon className="mr-2 size-4" />;
      case "serial":
        return <CpuIcon className="mr-2 size-4" />;
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
                  onClick={addSlot}
                  disabled={
                    !selectedCard ||
                    !memoryCards
                      .find((card) => card.id === selectedCard)
                      ?.slots.includes(null)
                  }
                >
                  <PlusIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add new save</TooltipContent>
            </Tooltip>
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
                    {getCardIcon(card.type)}
                    {card.name}
                  </Button>
                ))}
              </div>
            </ScrollArea>
            <div className="space-y-1 border-t border-gray-200 p-2">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => addMemoryCard("file")}
              >
                <FolderIcon className="mr-2 size-4" />
                Open from file
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => addMemoryCard("usb")}
              >
                <UsbIcon className="mr-2 size-4" />
                Connect USB device
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => addMemoryCard("serial")}
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
                    (
                    {
                      memoryCards
                        .find((card) => card.id === selectedCard)
                        ?.slots.filter(Boolean).length
                    }
                    /15)
                  </h2>
                  <p className="text-sm text-gray-500">
                    {(() => {
                      const card = memoryCards.find(
                        (card) => card.id === selectedCard
                      );
                      switch (card?.type) {
                        case "file":
                          return `Opened via file "${card.source}"`;
                        case "usb":
                          return "Connected via USB";
                        case "serial":
                          return "Connected via Serial";
                        default:
                          return "";
                      }
                    })()}
                  </p>
                </div>
                <ScrollArea className="grow">
                  <div className="p-4">
                    {memoryCards
                      .find((card) => card.id === selectedCard)
                      ?.slots.map((slot, index) => (
                        <MemoryCardSlot
                          key={index}
                          slot={slot}
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
              ? `${memoryCards.find((card) => card.id === selectedCard)?.slots.filter(Boolean).length ?? 0} items`
              : "No memory card selected")}
        </div>
      </div>
    </div>
  );
};
