import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CardSidebar } from "@/components/memory-card/card-sidebar";

const noop = () => undefined;

function renderSidebar(opts: {
  connectedDevice?: string | null;
  canPocketStation?: boolean;
  isConnected?: boolean;
}) {
  return render(
    <CardSidebar
      cards={[]}
      selectedCard={null}
      onSelectCard={noop}
      onNewCard={noop}
      onNewPs2Card={noop}
      onCloseCard={noop}
      fileInputRef={{ current: null }}
      onFileChange={noop}
      onOpenFile={noop}
      onConnectDexDrive={noop}
      onConnectMemcarduino={noop}
      onConnectPS1CardLink={noop}
      onConnectPS3MCA={noop}
      onConnectUnirom={noop}
      onPocketStation={noop}
      fixCorrupted={false}
      onFixCorruptedChange={noop}
      isConnected={opts.isConnected ?? true}
      connectedDevice={opts.connectedDevice ?? "PS3 MC Adaptor"}
      canPocketStation={opts.canPocketStation ?? false}
      onDisconnect={noop}
      onRead={noop}
      onWrite={noop}
      onFormat={noop}
    />,
  );
}

describe("CardSidebar PocketStation", () => {
  it("does not key PocketStation off the display name", () => {
    renderSidebar({
      connectedDevice: "PS3 MC Adaptor",
      canPocketStation: false,
    });
    expect(
      screen.queryByRole("button", { name: "PocketStation" }),
    ).not.toBeInTheDocument();
  });

  it("shows PocketStation from the session capability bit", () => {
    renderSidebar({
      connectedDevice: "Some Adaptor",
      canPocketStation: true,
    });
    expect(
      screen.getByRole("button", { name: "PocketStation" }),
    ).toBeInTheDocument();
  });
});

describe("CardSidebar Connect", () => {
  it("disables Connect a device while a session is live", async () => {
    const user = userEvent.setup();
    renderSidebar({ isConnected: true });
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(
      screen.getByRole("menuitem", { name: /connect a device/i }),
    ).toHaveAttribute("data-disabled");
  });

  it("enables Connect a device when no session is live", async () => {
    const user = userEvent.setup();
    renderSidebar({ isConnected: false, connectedDevice: null });
    await user.click(screen.getByRole("button", { name: /open/i }));
    expect(
      screen.getByRole("menuitem", { name: /connect a device/i }),
    ).not.toHaveAttribute("data-disabled");
  });
});
