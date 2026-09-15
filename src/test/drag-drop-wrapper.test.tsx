import { fireEvent, render, screen } from "@testing-library/react";

import { DragDropWrapper } from "@/components/drag-drop-wrapper";

const cardFile = () => new File([new Uint8Array([1, 2, 3])], "card.mcr");

function dropData(files: File[]) {
  return {
    dataTransfer: {
      files,
      dropEffect: "copy",
    },
  };
}

describe("DragDropWrapper", () => {
  it("shows a non-interactive overlay and drops through to children", () => {
    const onFileDrop = vi.fn();
    const onChildDrop = vi.fn((event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    render(
      <DragDropWrapper onFileDrop={onFileDrop}>
        <div data-testid="child" onDrop={onChildDrop} />
      </DragDropWrapper>,
    );

    const child = screen.getByTestId("child");
    fireEvent.dragEnter(child, dropData([cardFile()]));
    const overlay = screen.getByText("Drop your memory card files here")
      .parentElement?.parentElement;
    expect(overlay).toHaveClass("pointer-events-none");
    expect(overlay).toHaveClass("opacity-100");
    expect(screen.getByText(/\.ps2, \.mcd, \.sdt, \.psu/)).toBeInTheDocument();

    fireEvent.drop(child, dropData([cardFile()]));
    expect(onChildDrop).toHaveBeenCalledTimes(1);
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it("opens files when the drop lands on the wrapper", () => {
    const onFileDrop = vi.fn();
    const { container } = render(
      <DragDropWrapper onFileDrop={onFileDrop}>
        <div data-testid="child" />
      </DragDropWrapper>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    fireEvent.drop(wrapper!, dropData([cardFile()]));
    expect(onFileDrop).toHaveBeenCalledWith([
      expect.objectContaining({ name: "card.mcr" }),
    ]);
  });

  it("hides the overlay when a nested drop zone consumes the drop", () => {
    const onFileDrop = vi.fn();
    const onChildDrop = vi.fn((event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    render(
      <DragDropWrapper onFileDrop={onFileDrop}>
        <div data-testid="child" onDrop={onChildDrop} />
      </DragDropWrapper>,
    );

    const child = screen.getByTestId("child");
    fireEvent.dragEnter(child.parentElement!, dropData([cardFile()]));
    const overlay = screen.getByText("Drop your memory card files here")
      .parentElement?.parentElement;
    expect(overlay).toHaveClass("opacity-100");

    fireEvent.drop(child, dropData([cardFile()]));
    expect(onChildDrop).toHaveBeenCalledTimes(1);
    expect(onFileDrop).not.toHaveBeenCalled();
    expect(overlay).toHaveClass("opacity-0");
  });

  it("hides the overlay when the drag leaves the wrapper", () => {
    const { container } = render(
      <div>
        <div data-testid="outside" />
        <DragDropWrapper onFileDrop={() => undefined}>
          <div data-testid="child" />
        </DragDropWrapper>
      </div>,
    );
    const wrapper = container.querySelector(".relative");
    expect(wrapper).not.toBeNull();
    fireEvent.dragEnter(wrapper!, dropData([cardFile()]));
    expect(
      screen.getByText("Drop your memory card files here").parentElement
        ?.parentElement,
    ).toHaveClass("opacity-100");

    fireEvent.dragLeave(wrapper!, {
      relatedTarget: screen.getByTestId("outside"),
    });
    expect(
      screen.getByText("Drop your memory card files here").parentElement
        ?.parentElement,
    ).toHaveClass("opacity-0");
  });
});
