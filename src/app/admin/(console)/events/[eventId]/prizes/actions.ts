"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { purgeCdnCache } from "@/modules/media/server/cdn-cache";
import { MediaError } from "@/modules/media/server/photo-store";
import { categoryInputSchema } from "@/modules/prizes/domain/prizes";
import { CategoryError, createCategory, deleteCategory, moveCategory, updateCategory } from "@/modules/prizes/server/categories";
import { PrizeError, createPrize, deletePrize, movePrize, replacePrizePhoto, setPrizeStatus, updatePrize } from "@/modules/prizes/server/prizes";
import { RosterLockedError } from "@/modules/raffle/server/roster-lock";

export type PrizeFormState = { fieldErrors?: Record<string, string>; formError?: string; saved?: boolean; values?: Record<string, string> };
export type PrizeSimpleState = { error?: string; message?: string };
export type CategoryFormState = { fieldErrors?: Record<string, string[]>; formError?: string; saved?: boolean; values?: { name: string; description: string; sceneKey: string } };

const uuid = z.uuid();

function validIds(...ids: string[]) {
  return ids.every((id) => uuid.safeParse(id).success);
}

function readPrize(formData: FormData) {
  const values = {
    code: String(formData.get("code") ?? "").slice(0, 200),
    name: String(formData.get("name") ?? "").slice(0, 500),
    description: String(formData.get("description") ?? "").slice(0, 2000),
    quantity: String(formData.get("quantity") ?? "").slice(0, 20),
    categoryId: String(formData.get("categoryId") ?? ""),
  };
  const categoryId = uuid.safeParse(values.categoryId).success ? values.categoryId : null;
  return { values, input: { ...values, categoryId } };
}

function prizeFailure(error: unknown, values: Record<string, string> = {}): PrizeFormState {
  if (error instanceof PrizeError) {
    if (error.code === "NOT_FOUND") return { formError: "This prize no longer exists.", values };
    if (error.code === "HAS_DRAWS") return { formError: "This prize has already been drawn and cannot be deleted. Withdraw it instead.", values };
    if (error.code === "TOO_MANY") return { formError: "An event can have at most 500 prizes.", values };
    return { fieldErrors: error.fieldErrors, values };
  }
  if (error instanceof RosterLockedError) return { formError: error.message, values };
  if (error instanceof MediaError) return { formError: "That file is not a supported image, or it is too large." };
  throw error;
}

function revalidatePrizes(eventId: string) {
  revalidatePath(`/admin/events/${eventId}/prizes`);
}

export async function createPrizeAction(eventId: string, _previous: PrizeFormState, formData: FormData): Promise<PrizeFormState> {
  await requireAdmin();
  if (!validIds(eventId)) return { formError: "This event no longer exists." };
  const { values, input } = readPrize(formData);
  let prizeId: string;
  try {
    prizeId = (await createPrize(db(), eventId, input)).id;
  } catch (error) {
    return prizeFailure(error, values);
  }
  revalidatePrizes(eventId);
  redirect(`/admin/events/${eventId}/prizes/${prizeId}`);
}

export async function updatePrizeAction(eventId: string, prizeId: string, _previous: PrizeFormState, formData: FormData): Promise<PrizeFormState> {
  await requireAdmin();
  if (!validIds(eventId, prizeId)) return { formError: "This prize no longer exists." };
  const { values, input } = readPrize(formData);
  try {
    await updatePrize(db(), eventId, prizeId, input);
  } catch (error) {
    return prizeFailure(error, values);
  }
  revalidatePrizes(eventId);
  return { saved: true, values };
}

export async function setPrizeStatusAction(eventId: string, prizeId: string, _previous: PrizeSimpleState, formData: FormData): Promise<PrizeSimpleState> {
  await requireAdmin();
  if (!validIds(eventId, prizeId)) return { error: "This prize no longer exists." };
  const status = formData.get("status") === "WITHDRAWN" ? "WITHDRAWN" : "AVAILABLE";
  try {
    await setPrizeStatus(db(), eventId, prizeId, status);
  } catch (error) {
    return { error: prizeFailure(error).formError };
  }
  revalidatePrizes(eventId);
  revalidatePath(`/admin/events/${eventId}/prizes/${prizeId}`);
  return { message: status === "AVAILABLE" ? "Prize is available for the draw again." : "Prize withdrawn. It stays on record but is not drawn." };
}

export async function deletePrizeAction(eventId: string, prizeId: string, _previous: PrizeSimpleState): Promise<PrizeSimpleState> {
  await requireAdmin();
  if (!validIds(eventId, prizeId)) return { error: "This prize no longer exists." };
  try {
    await deletePrize(db(), eventId, prizeId, purgeCdnCache);
  } catch (error) {
    return { error: prizeFailure(error).formError };
  }
  revalidatePrizes(eventId);
  redirect(`/admin/events/${eventId}/prizes`);
}

