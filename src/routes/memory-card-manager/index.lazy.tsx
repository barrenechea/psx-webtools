import { createLazyFileRoute } from "@tanstack/react-router";

import { MemoryCardManager } from "@/components/memory-card/memory-card-manager";

export const Route = createLazyFileRoute("/memory-card-manager/")({
  component: MemoryCardManager,
});
