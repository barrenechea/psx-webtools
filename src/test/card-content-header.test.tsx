import { render, screen } from "@testing-library/react";

import { CardContentHeader } from "@/components/memory-card/card-content-header";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderHeader(badBlocks: number[]) {
  return render(
    <TooltipProvider>
      <CardContentHeader
        name="Card"
        type="device"
        kind="ps2"
        source="PS3 MCA"
        checksum="DEADBEEF"
        tempBuffer={null}
        badBlocks={badBlocks}
      />
    </TooltipProvider>,
  );
}

describe("CardContentHeader bad blocks", () => {
  it("badges a non-empty PS2 bad-block list", () => {
    renderHeader([800, 816]);
    expect(screen.getByText("2 bad blocks")).toBeInTheDocument();
  });

  it("hides the badge when the list is empty", () => {
    renderHeader([]);
    expect(screen.queryByText(/bad block/)).not.toBeInTheDocument();
  });
});
