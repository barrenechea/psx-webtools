import {
  CpuIcon,
  FileIcon,
  FilePlusIcon,
  FolderOpenIcon,
  MemoryStickIcon,
  UsbIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

import { CardListItem } from "./card-list-item";
import type { MemoryCard } from "./types";

interface CardSidebarProps {
  cards: MemoryCard[];
  selectedCard: number | null;
  onSelectCard: (id: number) => void;
  onNewCard: () => void;
  onCloseCard: (id: number) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenFile: () => void;
  onConnectDexDrive: () => void;
  onConnectMemcarduino: () => void;
  onConnectPS1CardLink: () => void;
  onConnectPS3MCA: () => void;
  onConnectUnirom: () => void;
  onPocketStation: () => void;
  fixCorrupted: boolean;
  onFixCorruptedChange: (value: boolean) => void;
  isConnected: boolean;
  connectedDevice: string | null;
  onDisconnect: () => void;
  onRead: () => void;
  onWrite: () => void;
  onFormat: () => void;
}

export const CardSidebar: React.FC<CardSidebarProps> = ({
  cards,
  selectedCard,
  onSelectCard,
  onNewCard,
  onCloseCard,
  fileInputRef,
  onFileChange,
  onOpenFile,
  onConnectDexDrive,
  onConnectMemcarduino,
  onConnectPS1CardLink,
  onConnectPS3MCA,
  onConnectUnirom,
  onPocketStation,
  fixCorrupted,
  onFixCorruptedChange,
  isConnected,
  connectedDevice,
  onDisconnect,
  onRead,
  onWrite,
  onFormat,
}) => (
  <div className="border-border bg-muted/80 flex w-64 flex-col border-r">
    <ScrollArea className="grow overflow-hidden" type="auto">
      <div className="p-2">
        {cards.map((card) => (
          <CardListItem
            key={card.id}
            name={card.name}
            type={card.type}
            kind={card.card.kind}
            changed={card.card.changed}
            isSelected={selectedCard === card.id}
            onClick={() => onSelectCard(card.id)}
            onClose={() => onCloseCard(card.id)}
          />
        ))}
      </div>
    </ScrollArea>
    <div className="border-border space-y-1 border-t p-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".mcr,.mcd,.gme,.vgs,.vmp,.psm,.ps1,.bin,.mem,.psx,.pda,.mc,.ddf,.mc1,.mc2,.srm"
        className="sr-only"
        multiple
        onChange={onFileChange}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="hover:bg-card/80 w-full justify-start"
          >
            <FolderOpenIcon className="mr-2 size-4" />
            Open...
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" className="w-56">
          <DropdownMenuItem onSelect={onNewCard}>
            <FilePlusIcon />
            New card
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(event) => {
              // Keep the menu open so the native file picker can
              // open from within this user gesture.
              event.preventDefault();
              onOpenFile();
            }}
          >
            <FileIcon />
            Open from file
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <MemoryStickIcon />
              Connect a device
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuLabel>
                <div className="flex items-center">
                  <UsbIcon className="mr-2 size-4" />
                  USB Devices
                </div>
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={onConnectPS3MCA}>
                PS3 MC Adaptor
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                <div className="flex items-center">
                  <CpuIcon className="mr-2 size-4" />
                  Serial Devices
                </div>
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={onConnectDexDrive}>
                DexDrive
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onConnectMemcarduino}>
                MemCARDuino
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onConnectPS1CardLink}>
                PS1CardLink
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onConnectUnirom}>
                Unirom
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={fixCorrupted}
            onCheckedChange={(checked) => onFixCorruptedChange(checked)}
            onSelect={(event) => {
              // Keep the menu open; this is a setting, not a
              // navigational action.
              event.preventDefault();
            }}
          >
            Try to fix corrupted cards
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isConnected && (
        <>
          <Button
            variant="ghost"
            className="hover:bg-card/80 w-full justify-start"
            onClick={onDisconnect}
          >
            Disconnect {connectedDevice ?? "device"}
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-card/80 w-full justify-start"
            onClick={onRead}
          >
            Read from {connectedDevice ?? "device"}
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-card/80 w-full justify-start"
            onClick={onWrite}
            disabled={selectedCard === null}
          >
            Write to {connectedDevice ?? "device"}
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-card/80 w-full justify-start"
            onClick={onFormat}
          >
            Format {connectedDevice ?? "device"}
          </Button>
          {(connectedDevice === "MemCARDuino" ||
            connectedDevice === "PS3 MC Adaptor") && (
            <Button
              variant="ghost"
              className="hover:bg-card/80 w-full justify-start"
              onClick={onPocketStation}
            >
              PocketStation
            </Button>
          )}
        </>
      )}
    </div>
  </div>
);
