import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { Ps1CardPane } from "@/components/memory-card/ps1-card-pane";
import {
  EMPTY_FAMILY_CAPS,
  NOOP_FAMILY_HANDLERS,
} from "@/components/memory-card/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SlotTypes } from "@/lib/ps1-memory-card";

import { makeSavePayload, newCard } from "./psx-helpers";

const saveFile = () => new File([new Uint8Array([0x51, 0])], "save.mcs");

function dropData(files: File[]) {
  return {
    dataTransfer: {
      files,
      dropEffect: "copy",
    },
  };
}

function renderPane(options?: {
  occupied?: boolean;
  commitAsync?: () => Promise<boolean>;
}) {
  const card = newCard();
  if (options?.occupied) card.setSaveBytes(0, makeSavePayload(1));
  const commitAsync = options?.commitAsync
    ? vi.fn(options.commitAsync)
    : vi.fn(() => Promise.resolve(true));
  const onOpenFiles = vi.fn();
  const onError = vi.fn();
  const onFamilyCapsChange = vi.fn();
  const familyHandlersRef = { current: NOOP_FAMILY_HANDLERS };
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TooltipProvider>
        <Ps1CardPane
          card={card}
          cardId={1}
          cardName="Card"
          cardType="new"
          cardSource=""
          tempBuffer={null}
          familyHandlersRef={familyHandlersRef}
          onFamilyCapsChange={onFamilyCapsChange}
          onTempBufferChange={() => undefined}
          onCompare={() => undefined}
          onOpenFiles={onOpenFiles}
          onError={onError}
          commit={() => true}
          commitAsync={commitAsync}
          bump={() => undefined}
          fixCorrupted={false}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return {
    card,
    commitAsync,
    onOpenFiles,
    onError,
    onFamilyCapsChange,
    familyHandlersRef,
    unmount: view.unmount,
  };
}

describe("Ps1CardPane slot drop", () => {
  it("imports a single file onto the selected empty slot", async () => {
    const { commitAsync, onOpenFiles, onError } = renderPane();
    const slot = document.querySelector("[data-slot-index='0']");
    expect(slot).not.toBeNull();
    fireEvent.click(slot!);
    fireEvent.drop(slot!, dropData([saveFile()]));
    await waitFor(() => expect(commitAsync).toHaveBeenCalledTimes(1));
    expect(onOpenFiles).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects a drop onto a non-empty selected slot", () => {
    const { commitAsync, onOpenFiles, onError, card } = renderPane({
      occupied: true,
    });
    expect(card.getSaves()[0].slotType).toBe(SlotTypes.Initial);
    const slot = document.querySelector("[data-slot-index='0']")!;
    fireEvent.click(slot);
    fireEvent.drop(slot, dropData([saveFile()]));
    expect(onError).toHaveBeenCalledWith("The selected slot is not empty");
    expect(commitAsync).not.toHaveBeenCalled();
    expect(onOpenFiles).not.toHaveBeenCalled();
  });

  it("opens files when no slot is selected", () => {
    const { commitAsync, onOpenFiles } = renderPane();
    fireEvent.drop(
      document.querySelector("[data-slot-index='0']")!,
      dropData([saveFile()]),
    );
    expect(commitAsync).not.toHaveBeenCalled();
    expect(onOpenFiles).toHaveBeenCalledTimes(1);
  });

  it("opens files when import of a dropped save fails", async () => {
    const { onOpenFiles } = renderPane({
      commitAsync: () => Promise.resolve(false),
    });
    const slot = document.querySelector("[data-slot-index='0']")!;
    fireEvent.click(slot);
    fireEvent.drop(slot, dropData([saveFile()]));
    await waitFor(() => expect(onOpenFiles).toHaveBeenCalledTimes(1));
  });

  it("unmounts local save dialogs and resets the toolbar bridge", async () => {
    const { unmount, onFamilyCapsChange, familyHandlersRef } = renderPane();
    expect(familyHandlersRef.current).not.toBe(NOOP_FAMILY_HANDLERS);
    act(() => {
      familyHandlersRef.current.saveCard();
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    unmount();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onFamilyCapsChange).toHaveBeenCalledWith(EMPTY_FAMILY_CAPS);
    expect(familyHandlersRef.current).toBe(NOOP_FAMILY_HANDLERS);
  });
});
