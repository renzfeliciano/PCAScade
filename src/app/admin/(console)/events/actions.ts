"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EventStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { eventInputSchema } from "@/modules/events/domain/event-rules";
import { EventError, changeEventStatus, createEvent, updateEvent, updatePublicDisplay } from "@/modules/events/server/events";
import { purgeCdnCache } from "@/modules/media/server/cdn-cache";
import { COUNTDOWN_LIMITS, participantDisplaySchema } from "@/modules/presentation/domain/display";

export type EventFormValues = {
  name: string;
  description: string;
  venue: string;
  welcomeMessage: string;
  accent: string;
  startsAt: string;
};

export type EventFormState = { fieldErrors?: Record<string, string[]>; formError?: string; saved?: boolean; values?: EventFormValues };

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.slice(0, 4000) : "";
}

function readEventForm(formData: FormData) {
  const values: EventFormValues = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    venue: text(formData, "venue"),
    welcomeMessage: text(formData, "welcomeMessage"),
    accent: text(formData, "accent"),
    startsAt: text(formData, "startsAt"),
  };
  return { values, parsed: eventInputSchema.safeParse(values) };
}

const eventIdSchema = z.uuid();

export async function createEventAction(_previous: EventFormState, formData: FormData): Promise<EventFormState> {
  await requireAdmin();
  const { values, parsed } = readEventForm(formData);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  const event = await createEvent(db(), parsed.data);
  revalidatePath("/admin/events");
  redirect(`/admin/events/${event.id}`);
}

export async function updateEventAction(eventId: string, _previous: EventFormState, formData: FormData): Promise<EventFormState> {
  await requireAdmin();
  if (!eventIdSchema.safeParse(eventId).success) return { formError: "This event no longer exists." };
  const { values, parsed } = readEventForm(formData);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  try {
    await updateEvent(db(), eventId, parsed.data);
  } catch (error) {
    if (error instanceof EventError) return { formError: "This event no longer exists.", values };
    throw error;
  }
  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId}`);
  return { saved: true, values };
}

export type StatusFormState = { error?: string };

export async function changeEventStatusAction(_previous: StatusFormState, formData: FormData): Promise<StatusFormState> {
  await requireAdmin();
  const eventId = eventIdSchema.safeParse(formData.get("eventId"));
  const to = z.enum(EventStatus).safeParse(formData.get("to"));
  if (!eventId.success || !to.success) return { error: "That status change is not valid." };
  try {
    await changeEventStatus(db(), eventId.data, to.data, purgeCdnCache);
  } catch (error) {
    if (error instanceof EventError) {
      return { error: error.code === "INVALID_TRANSITION" ? "The event status changed in the meantime. Reload and try again." : "This event no longer exists." };
    }
    throw error;
  }
  revalidatePath("/admin/events");
  revalidatePath(`/admin/events/${eventId.data}`);
  return {};
}

export type DisplayFormState = { error?: string; message?: string };

const countdownSchema = z.coerce.number().int().min(COUNTDOWN_LIMITS.min).max(COUNTDOWN_LIMITS.max);

export async function updateDisplayAction(eventId: string, _previous: DisplayFormState, formData: FormData): Promise<DisplayFormState> {
  await requireAdmin();
  if (!z.uuid().safeParse(eventId).success) return { error: "This event no longer exists." };
  const countdown = countdownSchema.safeParse(formData.get("countdownSeconds"));
  if (!countdown.success) return { error: `Use a countdown between ${COUNTDOWN_LIMITS.min} and ${COUNTDOWN_LIMITS.max} seconds.` };
  const display = participantDisplaySchema.parse({
    department: formData.get("department") === "on",
    jobTitle: formData.get("jobTitle") === "on",
    bio: formData.get("bio") === "on",
    photo: formData.get("photo") === "on",
  });
  try {
    await updatePublicDisplay(db(), eventId, display, { countdownSeconds: countdown.data }, purgeCdnCache);
  } catch (error) {
    if (error instanceof EventError) return { error: "This event no longer exists." };
    throw error;
  }
  revalidatePath(`/admin/events/${eventId}`);
  return { message: "Saved. The presentation and public pages use these settings from now on." };
}
