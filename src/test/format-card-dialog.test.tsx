import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

async function selectFullFormat(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Full format" }));
}

describe("FormatCardDialog", () => {
  it("defaults PS2 to quick format and explains the PS3 Utility path", () => {
    renderDialog("ps2");
    expect(screen.getByText("Format type")).toBeInTheDocument();
    expect(screen.getByText("Quick format")).toBeInTheDocument();
    expect(
      screen.getByText(/how the PS3 Memory Card Utility formats a card/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/erasing every usable block first/),
    ).not.toBeInTheDocument();
  });

  it("explains PS2 full format when Full is selected", async () => {
    renderDialog("ps2");
    await selectFullFormat();
    expect(
      screen.getByText(/erasing every usable block first/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/how the PS3 Memory Card Utility formats a card/),
    ).not.toBeInTheDocument();
  });

  it("defaults PS1 to quick format copy", () => {
    renderDialog("ps1");
    expect(screen.getByText("Format type")).toBeInTheDocument();
    expect(screen.getByText("Quick format")).toBeInTheDocument();
    expect(
      screen.getByText(/Quick rewrites the card header for a fast reset/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not only the header/)).not.toBeInTheDocument();
  });

  it("explains PS1 full format when Full is selected", async () => {
    renderDialog("ps1");
    await selectFullFormat();
    expect(
      screen.getByText(
        /Full rewrites every block on the card, not only the header/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Quick rewrites the card header for a fast reset/),
    ).not.toBeInTheDocument();
  });

  it("confirms a PS2 format as quick by default", () => {
    const onFormat = vi.fn();
    renderDialog("ps2", onFormat);
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(onFormat).toHaveBeenCalledWith({ kind: "ps2", quick: true });
  });

  it("confirms a PS1 format with the selected quick choice", () => {
    const onFormat = vi.fn();
    renderDialog("ps1", onFormat);
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    expect(onFormat).toHaveBeenCalledWith({ kind: "ps1", quick: true });
  });
});
