import { act, render, screen } from "@testing-library/react";

import { Ps2CardPane } from "@/components/memory-card/ps2-card-pane";
import {
  EMPTY_FAMILY_CAPS,
  NOOP_FAMILY_HANDLERS,
} from "@/components/memory-card/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";

describe("Ps2CardPane", () => {
  it("unmounts local save dialogs and resets the toolbar bridge", async () => {
    const onFamilyCapsChange = vi.fn();
    const familyHandlersRef = { current: NOOP_FAMILY_HANDLERS };
    const { unmount } = render(
      <TooltipProvider>
        <Ps2CardPane
          card={PS2MemoryCard.format(8192)}
          cardId={1}
          cardName="Card"
          cardType="new"
          cardSource=""
          tempBuffer={null}
          familyHandlersRef={familyHandlersRef}
          onFamilyCapsChange={onFamilyCapsChange}
          onTempBufferChange={() => undefined}
          onCompare={() => undefined}
          commit={() => true}
          onError={() => undefined}
          bump={() => undefined}
        />
      </TooltipProvider>,
    );
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
