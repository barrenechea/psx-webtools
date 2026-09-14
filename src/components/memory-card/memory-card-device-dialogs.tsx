import { MemcarduinoConnectDialog } from "@/components/memcarduino-connect-dialog";
import { SlotConnectDialog } from "@/components/slot-connect-dialog";
import type { MemoryCardDeviceDialogsProps } from "@/hooks/use-memory-card-device-ops";

import { FormatCardDialog } from "./format-card-dialog";
import { PocketStationDialog } from "./pocketstation-dialog";
import { Ps2MgKeyDialog } from "./ps2-mg-key-dialog";
import { SlotCardPreview } from "./slot-card-preview";
import { WriteCardDialog } from "./write-card-dialog";

const PS1_VERIFY_HINT =
  "Re-read the card and confirm the raw checksum still matches. GME comments are not part of this check.";
const PS2_VERIFY_HINT =
  "Re-read the card and confirm the raw checksum still matches. ECC spares are not part of this check.";

export function MemoryCardDeviceDialogs({
  isConnectDialogOpen,
  setIsConnectDialogOpen,
  handleMemcarduinoConnect,
  isPS1CardLinkDialogOpen,
  setIsPS1CardLinkDialogOpen,
  handlePS1CardLinkConnect,
  isUniromDialogOpen,
  setIsUniromDialogOpen,
  handleUniromConnect,
  isPocketStationDialogOpen,
  setIsPocketStationDialogOpen,
  readPocketStationSerial,
  dumpPocketStationBIOS,
  setPocketStationTime,
  isWriteDialogOpen,
  setIsWriteDialogOpen,
  handleWriteConfirm,
  verifyAfterWrite,
  setVerifyAfterWrite,
  isFormatDialogOpen,
  setIsFormatDialogOpen,
  formatCardKind,
  handleFormatConfirm,
  isMgKeyDialogOpen,
  handleMgKeyClose,
  storedSection,
  handleMgKeySelect,
  detectedCard,
  writeCardName,
  writeChecksum,
  writeKind,
  deviceName,
}: MemoryCardDeviceDialogsProps) {
  return (
    <>
      <SlotCardPreview kind={detectedCard} />
      <MemcarduinoConnectDialog
        isOpen={isConnectDialogOpen}
        onOpenChange={setIsConnectDialogOpen}
        onConnect={handleMemcarduinoConnect}
      />
      <SlotConnectDialog
        isOpen={isPS1CardLinkDialogOpen}
        onOpenChange={setIsPS1CardLinkDialogOpen}
        title="Connect to PS1CardLink"
        storageKey="ps1cardlinkSettings"
        note="Note: PS1CardLink connects at a fixed 115200 baud rate."
        onConnect={handlePS1CardLinkConnect}
      />
      <SlotConnectDialog
        isOpen={isUniromDialogOpen}
        onOpenChange={setIsUniromDialogOpen}
        title="Connect to Unirom"
        storageKey="uniromSettings"
        note="Note: Unirom connects at a fixed 115200 baud rate. Make sure the Unirom firmware is running on your console."
        onConnect={handleUniromConnect}
      />
      <PocketStationDialog
        isOpen={isPocketStationDialogOpen}
        onOpenChange={setIsPocketStationDialogOpen}
        onReadSerial={readPocketStationSerial}
        onDumpBios={dumpPocketStationBIOS}
        onSetTime={setPocketStationTime}
      />
      <WriteCardDialog
        isOpen={isWriteDialogOpen}
        onOpenChange={setIsWriteDialogOpen}
        cardName={writeCardName}
        checksum={writeChecksum}
        deviceName={deviceName}
        verify={verifyAfterWrite}
        onVerifyChange={setVerifyAfterWrite}
        verifyHint={writeKind === "ps2" ? PS2_VERIFY_HINT : PS1_VERIFY_HINT}
        onConfirm={handleWriteConfirm}
      />
      <FormatCardDialog
        isOpen={isFormatDialogOpen}
        onOpenChange={setIsFormatDialogOpen}
        deviceName={deviceName}
        cardKind={formatCardKind}
        onFormat={handleFormatConfirm}
      />
      <Ps2MgKeyDialog
        isOpen={isMgKeyDialogOpen}
        onOpenChange={handleMgKeyClose}
        storedSection={storedSection}
        onSelect={handleMgKeySelect}
      />
    </>
  );
}
