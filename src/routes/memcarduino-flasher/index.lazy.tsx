import { createLazyFileRoute } from "@tanstack/react-router";

import { MemcarduinoFlasher } from "@/components/memcarduino-flasher";

export const Route = createLazyFileRoute("/memcarduino-flasher/")({
  component: MemcarduinoFlasher,
});
