import type { CSSProperties } from "react";
import { EVENT_ACCENTS, type EventAccent } from "@/modules/events/domain/event-rules";

function resolve(accent: string) {
  return accent in EVENT_ACCENTS ? EVENT_ACCENTS[accent as EventAccent] : EVENT_ACCENTS["safety-amber"];
}

export function accentHex(accent: string): string {
  return resolve(accent).hex;
}

export function accentStyle(accent: string): CSSProperties {
  const palette = resolve(accent);
  return {
    "--event-accent": palette.hex,
    "--event-accent-fg": palette.onFill,
    "--event-accent-ink": palette.onDark,
  } as CSSProperties;
}

const dateFormat = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

export function formatEventDate(date: Date | null): string | null {
  return date ? dateFormat.format(date) : null;
}
