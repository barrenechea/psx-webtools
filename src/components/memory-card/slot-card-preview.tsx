import { createPortal } from "react-dom";

import type { SlotCardKind } from "@/lib/ps1/hardware/core";

const SLOT_CARD_ART: Record<SlotCardKind, { file: string; label: string }> = {
  ps1: { file: "item_tex_ps1mc.png", label: "PS1 Card Detected" },
  ps2: { file: "item_tex_ps2mc.png", label: "PS2 Card Detected" },
  pocketstation: {
    file: "item_tex_pocketstation.png",
    label: "PocketStation Detected",
  },
};

interface SlotCardPreviewProps {
  kind: SlotCardKind | null;
}

// XMB insert: the adaptor slot is a dark stage. The card rises, holds, and
// recedes. CSS-only; `kind` as key replays the ceremony on a swap. Portaled
// to the document so the veil covers the full viewport.
export const SlotCardPreview: React.FC<SlotCardPreviewProps> = ({ kind }) => {
  if (!kind) return null;

  const art = SLOT_CARD_ART[kind];
  return createPortal(
    <div
      key={kind}
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-40"
    >
      <div className="animate-card-insert-veil motion-reduce:animate-card-insert-reduce absolute inset-0 bg-black/50 supports-backdrop-filter:backdrop-blur-xs" />
      <div className="animate-card-insert motion-reduce:animate-card-insert-reduce relative flex h-full flex-col items-center justify-center">
        <img
          src={`${import.meta.env.BASE_URL}ps2/${art.file}`}
          alt=""
          width={240}
          height={240}
          draggable={false}
          className="size-44 object-contain drop-shadow-lg"
        />
        <span className="text-muted-foreground mt-1 text-sm font-light">
          {art.label}
        </span>
      </div>
    </div>,
    document.body,
  );
};
