"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { fieldDefinitionSchema } from "@/modules/participants/domain/fields";
import { FieldError, createFieldDefinition, deleteFieldDefinition, updateFieldDefinition } from "@/modules/participants/server/fields";
import { RosterLockedError } from "@/modules/raffle/server/roster-lock";

export type FieldFormState = { fieldErrors?: Record<string, string[]>; formError?: string; saved?: boolean };

function readField(formData: FormData) {
  return fieldDefinitionSchema.safeParse({
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    type: String(formData.get("type") ?? ""),
    required: formData.get("required") === "on",
    isPublic: formData.get("isPublic") === "on",
    options: String(formData.get("options") ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  });
}

function explain(error: unknown): FieldFormState {
  if (error instanceof FieldError) {
    if (error.code === "DUPLICATE_KEY") return { fieldErrors: { key: ["Another field already uses this key."] } };
    if (error.code === "TYPE_LOCKED") return { formError: "A field's key and type cannot change after it is created. Delete it and create a new one instead." };
    return { formError: "This field no longer exists." };
  }
  if (error instanceof RosterLockedError) return { formError: error.message };
  throw error;
}

const uuid = z.uuid();

export async function createFieldAction(eventId: string, _previous: FieldFormState, formData: FormData): Promise<FieldFormState> {
  await requireAdmin();
  if (!uuid.safeParse(eventId).success) return { formError: "This event no longer exists." };
  const parsed = readField(formData);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  try {
    await createFieldDefinition(db(), eventId, parsed.data);
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/admin/events/${eventId}/fields`);
  return { saved: true };
}

export async function updateFieldAction(eventId: string, fieldId: string, _previous: FieldFormState, formData: FormData): Promise<FieldFormState> {
  await requireAdmin();
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(fieldId).success) return { formError: "This field no longer exists." };
  const parsed = readField(formData);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  try {
    await updateFieldDefinition(db(), eventId, fieldId, parsed.data);
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/admin/events/${eventId}/fields`);
  return { saved: true };
}

export async function deleteFieldAction(eventId: string, fieldId: string, _previous: FieldFormState): Promise<FieldFormState> {
  await requireAdmin();
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(fieldId).success) return { formError: "This field no longer exists." };
  try {
    await deleteFieldDefinition(db(), eventId, fieldId);
  } catch (error) {
    return explain(error);
  }
  revalidatePath(`/admin/events/${eventId}/fields`);
  return { saved: true };
}
