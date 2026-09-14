import { renderHook } from "@testing-library/react";

import { snapshotMemoryCard } from "@/hooks/memory-card-view";
import { useMemoryCardDeviceOps } from "@/hooks/use-memory-card-device-ops";

import { wrapper } from "./device-manager-harness";
import { makeSavePayload, newCard } from "./psx-helpers";

describe("useMemoryCardDeviceOps write checksum", () => {
  it("follows a refreshed view after an in-place edit", () => {
    const card = newCard();
    card.setSaveBytes(0, makeSavePayload(1));
    const makeEntry = () => ({
      id: 1,
      name: "Card" as const,
      type: "new" as const,
      source: "",
      card,
      view: snapshotMemoryCard(card),
    });
    const { result, rerender } = renderHook(
      ({ selectedEntry }) =>
        useMemoryCardDeviceOps({
          addCard: () => 1,
          selectCard: () => undefined,
          selectedEntry,
          fixCorrupted: false,
          setError: () => undefined,
        }),
      { wrapper, initialProps: { selectedEntry: makeEntry() } },
    );
    const before = result.current.dialogs.writeChecksum;
    expect(before.length).toBe(8);
    card.toggleDeleteSave(0);
    rerender({ selectedEntry: makeEntry() });
    expect(result.current.dialogs.writeChecksum).not.toBe(before);
  });
});
