import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryCardManager } from "@/components/memory-card/memory-card-manager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoadingDialogProvider } from "@/contexts/loading-dialog-context";
import { PS2MemoryCard } from "@/lib/ps2/ps2-card";

import {
  TOTAL_CARD_SIZE,
  makeSavePayload,
  newCard,
  toFile,
} from "./psx-helpers";

function renderManager() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LoadingDialogProvider>
          <MemoryCardManager />
        </LoadingDialogProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function openFromMenu(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /open/i }));
  await user.click(await screen.findByRole("menuitem", { name: label }));
  return user;
}

async function openCardFile(file: File) {
  const user = userEvent.setup();
  const input = document.querySelector(
    "input[type='file'][multiple]",
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  await user.upload(input!, file);
  return user;
}

function ps1CardFile() {
  const card = newCard();
  card.setSaveBytes(0, makeSavePayload(1));
  return toFile(card.getRawData(0, TOTAL_CARD_SIZE), "card.mcd");
}

function ps2CardFile() {
  const card = PS2MemoryCard.format(8192);
  card.importSingleSave("SAVE-AAA0001", new Uint8Array([1, 2, 3]), {
    title: "Recover Me",
  });
  return toFile(card.getRawData(), "card.ps2");
}

describe("MemoryCardManager", () => {
  it("starts empty, then New PS1 card shows 15 slots and a PS1 badge", async () => {
    renderManager();
    expect(
      screen.getAllByText("No memory card selected").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Save memory card" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "History" })).toBeDisabled();

    await openFromMenu("New PS1 card");

    expect(screen.getAllByText("New Card").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PS1").length).toBeGreaterThan(0);
    expect(screen.getByText("15 slots")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save memory card" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "History" })).toBeEnabled();
    expect(document.querySelectorAll("[data-slot-index]")).toHaveLength(15);
  });

  it("selectCard clears family selection when switching to a PS2 card", async () => {
    renderManager();
    await openFromMenu("New PS1 card");
    expect(screen.getByText("15 slots")).toBeInTheDocument();

    await openFromMenu("New PS2 card");
    await userEvent.click(
      await screen.findByRole("button", { name: "Create" }),
    );
    expect(screen.getByText("0 saves")).toBeInTheDocument();
    expect(screen.queryByText("15 slots")).not.toBeInTheDocument();
    expect(document.querySelector("[data-slot-index]")).toBeNull();
  });

  it("New PS2 card uses the size dialog and shows a PS2 badge", async () => {
    renderManager();
    await openFromMenu("New PS2 card");
    expect(
      await screen.findByRole("heading", { name: "New PS2 Memory Card" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getAllByText("New PS2 Card").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PS2").length).toBeGreaterThan(0);
    expect(screen.getByText("0 saves")).toBeInTheDocument();
  });

  it("save dialog is titled Save memory card", async () => {
    renderManager();
    await openFromMenu("New PS1 card");
    await userEvent.click(
      screen.getByRole("button", { name: "Save memory card" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Save memory card")).toBeInTheDocument();
    expect(
      within(dialog).queryByText("Save Game Data"),
    ).not.toBeInTheDocument();
  });

  it("switching PS1 cards remounts the pane and closes game details", async () => {
    renderManager();
    await openFromMenu("New PS1 card");
    await userEvent.click(document.querySelector("[data-slot-index='0']")!);
    expect(screen.getByText("Empty Slot Selected")).toBeInTheDocument();
    expect(screen.getByText("Game Details")).toBeInTheDocument();

    await openFromMenu("New PS1 card");
    expect(screen.queryByText("Empty Slot Selected")).not.toBeInTheDocument();
    expect(screen.queryByText("Game Details")).not.toBeInTheDocument();
  });

  it("PS2 save dialog is titled Save memory card", async () => {
    renderManager();
    await openFromMenu("New PS2 card");
    await userEvent.click(
      await screen.findByRole("button", { name: "Create" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save memory card" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Save memory card")).toBeInTheDocument();
  });

  it("deleting a PS1 save shows the Deleted badge on the slot", async () => {
    renderManager();
    await openCardFile(ps1CardFile());
    expect(await screen.findByText("Hiro")).toBeInTheDocument();
    await userEvent.click(document.querySelector("[data-slot-index='0']")!);
    await userEvent.click(screen.getByRole("button", { name: "Delete save" }));
    expect(await screen.findByText("Deleted")).toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore save" })).toBeEnabled();
  });

  it("deleting a PS2 save badges the row and shows recoverable in the sidebar", async () => {
    renderManager();
    await openCardFile(ps2CardFile());
    const title = await screen.findByText("Recover Me");
    await userEvent.click(title);
    expect(
      screen.queryByText("This save has been deleted but can be recovered."),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete save" }));
    expect(await screen.findByText("Deleted")).toBeInTheDocument();
    expect(
      screen.getByText("This save has been deleted but can be recovered."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore save" })).toBeEnabled();
  });
});
