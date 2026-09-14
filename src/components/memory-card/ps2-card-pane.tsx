import type { RefObject } from "react";
import { useRef, useState } from "react";

import { type CompareSaveData } from "@/components/memory-card/compare-save-dialog";
import { Ps2ImportSaveDialog } from "@/components/memory-card/ps2-import-save-dialog";
import { Ps2SaveInfoSidebar } from "@/components/memory-card/ps2-save-info-sidebar";
import {
  type Ps2SaveAction,
  Ps2SaveList,
} from "@/components/memory-card/ps2-save-list";
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
import { type Ps2CardView } from "@/hooks/memory-card-view";
import {
  type CardCommit,
  type MemoryCard,
  type TempBuffer,
} from "@/hooks/use-memory-card-workspace";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";
import { displayDirentName } from "@/lib/ps2/ps2-sjis";
import { Ps2CardFormats, Ps2SingleSaveTypes } from "@/lib/ps2/ps2-types";

import { CardContentHeader } from "./card-content-header";
import { ps2CardActions, ps2SnapshotCompareBytes } from "./ps2-card-actions";
import {
  PS2_CARD_FORMATS,
  PS2_EXPORT_CONTAINER_FORMAT,
  PS2_SINGLE_SAVE_FORMATS,
} from "./save-formats";
import type { FamilyToolbarCaps, FamilyToolbarHandlers } from "./types";
import { useFamilyToolbarPublish } from "./use-family-toolbar-publish";

interface Ps2CardPaneProps {
  card: PS2MemoryCard;
  view: Ps2CardView;
  cardId: number;
  cardName: string;
  cardType: MemoryCard["type"];
  cardSource: string;
  tempBuffer: TempBuffer;
  familyHandlersRef: RefObject<FamilyToolbarHandlers>;
  onFamilyCapsChange: (caps: FamilyToolbarCaps) => void;
  onTempBufferChange: (buffer: TempBuffer) => void;
  onCompare: (data: CompareSaveData) => void;
  commit: CardCommit;
  onError: (message: string | null) => void;
  bump: () => void;
}

export const Ps2CardPane: React.FC<Ps2CardPaneProps> = ({
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
  commit,
  onError,
  bump,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [selectedSave, setSelectedSave] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [pendingErase, setPendingErase] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isSingleOpen, setIsSingleOpen] = useState(false);
  const saves = view.saves;
  const ps2Buffer = tempBuffer?.kind === "ps2" ? tempBuffer : null;
  const selectedInfo =
    selectedSave !== null
      ? saves.find((s) => s.name === selectedSave)
      : undefined;
  const replaceName =
    tempBuffer?.kind === "ps2" ? tempBuffer.snapshot.name : "";

  const actions = ps2CardActions({
    card,
    saves,
    cardId,
    selectedSave,
    tempBuffer,
    commit,
    setPendingReplace,
    setSelectedSave,
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

  const handleSaveAction = (action: Ps2SaveAction, name: string) => {
    switch (action) {
      case "compare": {
        if (ps2Buffer) {
          const bytes = card.getSingleSaveBytes(name);
          const buffer = ps2SnapshotCompareBytes(ps2Buffer.snapshot);
          if (bytes !== null && buffer !== null) {
            onCompare({
              save1Name: name,
              save1Bytes: bytes,
              save2Name: ps2Buffer.snapshot.name,
              save2Bytes: buffer,
            });
          }
        }
        break;
      }
      case "erase":
        setPendingErase(name);
        break;
    }
  };

  const handleConfirmErase = () => {
    if (pendingErase === null) return;
    actions.eraseSave(pendingErase);
    setPendingErase(null);
  };

  const handleImportConfirm = async (
    name: string,
    title: string,
  ): Promise<boolean> => {
    if (importFile === null) return false;
    const ok = await actions.importFile(importFile, name, title);
    if (ok) setImportFile(null);
    return ok;
  };

  const handleSaveConfirm = (
    fileName: string,
    _saveType: Ps2CardFormats,
    ecc?: boolean,
  ) => {
    const success = card.saveMemoryCard(fileName, ecc);
    if (success) {
      onError(null);
      bump();
    } else {
      onError("Failed to save memory card");
    }
  };

  const handleExportConfirm = async (
    fileName: string,
    saveType: Ps2SingleSaveTypes,
  ) => {
    if (selectedSave === null) return;
    const format = PS2_EXPORT_CONTAINER_FORMAT[saveType];
    const success = format
      ? await card.saveSingleSaveContainer(fileName, selectedSave, format)
      : card.saveSingleSave(fileName, selectedSave);
    onError(success ? null : "Failed to export save");
  };

  return (
    <>
      <div className="flex min-h-0 grow flex-col bg-card/60">
        <CardContentHeader
          name={cardName}
          type={cardType}
          kind="ps2"
          source={cardSource}
          checksum={view.checksum}
          tempBuffer={tempBuffer}
          badBlocks={view.badBlocks}
        />
        <Ps2SaveList
          saves={saves}
          selectedSave={selectedSave}
          hasTempBuffer={ps2Buffer !== null}
          onSelectSave={(name) =>
            setSelectedSave(selectedSave === name ? null : name)
          }
          onSaveAction={handleSaveAction}
        />
      </div>
      {selectedInfo && (
        <Ps2SaveInfoSidebar
          key={`${cardId}:${selectedInfo.name}`}
          save={selectedInfo}
          onClose={() => setSelectedSave(null)}
        />
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".sdt,.dat,.psu,.max,.sps,.xps,.cbs,.psv,.npo"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setImportFile(file);
          setIsImportDialogOpen(true);
        }}
      />
      <SaveDialog
        key={`${isSaveOpen ? "open" : "closed"}-${view.ecc ? "ecc" : "noecc"}`}
        isOpen={isSaveOpen}
        onOpenChange={setIsSaveOpen}
        defaultFileName={cardName}
        formats={PS2_CARD_FORMATS}
        defaultFormat={Ps2CardFormats.Raw}
        ecc={{ default: view.ecc }}
        onSave={handleSaveConfirm}
      />
      <SaveSingleSaveDialog
        key={selectedSave ?? "no-save"}
        isOpen={isSingleOpen}
        onOpenChange={setIsSingleOpen}
        defaultFileName={selectedSave ?? "save"}
        formats={PS2_SINGLE_SAVE_FORMATS}
        defaultFormat={Ps2SingleSaveTypes.Sdt}
        onSave={handleExportConfirm}
      />
      <Ps2ImportSaveDialog
        key={importFile?.name ?? "no-file"}
        isOpen={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        defaultName={importFile?.name.replace(/\.[^.]+$/, "") ?? ""}
        takenNames={saves.map((s) => s.name)}
        onImport={(name, title) => handleImportConfirm(name, title)}
      />
      <AlertDialog
        open={pendingErase !== null}
        onOpenChange={(open) => {
          if (!open) setPendingErase(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete save</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently erase “
              {pendingErase ? displayDirentName(pendingErase) : ""}” and its
              files. You can undo this action from the toolbar.
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
      <AlertDialog
        open={pendingReplace}
        onOpenChange={(open) => {
          if (!open) setPendingReplace(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace save?</AlertDialogTitle>
            <AlertDialogDescription>
              A save named “{replaceName}” already exists in this card.
              Replacing it deletes the existing save first; you can undo this
              from the toolbar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={actions.confirmReplace}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
