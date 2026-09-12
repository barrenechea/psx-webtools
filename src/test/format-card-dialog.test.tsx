import { fireEvent, render, screen } from "@testing-library/react";

import { FormatCardDialog } from "@/components/memory-card/format-card-dialog";
import type { FormatChoice } from "@/lib/ps1/hardware/core";

function renderDialog(
  cardKind: "ps1" | "ps2",
  onFormat: (choice: FormatChoice) => void = () => {},
) {
  return render(
    <FormatCardDialog
      isOpen
      onOpenChange={() => {}}
      deviceName="PS3 MCA"
      cardKind={cardKind}
      onFormat={onFormat}
    />,
  );
}

describe("FormatCardDialog", () => {
  it("describes a PS2 erase with no format-type options", () => {
    renderDialog("ps2");
    expect(screen.queryByText("Format type")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick format")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Erase the PS2 card and rebuild its filesystem/),
    ).toBeInTheDocument();
  });

  it("keeps the PS1 quick/full choice", () => {
    renderDialog("ps1");
    expect(screen.getByText("Format type")).toBeInTheDocument();
    expect(screen.getByText("Quick format")).toBeInTheDocument();
  });

  it("confirms a PS2 format without a quick flag", () => {
    const onFormat = vi.fn();
    renderDialog("ps2", onFormat);
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(onFormat).toHaveBeenCalledWith({ kind: "ps2" });
  });

  it("confirms a PS1 format with the selected quick choice", () => {
    const onFormat = vi.fn();
    renderDialog("ps1", onFormat);
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(onFormat).toHaveBeenCalledWith({ kind: "ps1", quick: true });
  });
});