export async function uploadPrizePhotoAction(eventId: string, prizeId: string, _previous: PrizeSimpleState, formData: FormData): Promise<PrizeSimpleState> {
  await requireAdmin();
  if (!validIds(eventId, prizeId)) return { error: "This prize no longer exists." };
  const file = formData.get("photo");
  const remove = formData.get("remove") === "1";
  if (!remove && !(file instanceof File)) return { error: "Choose a photo first." };
  try {
    const bytes = remove ? null : new Uint8Array(await (file as File).arrayBuffer());
    await replacePrizePhoto(db(), eventId, prizeId, bytes, purgeCdnCache);
  } catch (error) {
    return { error: prizeFailure(error).formError };
  }
  revalidatePrizes(eventId);
  revalidatePath(`/admin/events/${eventId}/prizes/${prizeId}`);
  return { message: remove ? "Photo removed." : "Photo saved." };
}

export async function movePrizeAction(eventId: string, prizeId: string, direction: "up" | "down"): Promise<void> {
  await requireAdmin();
  if (!validIds(eventId, prizeId) || (direction !== "up" && direction !== "down")) return;
  try {
    await movePrize(db(), eventId, prizeId, direction);
  } catch (error) {
    if (!(error instanceof PrizeError || error instanceof RosterLockedError)) throw error;
    redirect(`/admin/events/${eventId}/prizes?problem=${error instanceof RosterLockedError ? "locked" : "missing"}`);
  }
  revalidatePrizes(eventId);
}

function readCategory(formData: FormData) {
  const values = {
    name: String(formData.get("name") ?? "").slice(0, 200),
    description: String(formData.get("description") ?? "").slice(0, 1000),
    sceneKey: String(formData.get("sceneKey") ?? "").slice(0, 40),
  };
  return { values, parsed: categoryInputSchema.safeParse(values) };
}

function categoryFailure(error: unknown): CategoryFormState {
  if (error instanceof CategoryError) {
    if (error.code === "DUPLICATE_NAME") return { fieldErrors: { name: ["Another category already has this name."] } };
    if (error.code === "HAS_PRIZES") return { formError: "Move or delete this category's prizes first." };
    if (error.code === "TOO_MANY") return { formError: "An event can have at most 50 categories." };
    return { formError: "This category no longer exists." };
  }
  if (error instanceof RosterLockedError) return { formError: error.message };
  throw error;
}

export async function createCategoryAction(eventId: string, _previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  await requireAdmin();
  if (!validIds(eventId)) return { formError: "This event no longer exists." };
  const { values, parsed } = readCategory(formData);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  try {
    await createCategory(db(), eventId, parsed.data);
  } catch (error) {
    return { ...categoryFailure(error), values };
  }
  revalidatePrizes(eventId);
  revalidatePath(`/admin/events/${eventId}/prizes/categories`);
  return { saved: true };
}

export async function updateCategoryAction(eventId: string, categoryId: string, _previous: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  await requireAdmin();
  if (!validIds(eventId, categoryId)) return { formError: "This category no longer exists." };
  const { values, parsed } = readCategory(formData);
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  try {
    await updateCategory(db(), eventId, categoryId, parsed.data);
  } catch (error) {
    return { ...categoryFailure(error), values };
  }
  revalidatePrizes(eventId);
  revalidatePath(`/admin/events/${eventId}/prizes/categories`);
  return { saved: true, values };
}

export async function deleteCategoryAction(eventId: string, categoryId: string, _previous: CategoryFormState): Promise<CategoryFormState> {
  await requireAdmin();
  if (!validIds(eventId, categoryId)) return { formError: "This category no longer exists." };
  try {
    await deleteCategory(db(), eventId, categoryId);
  } catch (error) {
    return categoryFailure(error);
  }
  revalidatePrizes(eventId);
  revalidatePath(`/admin/events/${eventId}/prizes/categories`);
  return { saved: true };
}

export async function moveCategoryAction(eventId: string, categoryId: string, direction: "up" | "down"): Promise<void> {
  await requireAdmin();
  if (!validIds(eventId, categoryId) || (direction !== "up" && direction !== "down")) return;
  try {
    await moveCategory(db(), eventId, categoryId, direction);
  } catch (error) {
    if (!(error instanceof CategoryError || error instanceof RosterLockedError)) throw error;
    redirect(`/admin/events/${eventId}/prizes/categories?problem=${error instanceof RosterLockedError ? "locked" : "missing"}`);
  }
  revalidatePath(`/admin/events/${eventId}/prizes/categories`);
}
