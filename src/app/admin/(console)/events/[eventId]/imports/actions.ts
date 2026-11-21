"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { mappingSchema } from "@/modules/imports/domain/mapping";
import { photoRuleSchema } from "@/modules/imports/domain/photos";
import { rawRowSchema } from "@/modules/imports/domain/rows";
import {
  ImportError,
  appendImportRows,
  attachImportPhoto,
  cancelImportBatch,
  commitImportBatch,
  createImportBatch,
  getImportBatch,
  revertImportBatch,
  validateImportBatch,
} from "@/modules/imports/server/imports";
import { purgeCdnCache } from "@/modules/media/server/cdn-cache";
import { MediaError, mediaCacheTag } from "@/modules/media/server/photo-store";
import { RosterLockedError } from "@/modules/raffle/server/roster-lock";

export type ImportStepResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string; code?: string; details?: string[] };

const MESSAGES: Record<string, string> = {
  NOT_FOUND: "This import no longer exists.",
  WRONG_STATE: "This import has already been committed, cancelled or reverted.",
  BAD_MAPPING: "The column mapping needs attention.",
  TOO_MANY_ROWS: "The file has more rows than one import allows.",
  DUPLICATE_ROW_NUMBER: "Rows were sent twice. Start the import again.",
  ROW_NOT_FOUND: "That row is not part of this import.",
  ROW_NOT_IMPORTABLE: "That row will not be imported, so its photo was not attached.",
  INVALID_ROWS_PRESENT: "Some rows have errors. Fix the file, or confirm that those rows should be skipped.",
  STALE_PREVIEW: "Records changed since this preview was checked. Run the check again before committing.",
  REVERT_CONFLICT: "Some records changed after the import, so it cannot be reverted automatically.",
  TOO_MANY_PRIZES: "This import would take the event past 500 prizes.",
};

function failure(error: unknown): { ok: false; message: string; code?: string; details?: string[] } {
  if (error instanceof ImportError) return { ok: false, message: MESSAGES[error.code] ?? error.code, code: error.code, details: error.details };
  if (error instanceof RosterLockedError) return { ok: false, message: error.message };
  if (error instanceof MediaError) return { ok: false, message: "The photo is not a supported image or is too large." };
  throw error;
}

const uuid = z.uuid();

async function belongs(eventId: string, batchId: string) {
  return uuid.safeParse(eventId).success && uuid.safeParse(batchId).success && Boolean(await getImportBatch(db(), eventId, batchId));
}

const startSchema = z.object({
  kind: z.enum(["PARTICIPANTS", "PRIZES"]),
  fileName: z.string().min(1).max(260),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sheetName: z.string().max(100).nullable(),
  mapping: mappingSchema,
  duplicateMode: z.enum(["SKIP", "UPDATE", "REJECT"]),
  photoRule: photoRuleSchema,
  photosProvided: z.boolean(),
});

export async function startImportAction(eventId: string, input: z.input<typeof startSchema>): Promise<ImportStepResult<{ batchId: string }>> {
  await requireAdmin();
  const parsed = startSchema.safeParse(input);
  if (!uuid.safeParse(eventId).success || !parsed.success) return { ok: false, message: "The import settings are not valid." };
  try {
    const batch = await createImportBatch(db(), eventId, parsed.data);
    return { ok: true, data: { batchId: batch.id } };
  } catch (error) {
    return failure(error);
  }
}

const rowsSchema = z.array(rawRowSchema).min(1).max(1000);

export async function appendRowsAction(eventId: string, batchId: string, rows: unknown): Promise<ImportStepResult> {
  await requireAdmin();
  const parsed = rowsSchema.safeParse(rows);
  if (!parsed.success || !(await belongs(eventId, batchId))) return { ok: false, message: "The rows could not be read. Start the import again." };
  try {
    await appendImportRows(db(), batchId, parsed.data);
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export async function validateBatchAction(eventId: string, batchId: string): Promise<ImportStepResult<{ createCount: number; updateCount: number; skipCount: number; invalidCount: number }>> {
  await requireAdmin();
  if (!(await belongs(eventId, batchId))) return { ok: false, message: MESSAGES.NOT_FOUND ?? "Not found" };
  try {
    return { ok: true, data: await validateImportBatch(db(), batchId) };
  } catch (error) {
    return failure(error);
  }
}

export async function uploadImportPhotoAction(eventId: string, batchId: string, formData: FormData): Promise<ImportStepResult> {
  await requireAdmin();
  const rowNumber = Number(formData.get("rowNumber"));
  const photo = formData.get("photo");
  const name = String(formData.get("name") ?? "photo");
  if (!Number.isInteger(rowNumber) || !(photo instanceof File) || photo.size > 4 * 1024 * 1024) return { ok: false, message: "The photo upload was malformed." };
  if (!(await belongs(eventId, batchId))) return { ok: false, message: MESSAGES.NOT_FOUND ?? "Not found" };
  try {
    await attachImportPhoto(db(), batchId, rowNumber, new Uint8Array(await photo.arrayBuffer()), name);
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error);
  }
}

export type BatchActionState = { error?: string; details?: string[]; message?: string };

export async function commitImportAction(eventId: string, batchId: string, _previous: BatchActionState, formData: FormData): Promise<BatchActionState> {
  await requireAdmin();
  if (!(await belongs(eventId, batchId))) return { error: MESSAGES.NOT_FOUND };
  try {
    await commitImportBatch(db(), batchId, { skipInvalidRows: formData.get("skipInvalid") === "on" });
  } catch (error) {
    const result = failure(error);
    return { error: result.message, details: result.details };
  }
  revalidatePath(`/admin/events/${eventId}/participants`);
  revalidatePath(`/admin/events/${eventId}/prizes`);
  revalidatePath(`/admin/events/${eventId}/imports`);
  redirect(`/admin/events/${eventId}/imports/${batchId}`);
}

export async function recheckImportAction(eventId: string, batchId: string, _previous: BatchActionState): Promise<BatchActionState> {
  await requireAdmin();
  if (!(await belongs(eventId, batchId))) return { error: MESSAGES.NOT_FOUND };
  try {
    await validateImportBatch(db(), batchId);
  } catch (error) {
    const result = failure(error);
    return { error: result.message, details: result.details };
  }
  revalidatePath(`/admin/events/${eventId}/imports/${batchId}`);
  return { message: "Checked again against the current records." };
}

export async function cancelImportAction(eventId: string, batchId: string, _previous: BatchActionState): Promise<BatchActionState> {
  await requireAdmin();
  if (!(await belongs(eventId, batchId))) return { error: MESSAGES.NOT_FOUND };
  try {
    await cancelImportBatch(db(), batchId);
  } catch (error) {
    return { error: failure(error).message };
  }
  revalidatePath(`/admin/events/${eventId}/imports`);
  redirect(`/admin/events/${eventId}/imports`);
}

export async function revertImportAction(eventId: string, batchId: string, _previous: BatchActionState): Promise<BatchActionState> {
  await requireAdmin();
  if (!(await belongs(eventId, batchId))) return { error: MESSAGES.NOT_FOUND };
  try {
    const result = await revertImportBatch(db(), batchId);
    if (result.removedPhotoIds.length > 0) await purgeCdnCache(result.removedPhotoIds.map(mediaCacheTag));
  } catch (error) {
    const result = failure(error);
    return { error: result.message, details: result.details };
  }
  revalidatePath(`/admin/events/${eventId}/participants`);
  revalidatePath(`/admin/events/${eventId}/prizes`);
  revalidatePath(`/admin/events/${eventId}/imports/${batchId}`);
  return { message: "Import reverted." };
}
