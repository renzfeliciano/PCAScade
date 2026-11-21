import { z } from "zod";

export const participantDisplaySchema = z.object({
  department: z.boolean().catch(true).default(true),
  jobTitle: z.boolean().catch(true).default(true),
  bio: z.boolean().catch(false).default(false),
  photo: z.boolean().catch(true).default(true),
});

export type ParticipantDisplay = z.infer<typeof participantDisplaySchema>;

export const DISPLAY_FIELDS: { key: keyof ParticipantDisplay; label: string; hint: string }[] = [
  { key: "department", label: "Department", hint: "Shown under the winner's name." },
  { key: "jobTitle", label: "Job title", hint: "Shown under the winner's name." },
  { key: "photo", label: "Photo", hint: "Shown on the reveal, the winner wall and the winners page." },
  { key: "bio", label: "Short description", hint: "Shown on the reveal only." },
];

export function parseParticipantDisplay(value: unknown): ParticipantDisplay {
  const parsed = participantDisplaySchema.safeParse(value && typeof value === "object" ? value : {});
  return parsed.success ? parsed.data : participantDisplaySchema.parse({});
}

export const COUNTDOWN_LIMITS = { min: 0, max: 30 } as const;

export const presentationSettingsSchema = z.object({
  countdownSeconds: z.number().int().min(COUNTDOWN_LIMITS.min).max(COUNTDOWN_LIMITS.max).catch(5).default(5),
});

export type PresentationSettings = z.infer<typeof presentationSettingsSchema>;

export function parsePresentationSettings(value: unknown): PresentationSettings {
  const parsed = presentationSettingsSchema.safeParse(value && typeof value === "object" ? value : {});
  return parsed.success ? parsed.data : presentationSettingsSchema.parse({});
}

export type PublicPerson = {
  name: string;
  department: string | null;
  jobTitle: string | null;
  bio: string | null;
  photoUrl: string | null;
};

export type PersonRecord = {
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  bio: string | null;
  photoId: string | null;
};

export function mediaUrl(assetId: string | null): string | null {
  return assetId ? `/api/media/${assetId}` : null;
}

export function publicPerson(person: PersonRecord, display: ParticipantDisplay): PublicPerson {
  return {
    name: person.fullName,
    department: display.department ? person.department : null,
    jobTitle: display.jobTitle ? person.jobTitle : null,
    bio: display.bio ? person.bio : null,
    photoUrl: display.photo ? mediaUrl(person.photoId) : null,
  };
}
