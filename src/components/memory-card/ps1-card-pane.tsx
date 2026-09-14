import type { RefObject } from "react";
import { useRef, useState } from "react";

import { GameDetailsSidebar } from "@/components/memory-card/game-details-sidebar";
import { SaveDialog } from "@/components/save-dialog";
import { SaveSingleSaveDialog } from "@/components/save-single-save-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { type Ps1CardView } from "@/hooks/memory-card-view";
import {
  type CardCommit,
  type CardCommitAsync,
  type MemoryCard,
  type TempBuffer,
} from "@/hooks/use-memory-card-workspace";
import PS1MemoryCard, {
  CardTypes,
  SingleSaveTypes,
  SlotTypes,
} from "@/lib/ps1-memory-card";

import { CardContentHeader } from "./card-content-header";
import { type CompareSaveData } from "./compare-save-dialog";
import { EditCommentDialog } from "./edit-comment-dialog";
import { EditHeaderDialog } from "./edit-header-dialog";
import { ps1CardActions } from "./ps1-card-actions";
import type { Ps1SlotAction } from "./ps1-slot";
import { Ps1SlotList } from "./ps1-slot-list";
import { PS1_CARD_FORMATS, PS1_SINGLE_SAVE_FORMATS } from "./save-formats";
import type { FamilyToolbarCaps, FamilyToolbarHandlers } from "./types";
import { useFamilyToolbarPublish } from "./use-family-toolbar-publish";

interface Ps1CardPaneProps {
  card: PS1MemoryCard;
  view: Ps1CardView;
  cardId: number;
  cardName: string;
  cardType: MemoryCard["type"];
  cardSource: string;
  tempBuffer: TempBuffer;
  familyHandlersRef: RefObject<FamilyToolbarHandlers>;
  onFamilyCapsChange: (caps: FamilyToolbarCaps) => void;
  onTempBufferChange: (buffer: TempBuffer) => void;
  onCompare: (data: CompareSaveData) => void;
  onOpenFiles: (files: File[]) => void;
  onError: (message: string | null) => void;
  commit: CardCommit;
  commitAsync: CardCommitAsync;
  bump: () => void;
  fixCorrupted: boolean;
}

