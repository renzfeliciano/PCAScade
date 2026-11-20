"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { MediaError } from "@/modules/media/server/photo-store";
import { purgeCdnCache } from "@/modules/media/server/cdn-cache";
import { BUILTIN_PARTICIPANT_FIELDS } from "@/modules/participants/domain/fields";
import {
  ParticipantError,
  createParticipant,
  deleteParticipant,
  replaceParticipantPhoto,
  setParticipantStatus,
  updateParticipant,
} from "@/modules/participants/server/participants";
import { RosterLockedError } from "@/modules/raffle/server/roster-lock";

export type ParticipantFormState = { fieldErrors?: Record<string, string>; formError?: string; saved?: boolean; values?: Record<string, string | string[]> };

const ids = z.object({ eventId: z.uuid(), participantId: z.uuid().optional() });

function readForm(formData: FormData) {
  const builtin: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  const values: Record<string, string | string[]> = {};
  for (const field of BUILTIN_PARTICIPANT_FIELDS) {
    const value = field.key === "eligible" ? (formData.get("eligible") === "on" ? "yes" : "no") : String(formData.get(field.key) ?? "").slice(0, 2000);
    builtin[field.key] = value;
    values[field.key] = value;
  }
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("custom:") || typeof value !== "string") continue;
    const key = name.slice(7);
    const existing = custom[key];
    const next = value.slice(0, 1000);
    custom[key] = existing === undefined ? next : [...(Array.isArray(existing) ? existing : [existing]), next];
    values[name] = Array.isArray(custom[key]) ? (custom[key] as string[]) : next;
  }
  return { builtin, custom, values };
}

function failure(error: unknown, values: Record<string, string | string[]>): ParticipantFormState {
  if (error instanceof ParticipantError) {
    if (error.code === "NOT_FOUND") return { formError: "This participant no longer exists.", values };
    if (error.code === "HAS_WINS") return { formError: "This participant has a recorded win and cannot be deleted.", values };
    return { fieldErrors: error.fieldErrors, values };
  }
  if (error instanceof RosterLockedError) return { formError: error.message, values };
  throw error;
}

export async function createParticipantAction(eventId: string, _previous: ParticipantFormState, formData: FormData): Promise<ParticipantFormState> {
  await requireAdmin();
  if (!ids.safeParse({ eventId }).success) return { formError: "This event no longer exists." };
  const { builtin, custom, values } = readForm(formData);
  let participantId: string;
  try {
    participantId = (await createParticipant(db(), eventId, { builtin, custom })).id;
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(`/admin/events/${eventId}/participants`);
  redirect(`/admin/events/${eventId}/participants/${participantId}`);
}

export async function updateParticipantAction(eventId: string, participantId: string, _previous: ParticipantFormState, formData: FormData): Promise<ParticipantFormState> {
  await requireAdmin();
  if (!ids.safeParse({ eventId, participantId }).success) return { formError: "This participant no longer exists." };
  const { builtin, custom, values } = readForm(formData);
  try {
    await updateParticipant(db(), eventId, participantId, { builtin, custom });
  } catch (error) {
    return failure(error, values);
  }
  revalidatePath(`/admin/events/${eventId}/participants`);
  return { saved: true, values };
}

export type SimpleState = { error?: string; message?: string };

export async function setParticipantStatusAction(eventId: string, participantId: string, _previous: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireAdmin();
  if (!ids.safeParse({ eventId, participantId }).success) return { error: "This participant no longer exists." };
  const status = formData.get("status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  try {
    await setParticipantStatus(db(), eventId, participantId, status);
  } catch (error) {
    return { error: failure(error, {}).formError };
  }
  revalidatePath(`/admin/events/${eventId}/participants/${participantId}`);
  revalidatePath(`/admin/events/${eventId}/participants`);
  return { message: status === "ACTIVE" ? "Participant is active again." : "Participant deactivated. They stay on record but cannot win." };
}

export async function deleteParticipantAction(eventId: string, participantId: string, _previous: SimpleState): Promise<SimpleState> {
  await requireAdmin();
  if (!ids.safeParse({ eventId, participantId }).success) return { error: "This participant no longer exists." };
  try {
    await deleteParticipant(db(), eventId, participantId, purgeCdnCache);
  } catch (error) {
    return { error: failure(error, {}).formError };
  }
  revalidatePath(`/admin/events/${eventId}/participants`);
  redirect(`/admin/events/${eventId}/participants`);
}

export async function uploadParticipantPhotoAction(eventId: string, participantId: string, _previous: SimpleState, formData: FormData): Promise<SimpleState> {
  await requireAdmin();
  if (!ids.safeParse({ eventId, participantId }).success) return { error: "This participant no longer exists." };
  const file = formData.get("photo");
  const remove = formData.get("remove") === "1";
  if (!remove && !(file instanceof File)) return { error: "Choose a photo first." };
  try {
    const bytes = remove ? null : new Uint8Array(await (file as File).arrayBuffer());
    await replaceParticipantPhoto(db(), eventId, participantId, bytes, purgeCdnCache);
  } catch (error) {
    if (error instanceof MediaError) return { error: "That file is not a supported image, or it is too large." };
    return { error: failure(error, {}).formError };
  }
  revalidatePath(`/admin/events/${eventId}/participants/${participantId}`);
  return { message: remove ? "Photo removed." : "Photo saved." };
}
