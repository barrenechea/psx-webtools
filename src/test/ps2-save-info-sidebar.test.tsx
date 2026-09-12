import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { Ps2SaveInfoSidebar } from "@/components/memory-card/ps2-save-info-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Ps2SaveInfo } from "@/lib/ps2/ps2-types";

function save(overrides: Partial<Ps2SaveInfo> = {}): Ps2SaveInfo {
  return {
    name: "SAVE-AAA0001",
    title: "Recover Me",
    iconType: 0,
    created: { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2001 },
    modified: { sec: 0, min: 0, hour: 0, day: 1, month: 1, year: 2001 },
    entryCount: 4,
    dataCluster: 0,
    hidden: false,
    ps1: false,
    pocketStation: false,
    totalSize: 100,
    files: [{ name: "SAVE-AAA0001", size: 100 }],
    background: [],
    backgroundTransparency: 0,
    viewIcon: "",
    iconModel: null,
    iconLighting: null,
    deleted: false,
    corrupted: false,
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

describe("Ps2SaveInfoSidebar", () => {
  it("drops the recoverable-deleted note when the save prop is restored", () => {
    const { rerender } = render(
      <Ps2SaveInfoSidebar save={save({ deleted: true })} onClose={() => {}} />,
      { wrapper },
    );
    expect(
      screen.getByText("This save has been deleted but can be recovered."),
    ).toBeInTheDocument();

    rerender(
      <Ps2SaveInfoSidebar save={save({ deleted: false })} onClose={() => {}} />,
    );
    expect(
      screen.queryByText("This save has been deleted but can be recovered."),
    ).not.toBeInTheDocument();
  });
});
