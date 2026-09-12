import type { Ps2DateTime } from "@/lib/ps2/ps2-types";

const pad = (n: number) => n.toString().padStart(2, "0");

export function formatPs2SlotLabel(index: number): string {
  return pad(index + 1);
}

export function formatPs2Date(t: Ps2DateTime, withSeconds = false): string {
  const date = `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.min)}`;
  return withSeconds ? `${date}:${pad(t.sec)}` : date;
}

export function formatPs2Size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}
