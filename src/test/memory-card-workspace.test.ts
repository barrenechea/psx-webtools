import { act, renderHook } from "@testing-library/react";

import {
  isPs2Card,
  useMemoryCardWorkspace,
} from "@/hooks/use-memory-card-workspace";
import { SlotTypes } from "@/lib/ps1-memory-card";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";

import { makeSavePayload, newCard } from "./psx-helpers";

describe("useMemoryCardWorkspace", () => {
  it("does not expose extra history doors or family selection", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    expect(result.current).not.toHaveProperty("commitSteps");
    expect(result.current).not.toHaveProperty("appendHistoryLabel");
    expect(result.current).not.toHaveProperty("sidebarOpen");
    expect(result.current).not.toHaveProperty("selectedSlot");
    expect(result.current).not.toHaveProperty("selectedPs2Save");
    expect(result.current).not.toHaveProperty("ps1Card");
    expect(result.current).not.toHaveProperty("ps2Card");
    expect(result.current).toHaveProperty("commitAsync");
    expect(result.current).toHaveProperty("addNewPs1Card");
    expect(result.current).toHaveProperty("addNewPs2Card");
    expect(result.current).not.toHaveProperty("cardStatus");
    expect(result.current).not.toHaveProperty("afterMutate");
    expect(result.current).not.toHaveProperty("recordCommit");
  });

  it("does not leave card-list types on the toolbar types module", async () => {
    const toolbarTypes = await import("@/components/memory-card/types");
    expect(toolbarTypes).not.toHaveProperty("isPs2Card");
    expect(toolbarTypes).toHaveProperty("EMPTY_FAMILY_CAPS");
  });

  it("commit records a history label and bump", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    let id = 0;
    act(() => {
      id = result.current.addCard({
        name: "Card",
        type: "new",
        source: "",
        card,
      });
      result.current.selectCard(id);
      result.current.commit(id, "Save deleted", () => {
        card.toggleDeleteSave(0);
      });
    });
    expect(result.current.historyLabels[id]).toEqual(["Card", "Save deleted"]);
    expect(result.current.selectedEntry!.view.changed).toBe(true);
    const opened = result.current.selectedEntry?.card;
    expect(
      opened && !isPs2Card(opened) ? opened.getSaves()[0].slotType : undefined,
    ).toBe(SlotTypes.DeletedInitial);
  });

  it("commit records multiple labels from one mutate", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const card = PS2MemoryCard.format(8192);
    card.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
      title: "T",
    });
    const replacement = PS2MemoryCard.format(8192);
    replacement.importSingleSave("SAVE-AAA0001", new Uint8Array([4, 5, 6]), {
      title: "U",
    });
    const snapshot = replacement.snapshotSave("SAVE-AAA0001");
    expect(snapshot).not.toBeNull();
    let id = 0;
    act(() => {
      id = result.current.addCard({
        name: "Card",
        type: "new",
        source: "",
        card,
      });
      result.current.commit(
        id,
        ["Removed SAVE-AAA0001", "Pasted SAVE-AAA0001"],
        () => card.replaceSave(snapshot!),
      );
    });
    expect(result.current.historyLabels[id]).toEqual([
      "Card",
      "Removed SAVE-AAA0001",
      "Pasted SAVE-AAA0001",
    ]);
  });

  it("commit skips history when mutate returns false", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const card = newCard();
    let id = 0;
    act(() => {
      id = result.current.addCard({
        name: "Card",
        type: "new",
        source: "",
        card,
      });
      expect(result.current.commit(id, "nope", () => false)).toBe(false);
    });
    expect(result.current.historyLabels[id]).toBeUndefined();
  });

  it("commitAsync records from the pre-mutate undo row", async () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const card = newCard();
    let id = 0;
    act(() => {
      id = result.current.addCard({
        name: "Card",
        type: "new",
        source: "",
        card,
      });
    });
    await act(async () => {
      const ok = await result.current.commitAsync(
        id,
        "Save imported",
        async () => {
          await Promise.resolve();
          return card.setSaveBytes(0, makeSavePayload(1));
        },
      );
      expect(ok).toBe(true);
    });
    expect(result.current.historyLabels[id]).toEqual(["Card", "Save imported"]);
    const opened = result.current.memoryCards.find((c) => c.id === id)?.card;
    expect(
      opened && !isPs2Card(opened) ? opened.getSaves()[0].slotType : undefined,
    ).toBe(SlotTypes.Initial);
  });

  it("commitAsync skips history when mutate returns false", async () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const card = newCard();
    let id = 0;
    act(() => {
      id = result.current.addCard({
        name: "Card",
        type: "new",
        source: "",
        card,
      });
    });
    await act(async () => {
      expect(
        await result.current.commitAsync(id, "Save imported", () =>
          Promise.resolve(false),
        ),
      ).toBe(false);
    });
    expect(result.current.historyLabels[id]).toBeUndefined();
  });

  it("openFiles selects the last opened card", async () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const bytes = PS2MemoryCard.format(8192).getRawData();
    const file = new File([new Uint8Array(bytes)], "card.ps2");
    await act(async () => {
      await result.current.openFiles([file], false);
    });
    expect(result.current.memoryCards).toHaveLength(1);
    expect(result.current.selectedCard).toBe(result.current.memoryCards[0].id);
  });

  it("reports empty status until a card is selected", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    expect(result.current.selectedStatus).toBe("No memory card selected");
  });

  it("formats a new PS1 card and reports 15 slots", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    act(() => {
      result.current.addNewPs1Card();
    });
    expect(result.current.memoryCards).toHaveLength(1);
    expect(result.current.selectedEntry?.name).toBe("New Card");
    expect(isPs2Card(result.current.selectedEntry!.card)).toBe(false);
    expect(result.current.selectedStatus).toBe("15 slots");
  });

  it("formats a new PS2 card and reports save count", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    act(() => {
      result.current.addNewPs2Card(8);
    });
    expect(result.current.selectedEntry?.name).toBe("New PS2 Card");
    expect(isPs2Card(result.current.selectedEntry!.card)).toBe(true);
    expect(result.current.selectedEntry!.card.getSaves()).toEqual([]);
    expect(result.current.selectedStatus).toBe("0 saves");
  });

  it("PS2 save-count status follows a commit", () => {
    const { result } = renderHook(() => useMemoryCardWorkspace());
    const card = PS2MemoryCard.format(8192);
    let id = 0;
    act(() => {
      id = result.current.addCard({
        name: "Card",
        type: "new",
        source: "",
        card,
      });
      result.current.selectCard(id);
    });
    expect(result.current.selectedStatus).toBe("0 saves");
    act(() => {
      result.current.commit(id, "Imported save", () => {
        card.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
          title: "T",
        });
      });
    });
    expect(result.current.selectedStatus).toBe("1 save");
    expect(result.current.selectedEntry!.view.kind).toBe("ps2");
    if (result.current.selectedEntry!.view.kind === "ps2") {
      expect(result.current.selectedEntry!.view.saves).toHaveLength(1);
    }
  });
});
