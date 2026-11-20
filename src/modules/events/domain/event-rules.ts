import { z } from "zod";
import type { EventStatus } from "@/generated/prisma/enums";

export const EVENT_ACCENTS = {
  "safety-amber": { label: "Safety amber", hex: "#F2A900", onFill: "#1A1408", onDark: "#F2A900" },
  "signal-orange": { label: "Signal orange", hex: "#E8661C", onFill: "#1A0E06", onDark: "#F08A4B" },
  "rebar-red": { label: "Rebar red", hex: "#B83A2E", onFill: "#FFFFFF", onDark: "#E5766B" },
  "blueprint-blue": { label: "Blueprint blue", hex: "#2F6DB5", onFill: "#FFFFFF", onDark: "#7FAEE6" },
  "survey-green": { label: "Survey green", hex: "#2F7A40", onFill: "#FFFFFF", onDark: "#7CC48B" },
  "patina-teal": { label: "Patina teal", hex: "#1F7676", onFill: "#FFFFFF", onDark: "#6FC6C6" },
} as const;

export type EventAccent = keyof typeof EVENT_ACCENTS;

export const PUBLIC_EVENT_STATUSES: readonly EventStatus[] = ["PUBLISHED", "LIVE", "CLOSED"];

export const EVENT_STATUS_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "LIVE", "CLOSED"],
  LIVE: ["CLOSED"],
  CLOSED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  LIVE: "Live",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

export const MANILA_OFFSET = "+08:00";

export function toManilaInputValue(date: Date | null): string {
  if (!date) return "";
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return EVENT_STATUS_TRANSITIONS[from].includes(to);
}

export function isPublicStatus(status: EventStatus): boolean {
  return PUBLIC_EVENT_STATUSES.includes(status);
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "event";
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const eventInputSchema = z.object({
  name: z.string().trim().min(3, "Use at least 3 characters.").max(120, "Use at most 120 characters."),
  description: optionalText(2000),
  venue: optionalText(160),
  welcomeMessage: optionalText(280),
  accent: z.enum(Object.keys(EVENT_ACCENTS) as [EventAccent, ...EventAccent[]], { message: "Pick one of the PCASCADE accent colours." }),
  startsAt: z
    .string()
    .trim()
    .optional()
    .transform((value, context) => {
      if (!value) return null;
      const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? new Date(`${value}:00${MANILA_OFFSET}`) : new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        context.addIssue({ code: "custom", message: "Enter a valid date and time." });
        return z.NEVER;
      }
      return parsed;
    }),
});

export type EventInput = z.infer<typeof eventInputSchema>;
