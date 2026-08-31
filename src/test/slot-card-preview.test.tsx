import { render, screen } from "@testing-library/react";

import { SlotCardPreview } from "@/components/memory-card/slot-card-preview";

describe("SlotCardPreview", () => {
  it("renders nothing when no card is classified", () => {
    render(<SlotCardPreview kind={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["ps1", "PS1 Card Detected", /item_tex_ps1mc\.png$/],
    ["ps2", "PS2 Card Detected", /item_tex_ps2mc\.png$/],
    ["pocketstation", "PocketStation Detected", /item_tex_pocketstation\.png$/],
  ] as const)("shows the %s insert overlay", (kind, label, src) => {
    render(<SlotCardPreview kind={kind} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(label);
    expect(status.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringMatching(src),
    );
  });
});
