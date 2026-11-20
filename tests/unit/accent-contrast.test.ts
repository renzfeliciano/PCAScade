import { describe, expect, it } from "vitest";
import { EVENT_ACCENTS } from "@/modules/events/domain/event-rules";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const DARK_SURFACE = "#1E2227";

describe("event accent palette", () => {
  it.each(Object.entries(EVENT_ACCENTS))("%s keeps text readable (WCAG AA 4.5:1)", (_key, accent) => {
    expect(contrast(accent.onFill, accent.hex)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accent.onDark, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
});