export const Ps1CardPane: React.FC<Ps1CardPaneProps> = ({
  card,
  view,
  cardId,
  cardName,
  cardType,
  cardSource,
  tempBuffer,
  familyHandlersRef,
  onFamilyCapsChange,
  onTempBufferChange,
  onCompare,
  onOpenFiles,
  onError,
  commit,
  commitAsync,
  bump,
  fixCorrupted,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dialogSlot, setDialogSlot] = useState<number | null>(null);
  const [isHeaderDialogOpen, setIsHeaderDialogOpen] = useState(false);
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
  const [pendingErase, setPendingErase] = useState<number | null>(null);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isSingleOpen, setIsSingleOpen] = useState(false);
  const slots = view.slots;
  const ps1Buffer = tempBuffer?.kind === "ps1" ? tempBuffer : null;
  const selectedSave =
    selectedSlot !== null ? view.saves[selectedSlot] : undefined;
  const dialogSave = dialogSlot !== null ? view.saves[dialogSlot] : undefined;
  const eraseChain =
    pendingErase !== null ? (view.slots[pendingErase]?.linkedSlots ?? []) : [];

  const actions = ps1CardActions({
    card,
    saves: view.saves,
    cardId,
    selectedSlot,
    tempBuffer,
    commit,
    commitAsync,
    setSelectedSlot,
    setTempBuffer: onTempBufferChange,
    setError: onError,
  });
  useFamilyToolbarPublish(
    familyHandlersRef,
    {
      copy: actions.copy,
      move: actions.move,
      paste: actions.paste,
      deleteSave: actions.deleteSave,
      importSave: () => {
        const input = importInputRef.current;
        if (!input) return;
        input.value = "";
        input.click();
      },
      saveCard: () => setIsSaveOpen(true),
      exportSave: () => setIsSingleOpen(true),
    },
    actions.caps,
    onFamilyCapsChange,
  );

  const handleSlotClick = (index: number) => {
    const parentSlot = card.getMasterLinkForSlot(index);
    const linkedSlots = card.getSaveLinks(parentSlot);
    const next = linkedSlots.includes(selectedSlot ?? -1) ? null : parentSlot;
    setSelectedSlot(next);
    setSidebarOpen(next !== null);
  };

  const handleSlotAction = (action: Ps1SlotAction, index: number) => {
    const master = card.getMasterLinkForSlot(index);
    setDialogSlot(master);
    switch (action) {
      case "editHeader":
        setIsHeaderDialogOpen(true);
        break;
      case "editComment":
        setIsCommentDialogOpen(true);
        break;
      case "remove":
        setPendingErase(master);
        break;
      case "compare": {
        if (ps1Buffer) {
          const fetched = card.getSaveBytes(master);
          onCompare({
            save1Name: card.getSaves()[master].name,
            save1Bytes: fetched,
            save2Name: ps1Buffer.slots[0]?.name ?? "temp buffer",
            save2Bytes: ps1Buffer.bytes,
          });
        }
        break;
      }
    }
  };

  const handleConfirmErase = () => {
    if (pendingErase === null) return;
    actions.eraseSave(pendingErase);
    setPendingErase(null);
  };

  const handleListDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleListDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    void (async () => {
      if (files.length === 1 && selectedSlot !== null) {
        if (view.saves[selectedSlot].slotType !== SlotTypes.Formatted) {
          onError("The selected slot is not empty");
          return;
        }
        const imported = await actions.importFile(files[0], selectedSlot);
        if (imported) return;
      }
      onOpenFiles(files);
    })();
  };

  const handleSaveConfirm = async (fileName: string, format: CardTypes) => {
    const success = await card.saveMemoryCard(fileName, format, fixCorrupted);
    if (success) {
      onError(null);
      bump();
    } else {
      onError("Failed to save memory card");
    }
  };

  const handleExportConfirm = async (
    fileName: string,
    saveType: SingleSaveTypes,
  ) => {
    if (selectedSlot === null) return;
    const parentSlot = card.getMasterLinkForSlot(selectedSlot);
    const success = await card.saveSingleSave(fileName, parentSlot, saveType);
    onError(success ? null : "Failed to export save");
  };

  return (
    <>
      <div className="flex min-h-0 grow flex-col bg-card/60">
        <CardContentHeader
          name={cardName}
          type={cardType}
          kind="ps1"
          source={cardSource}
          checksum={view.checksum}
          tempBuffer={tempBuffer}
        />
        <div
          className="flex min-h-0 grow flex-col"
          onDragOver={handleListDragOver}
          onDrop={handleListDrop}
        >
          <Ps1SlotList
            slots={slots}
            selectedSlot={selectedSlot}
            hasTempBuffer={ps1Buffer !== null}
            onSlotClick={handleSlotClick}
            onSlotAction={handleSlotAction}
          />
        </div>
      </div>
      {sidebarOpen && selectedSave && selectedSlot !== null && (
        <GameDetailsSidebar
          gameId={selectedSave.productCode}
          region={selectedSave.region}
          saveName={selectedSave.name}
          icon={{
            data: view.slots[selectedSlot].iconData,
            palette: view.slots[selectedSlot].iconPalette,
            frameCount: selectedSave.iconFrameCount,
          }}
          onClose={() => setSidebarOpen(false)}
        />
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".mcs,.ps1,.psv,.mcb,.mcx,.pda,.psx,.psm,.bin,.raw"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || selectedSlot === null) return;
          void actions.importFile(file, selectedSlot).then((success) => {
            onError(success ? null : "Failed to import save");
          });
        }}
      />
      <SaveDialog
        isOpen={isSaveOpen}
        onOpenChange={setIsSaveOpen}
        defaultFileName={cardName}
        formats={PS1_CARD_FORMATS}
        defaultFormat={view.cardType}
        onSave={handleSaveConfirm}
      />
      <SaveSingleSaveDialog
        key={selectedSlot ?? "no-slot"}
        isOpen={isSingleOpen}
        onOpenChange={setIsSingleOpen}
        defaultFileName={`${selectedSave?.regionRaw ?? ""}${selectedSave?.productCode ?? ""}${selectedSave?.identifier ?? ""}`}
        formats={PS1_SINGLE_SAVE_FORMATS}
        defaultFormat={SingleSaveTypes.Mcs}
        onSave={handleExportConfirm}
      />
      <EditHeaderDialog
        key={`header-${dialogSlot ?? "none"}`}
        isOpen={isHeaderDialogOpen}
        onOpenChange={setIsHeaderDialogOpen}
        initialProductCode={dialogSave?.productCode ?? ""}
        initialIdentifier={dialogSave?.identifier ?? ""}
        initialRegion={dialogSave?.region ?? ""}
        onSave={(productCode, identifier, region) => {
          if (dialogSlot !== null) {
            commit(cardId, "Header edited", () => {
              card.setHeaderData(dialogSlot, productCode, identifier, region);
            });
          }
          setIsHeaderDialogOpen(false);
        }}
      />
      <EditCommentDialog
        key={`comment-${dialogSlot ?? "none"}`}
        isOpen={isCommentDialogOpen}
        onOpenChange={setIsCommentDialogOpen}
        initialComment={dialogSave?.comment ?? ""}
        onSave={(comment) => {
          if (dialogSlot !== null) {
            commit(cardId, "Comment edited", () => {
              card.setComment(dialogSlot, comment);
            });
          }
          setIsCommentDialogOpen(false);
        }}
      />
      <AlertDialog
        open={pendingErase !== null}
        onOpenChange={(open) => {
          if (!open) setPendingErase(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase slot data</AlertDialogTitle>
            <AlertDialogDescription>
              {eraseChain.length > 1
                ? `This will erase ${eraseChain.length} slots (${eraseChain
                    .map((s) => s + 1)
                    .join(", ")}), the entire multi-slot save.`
                : `This will erase the data in slot ${(pendingErase ?? 0) + 1}.`}{" "}
              You can undo this action from the toolbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmErase}>
              Erase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
